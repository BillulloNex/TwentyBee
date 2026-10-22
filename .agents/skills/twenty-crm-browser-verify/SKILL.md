---
name: twenty-crm-browser-verify
description: >-
  Browser-based verification of Twenty CRM changes using Chrome DevTools MCP.
  Use EVERY TIME after making metadata changes (creating/updating objects,
  fields, navigation items, workflows) to confirm they actually work in the UI.
  Definition of done = verified in the browser, not just via API.
---

# Twenty CRM Browser Verification

**MANDATORY**: After any Twenty CRM metadata change, verify in the browser before
telling the user it's done. API-level confirmation is NOT sufficient — the
front-end can have schema caching issues, naming bugs, or rendering failures
that only show up in the UI.

## Login Credentials

- URL: `https://20.beenex.cloud`
- Email: `thomas@beenex.ai`
- Password: Stored in agent memory. Do NOT hardcode in any file.

## Verification Procedure

### Step 1: Open the page

```
# List existing pages
call_mcp_tool(ServerName: "chrome-devtools-mcp", ToolName: "list_pages", Arguments: {})

# Navigate to Twenty
call_mcp_tool(ServerName: "chrome-devtools-mcp", ToolName: "navigate_page",
  Arguments: { pageId: 1, type: "url", url: "https://20.beenex.cloud" })
```

### Step 2: Log in (if needed)

Take a snapshot to check if on the login page:

```
call_mcp_tool(ServerName: "chrome-devtools-mcp", ToolName: "take_snapshot",
  Arguments: { pageId: 1 })
```

If you see a login form:

1. Fill email:
   ```
   call_mcp_tool(ServerName: "chrome-devtools-mcp", ToolName: "fill",
     Arguments: { pageId: 1, uid: "<email_field_uid>", value: "thomas@beenex.ai" })
   ```

2. Click Continue:
   ```
   call_mcp_tool(ServerName: "chrome-devtools-mcp", ToolName: "click",
     Arguments: { pageId: 1, uid: "<continue_button_uid>" })
   ```

3. Take snapshot again to find password field, fill it:
   ```
   call_mcp_tool(ServerName: "chrome-devtools-mcp", ToolName: "fill",
     Arguments: { pageId: 1, uid: "<password_field_uid>", value: "<password from agent memory>" })
   ```

4. Click Sign In:
   ```
   call_mcp_tool(ServerName: "chrome-devtools-mcp", ToolName: "click",
     Arguments: { pageId: 1, uid: "<signin_button_uid>" })
   ```

### Step 3: Navigate to the target page

Take a snapshot to find sidebar links. Campaign objects are inside the
`Campaign_1` folder — click the folder first, then the object link.

```
call_mcp_tool(ServerName: "chrome-devtools-mcp", ToolName: "take_snapshot",
  Arguments: { pageId: 1 })
# grep for the target in the snapshot output, then click it
```

### Step 4: Verify data loads

Take a screenshot and check:

```
call_mcp_tool(ServerName: "chrome-devtools-mcp", ToolName: "take_screenshot",
  Arguments: { pageId: 1 })
```

**Check for:**
- [ ] Records appear in the table (not "No records found")
- [ ] Record count matches expected
- [ ] Column headers are correct
- [ ] No red error toasts at the bottom

### Step 5: Check console for errors

```
call_mcp_tool(ServerName: "chrome-devtools-mcp", ToolName: "list_console_messages",
  Arguments: { pageId: 1 })
```

**Fail if you see:**
- `Cannot query field "..." on type "Query"` — schema mismatch
- `Unknown type "...FilterInput"` — object not registered in schema
- `400 Bad Request` on `/graphql` — malformed query from casing bug
- Any red `[error]` messages related to GraphQL or data fetching

### Step 6: Kill Chrome when done

```bash
osascript -e 'quit app "Google Chrome"'
pkill -f "Google Chrome"
```

Always kill Chrome after verification — the user needs it free for restarts.

## Known Gotchas

### Naming / Casing Bug

Twenty's GraphQL schema generator applies camelCase rules that capitalize
letters after digits. For example:

- `campaign1Cohort1s` → schema field becomes `campaign1Cohort1S` (capital S)
- Front-end sends `campaign1Cohort1s` (lowercase s) → **permanent mismatch**

**Rule**: Never create an object whose `namePlural` has a letter immediately
after a digit at the end (e.g., `thing1s`). Use a word instead:
- BAD: `campaign1Cohort1` / `campaign1Cohort1s`
- GOOD: `campaign1CohortOne` / `campaign1CohortOnes`

### Object Folder Placement

When creating a new object via `create_object_metadata`, the auto-created
navigation menu item lands at the root level, NOT inside any folder. You must
manually move it:

```bash
# Find the Campaign_1 folder ID and the new nav item ID
call_mcp_tool(... list_navigation_menu_items ...)

# Move it via metadata API
curl -X POST 'https://20.beenex.cloud/metadata' \
  -H 'Authorization: Bearer <TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"query": "mutation { updateNavigationMenuItem(input: { id: \"<NAV_ITEM_ID>\", update: { folderId: \"<FOLDER_ID>\", position: <N> } }) { id folderId } }"}'
```

The MCP `update_navigation_menu_item` tool may fail with auth errors — use the
metadata API directly via curl as fallback.

### Schema Cache After Object Creation

If the workspace GraphQL schema doesn't include a newly created object:
1. Deactivate + reactivate via metadata API:
   ```
   mutation { updateOneObject(input: { id: "...", update: { isActive: false } }) { id } }
   mutation { updateOneObject(input: { id: "...", update: { isActive: true } }) { id } }
   ```
2. If that doesn't work, delete and recreate the object.
3. Always verify with `__schema { queryType { fields { name } } }` that the
   root query field exists before declaring success.

### Metadata API Endpoints

- Workspace data: `https://20.beenex.cloud/graphql`
- Metadata (objects/fields/nav): `https://20.beenex.cloud/metadata`
- NOT `/api/metadata/graphql` (404) or `/metadata/graphql` (timeout)

## Reference IDs

| Entity | ID |
|--------|-----|
| Campaign_1 folder (nav) | `37f3222f-fd5b-458b-8da6-a7225c5954cc` |
| campaign1Person (object) | `7e62886b-e485-4365-af7a-3d1d1b8a9289` |
| campaign1CohortPilot (object) | `f4a6a3ad-3458-4375-a041-61027c8802bb` |
| campaign1CohortOne (object) | `91a7634d-741a-4cec-a0c0-ae8535683410` |
| campaign1RoleMailbox (object) | `0f2eb2f4-2bd5-4879-b9dd-a4b7948cfc88` |
| campaign1EmailTemplate (object) | `c90e7689-1393-4bba-b7c7-22f051e21438` |
