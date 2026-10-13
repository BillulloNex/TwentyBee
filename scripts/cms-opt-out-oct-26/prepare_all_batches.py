#!/usr/bin/env python3
"""
Prepare all non-FL contacts from consolidated CSV as Twenty CRM batch files.
Includes state field and website URLs where available.
"""
import csv, json, os
from datetime import datetime

CONSOLIDATED = "/Users/thomasthemaker/Development/ComfySpace/playground/TwentyBee/scripts/cms-opt-out-oct-26/cms_opt_out_consolidated.csv"
BATCHES_DIR = "/tmp/twenty_all_batches"
os.makedirs(BATCHES_DIR, exist_ok=True)

def parse_date(date_str):
    try:
        return datetime.strptime(date_str.strip(), "%m/%d/%Y").strftime("%Y-%m-%d")
    except:
        return None

def build_record(row):
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
        "state": row["State Code"].strip().upper(),
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

# Load non-FL records
records = []
with open(CONSOLIDATED) as f:
    for row in csv.DictReader(f):
        if row["State Code"].strip() == "FL":
            continue
        records.append(build_record(row))

print(f"Non-FL records: {len(records)}")

# Write batch files (20 per batch)
batch_count = 0
for i in range(0, len(records), 20):
    batch = records[i:i+20]
    with open(os.path.join(BATCHES_DIR, f"batch_{batch_count:04d}.json"), "w") as f:
        json.dump({"records": batch}, f)
    batch_count += 1

print(f"Created {batch_count} batch files in {BATCHES_DIR}")
print(f"Total records: {len(records)}")

# Sample
print(f"\nSample record:")
print(json.dumps(records[0], indent=2))
