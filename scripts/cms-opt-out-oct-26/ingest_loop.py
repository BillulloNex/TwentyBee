#!/usr/bin/env python3
"""
Ingest all FL opt-out provider batches into Twenty CRM via MCP.
This script reads batch files and calls the Twenty MCP execute_tool.
Run with: python3 ingest_loop.py
Requires the Twenty MCP to be accessible via stdin/stdout.
"""
import json, os, sys, subprocess, time

BATCHES_DIR = "/Users/thomasthemaker/Development/ComfySpace/playground/TwentyBee/scripts/cms-opt-out-oct-26/twenty_batches"

# Load all batch files
batch_files = sorted([f for f in os.listdir(BATCHES_DIR) if f.startswith("batch_") and f.endswith(".json") and "remaining" not in f])

total_created = 0
total_failed = 0
errors = []

print(f"Starting ingestion of {len(batch_files)} batches into Twenty CRM...")
print(f"(This script outputs batch data for manual MCP calls)")
print()

for i, bf in enumerate(batch_files):
    with open(os.path.join(BATCHES_DIR, bf)) as f:
        data = json.load(f)
    records = data["records"]
    npis = [r["npi"] for r in records]
    print(f"Batch {i+1}/{len(batch_files)}: {len(records)} records (NPIs: {npis[0]}...{npis[-1]})")

print(f"\nTotal records to ingest: {sum(len(json.load(open(os.path.join(BATCHES_DIR, f)))['records']) for f in batch_files)}")
print(f"\nUse the Twenty MCP execute_tool to call upsert_many_opt_out_providers for each batch.")
print(f"Batch files are in: {BATCHES_DIR}/")
