#!/usr/bin/env python3
"""
Consolidate all CMS Opt-Out monthly CSVs into one deduplicated file.
- Key: NPI
- Opt-out dates: earliest effective → latest end date across all snapshots
- All other fields: taken from the row with the latest "Last updated" date
"""

import csv
import os
import glob
from datetime import datetime

BASE = "extracted/Opt Out Affidavits"
OUTPUT = "cms_opt_out_consolidated.csv"

def parse_date(s):
    """Parse MM/DD/YYYY date string, return None if invalid."""
    s = s.strip()
    if not s:
        return None
    try:
        return datetime.strptime(s, "%m/%d/%Y")
    except ValueError:
        return None

def main():
    # NPI -> consolidated record
    providers = {}
    
    csv_files = sorted(glob.glob(os.path.join(BASE, "*", "*.csv")))
    print(f"Found {len(csv_files)} CSV files")
    
    total_rows = 0
    for csv_file in csv_files:
        month_dir = os.path.basename(os.path.dirname(csv_file))
        with open(csv_file, "r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                total_rows += 1
                npi = row.get("npi", "").strip()
                if not npi:
                    continue
                
                eff_date = parse_date(row.get("Optout Effective Date", ""))
                end_date = parse_date(row.get("Optout End Date", ""))
                last_updated = parse_date(row.get("Last updated", ""))
                
                if npi not in providers:
                    providers[npi] = {
                        "First Name": row.get("First Name", "").strip(),
                        "Last Name": row.get("Last Name", "").strip(),
                        "npi": npi,
                        "Specialty": row.get("Specialty", "").strip(),
                        "Earliest Optout Effective Date": eff_date,
                        "Latest Optout End Date": end_date,
                        "First Line Street Address": row.get("First Line Street Address", "").strip(),
                        "Second Line Street Address": row.get("Second Line Street Address", "").strip(),
                        "City Name": row.get("City Name", "").strip(),
                        "State Code": row.get("State Code", "").strip(),
                        "Zip code": row.get("Zip code", "").strip(),
                        "Eligible to Order and Refer": row.get("Eligible to Order and Refer", "").strip(),
                        "Last updated": last_updated,
                        "_source_month": month_dir,
                    }
                else:
                    p = providers[npi]
                    
                    # Expand opt-out date range
                    if eff_date and (p["Earliest Optout Effective Date"] is None or eff_date < p["Earliest Optout Effective Date"]):
                        p["Earliest Optout Effective Date"] = eff_date
                    if end_date and (p["Latest Optout End Date"] is None or end_date > p["Latest Optout End Date"]):
                        p["Latest Optout End Date"] = end_date
                    
                    # If this row is more recent, update all non-date fields
                    if last_updated and (p["Last updated"] is None or last_updated >= p["Last updated"]):
                        p["First Name"] = row.get("First Name", "").strip() or p["First Name"]
                        p["Last Name"] = row.get("Last Name", "").strip() or p["Last Name"]
                        p["Specialty"] = row.get("Specialty", "").strip() or p["Specialty"]
                        p["First Line Street Address"] = row.get("First Line Street Address", "").strip()
                        p["Second Line Street Address"] = row.get("Second Line Street Address", "").strip()
                        p["City Name"] = row.get("City Name", "").strip()
                        p["State Code"] = row.get("State Code", "").strip()
                        p["Zip code"] = row.get("Zip code", "").strip()
                        eligible = row.get("Eligible to Order and Refer", "").strip()
                        if eligible in ("Y", "N"):
                            p["Eligible to Order and Refer"] = eligible
                        p["Last updated"] = last_updated
                        p["_source_month"] = month_dir
    
    print(f"Processed {total_rows:,} total rows across all files")
    print(f"Consolidated to {len(providers):,} unique NPIs")
    
    # Write output
    fieldnames = [
        "First Name", "Last Name", "npi", "Specialty",
        "Earliest Optout Effective Date", "Latest Optout End Date",
        "First Line Street Address", "Second Line Street Address",
        "City Name", "State Code", "Zip code",
        "Eligible to Order and Refer", "Last updated"
    ]
    
    fmt = lambda d: d.strftime("%m/%d/%Y") if d else ""
    
    with open(OUTPUT, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        
        for npi in sorted(providers.keys()):
            p = providers[npi]
            row = dict(p)
            row["Earliest Optout Effective Date"] = fmt(p["Earliest Optout Effective Date"])
            row["Latest Optout End Date"] = fmt(p["Latest Optout End Date"])
            row["Last updated"] = fmt(p["Last updated"])
            writer.writerow(row)
    
    print(f"Written to: {OUTPUT}")
    
    # Quick stats
    states = {}
    specialties = {}
    for p in providers.values():
        s = p["State Code"]
        if s:
            states[s] = states.get(s, 0) + 1
        sp = p["Specialty"]
        if sp:
            specialties[sp] = specialties.get(sp, 0) + 1
    
    print(f"\nTop 5 states: {sorted(states.items(), key=lambda x: -x[1])[:5]}")
    print(f"Top 5 specialties: {sorted(specialties.items(), key=lambda x: -x[1])[:5]}")

if __name__ == "__main__":
    main()
