#!/usr/bin/env python3
"""
Ingest FL opt-out providers into Twenty CRM via MCP.
Reads the enriched FL CSV and outputs batch JSON for create_many_opt_out_providers.
Outputs each batch as a JSON file that can be fed to the MCP tool.
"""

import csv, json, os, sys
from datetime import datetime

BASE_DIR = "/Users/thomasthemaker/Development/ComfySpace/playground/TwentyBee/scripts/cms-opt-out-oct-26"
FL_CSV = os.path.join(BASE_DIR, "cms_opt_out_fl_enriched.csv")
BATCHES_DIR = os.path.join(BASE_DIR, "twenty_batches")

os.makedirs(BATCHES_DIR, exist_ok=True)

def parse_date(date_str):
    """Convert MM/DD/YYYY to YYYY-MM-DD"""
    try:
        return datetime.strptime(date_str.strip(), "%m/%d/%Y").strftime("%Y-%m-%d")
    except:
        return None

def build_record(row):
    """Convert a CSV row to a Twenty CRM record."""
    url = row.get("Website URL", "").strip()
    addr1 = row.get("First Line Street Address", "").strip()
    addr2 = row.get("Second Line Street Address", "").strip()
    full_addr = f"{addr1} {addr2}".strip() if addr2 else addr1
    
    rec = {
        "position": "last",
        "npi": row["npi"].strip(),
        "firstName": row["First Name"].strip().title(),
        "lastName": row["Last Name"].strip().title(),
        "specialty": row["Specialty"].strip().title(),
        "city": row["City Name"].strip().title(),
        "zipCode": row["Zip code"].strip(),
        "streetAddress": full_addr,
        "eligibleToOrderRefer": row.get("Eligible to Order and Refer", "").strip().upper() == "Y",
        "name": f"{row['First Name'].strip().title()} {row['Last Name'].strip().title()}",
    }
    
    start = parse_date(row.get("Earliest Optout Effective Date", ""))
    end = parse_date(row.get("Latest Optout End Date", ""))
    if start:
        rec["optOutStartDate"] = start
    if end:
        rec["optOutEndDate"] = end
    
    if url:
        rec["website"] = {
            "primaryLinkLabel": "Practice Website",
            "primaryLinkUrl": url
        }
    
    return rec

# Load FL records with live URLs
rows = []
with open(FL_CSV) as f:
    for row in csv.DictReader(f):
        if row.get("URL Status") == "live":
            rows.append(row)

print(f"Total FL records with live URLs: {len(rows)}")

# Create batches of 20
batches = []
for i in range(0, len(rows), 20):
    batch = [build_record(r) for r in rows[i:i+20]]
    batches.append(batch)

print(f"Created {len(batches)} batches of max 20 records")

# Write batch files
for i, batch in enumerate(batches):
    path = os.path.join(BATCHES_DIR, f"batch_{i:03d}.json")
    with open(path, "w") as f:
        json.dump({"records": batch}, f)

print(f"Batch files written to {BATCHES_DIR}/")

# Also write a single combined file for reference
combined = os.path.join(BASE_DIR, "twenty_all_records.json")
all_records = []
for b in batches:
    all_records.extend(b)
with open(combined, "w") as f:
    json.dump(all_records, f, indent=2)
print(f"Combined records file: {combined} ({len(all_records)} records)")

# Print first record as sample
print(f"\nSample record:")
print(json.dumps(batches[0][0], indent=2))
