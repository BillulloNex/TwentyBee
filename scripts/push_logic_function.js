// Push a logic function's source into Twenty, substituting keys from scripts/.env.
// Usage: node scripts/push_logic_function.js --id <logicFunctionId> --file <source.ts> [--name <name>]
//        node scripts/push_logic_function.js --id <logicFunctionId> --execute --payload '{"dryRun":true}'
//        node scripts/push_logic_function.js --introspect

const fs = require("fs");
const path = require("path");

const ENV_PATH = path.join(__dirname, ".env");
if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const BASE = (process.env.TWENTY_BASE_URL || "https://20.beenex.cloud").replace(/\/$/, "");
const TOKEN = process.env.TWENTY_API_KEY;

const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : null;
};
const ID = flag("--id");
const FILE = flag("--file");
const INTROSPECT = args.includes("--introspect");

async function gql(endpoint, query, variables) {
  const res = await fetch(BASE + endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function introspect() {
  const data = await gql(
    "/metadata",
    `{ __schema { mutationType { fields { name args { name type { name kind ofType { name kind } } } } } queryType { fields { name } } } }`,
  );
  const muts = data.__schema.mutationType.fields.filter((f) => /logicFunction|serverlessFunction/i.test(f.name));
  const queries = data.__schema.queryType.fields.filter((f) => /logicFunction|serverlessFunction/i.test(f.name));
  console.log("mutations:", JSON.stringify(muts, null, 1));
  console.log("queries:", queries.map((q) => q.name));
  for (const m of muts) {
    for (const a of m.args) {
      const typeName = a.type.name || a.type.ofType?.name;
      if (!typeName) continue;
      const t = await gql("/metadata", `{ __type(name: "${typeName}") { name inputFields { name type { name kind ofType { name kind ofType { name } } } } } }`);
      console.log(`type ${typeName}:`, JSON.stringify(t.__type.inputFields, null, 1));
    }
  }
}

async function push() {
  let code = fs.readFileSync(FILE, "utf8");
  code = code.replace(/__TWENTY_API_KEY__/g, process.env.TWENTY_API_KEY).replace(/__RESEND_API_KEY__/g, process.env.RESEND_API_KEY);
  if (/__[A-Z_]+_KEY__/.test(code)) throw new Error("unsubstituted placeholder in source");

  const updated = await gql(
    "/metadata",
    `mutation Update($input: UpdateLogicFunctionFromSourceInput!) {
      updateOneLogicFunction(input: $input)
    }`,
    { input: { id: ID, update: { sourceHandlerCode: code, name: NAME || undefined } } },
  );
  console.log("updated:", JSON.stringify(updated));

  const back = await gql(
    "/metadata",
    `query($input: LogicFunctionIdInput!) { getLogicFunctionSourceCode(input: $input) }`,
    { input: { id: ID } },
  );
  const stored = back.getLogicFunctionSourceCode;
  console.log("readback:", stored === code ? "MATCH" : "MISMATCH", `(${stored.length} chars)`);
}

async function execute() {
  const payload = JSON.parse(flag("--payload") || "{}");
  const data = await gql(
    "/metadata",
    `mutation Run($input: ExecuteOneLogicFunctionInput!) { executeOneLogicFunction(input: $input) { data logs duration status error } }`,
    { input: { id: ID, payload } },
  );
  const out = data.executeOneLogicFunction;
  const result = out?.data ?? out;
  if (result?.report) {
    const { report, ...rest } = result;
    console.log(JSON.stringify({ ...rest, status: out?.status, error: out?.error }, null, 1));
    console.log(report);
  } else {
    console.log(JSON.stringify(out, null, 1).slice(0, 4000));
  }
}

const NAME = flag("--name");
(INTROSPECT ? introspect() : args.includes("--execute") ? execute() : push()).catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
