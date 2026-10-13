#!/usr/bin/env python3
"""
Ingest FL opt-out providers into Twenty CRM.
Loops through batch files and calls upsert_many_opt_out_providers via MCP.
Outputs a shell script of curl commands, or uses the MCP bridge.
"""
import json, os, glob

BATCHES_DIR = "/Users/thomasthemaker/Development/ComfySpace/playground/TwentyBee/scripts/cms-opt-out-oct-26/twenty_batches"

batch_files = sorted(glob.glob(os.path.join(BATCHES_DIR, "batch_*.json")))
# Skip batch_000_remaining
batch_files = [f for f in batch_files if "remaining" not in f]

print(f"Total batches: {len(batch_files)}")
print(f"Total records: {sum(len(json.load(open(f))['records']) for f in batch_files)}")

# Output all batches as a single JSON array for processing
all_batches = []
for bf in batch_files:
    with open(bf) as f:
        data = json.load(f)
        all_batches.append(data["records"])

output = os.path.join(BATCHES_DIR, "all_batches.json")
with open(output, "w") as f:
    json.dump(all_batches, f)
print(f"Written all batches to {output}")
