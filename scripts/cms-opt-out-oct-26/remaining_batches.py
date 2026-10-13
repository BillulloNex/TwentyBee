#!/usr/bin/env python3
"""
Read all batch files and output a compact JSON array for each batch,
suitable for sequential MCP execute_tool calls.
Skips batches 0 and 1 which are already inserted.
"""
import json, os

BATCHES_DIR = "/Users/thomasthemaker/Development/ComfySpace/playground/TwentyBee/scripts/cms-opt-out-oct-26/twenty_batches"
START_BATCH = 2  # Batches 0 and 1 already done (40 records)

batches = []
for i in range(START_BATCH, 113):
    with open(os.path.join(BATCHES_DIR, f"batch_{i:03d}.json")) as f:
        batches.append(json.load(f)["records"])

print(f"Remaining batches: {len(batches)} (batches {START_BATCH}-112)")
print(f"Remaining records: {sum(len(b) for b in batches)}")
print(f"Already inserted: 40 records (batches 0-1)")

# Write as a single JSON file with batch index
output = os.path.join(BATCHES_DIR, "remaining_batches.json")
data = {f"batch_{i+START_BATCH:03d}": recs for i, recs in enumerate(batches)}
with open(output, "w") as f:
    json.dump(data, f)
print(f"Written to: {output}")
