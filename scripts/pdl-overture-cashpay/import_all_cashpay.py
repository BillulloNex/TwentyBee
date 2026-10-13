#!/usr/bin/env python3
import csv
import json
import time
import urllib.request
import urllib.error
import sys
import os
from pathlib import Path

# Load .env
env_paths = [Path(__file__).parent / ".env", Path(__file__).parent.parent / ".env"]
for p in env_paths:
    if p.exists():
        with open(p) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip())
        break

API_KEY = os.environ.get("TWENTY_API_KEY", "")
BASE_URL = os.environ.get("TWENTY_BASE_URL", "https://20.beenex.cloud")
if not API_KEY:
    print("❌ Missing TWENTY_API_KEY in environment or .env", file=sys.stderr)
    sys.exit(1)

OVERTURE_CSV = str(Path(__file__).parent / "overture_cashpay_medical_practices.csv")
PDL_CSV = str(Path(__file__).parent / "pdl_cashpay_medical_practices.csv")

BATCH_SIZE = 50
RATE_DELAY = 0.15  # seconds

HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

def send_batch(endpoint, records):
    url = f"{BASE_URL}/rest/batch/{endpoint}"
    data = json.dumps(records).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=HEADERS, method="POST")
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            err_msg = e.read().decode("utf-8", errors="replace")
            if attempt == 2:
                print(f"\n[ERROR] HTTP {e.code}: {err_msg[:200]}")
                return None
            time.sleep(1.0 * (attempt + 1))
        except Exception as e:
            if attempt == 2:
                print(f"\n[ERROR] Network error: {e}")
                return None
            time.sleep(1.0 * (attempt + 1))

def import_overture():
    print("=" * 60)
    print("  IMPORTING OVERTURE CASH-PAY PRACTICES INTO TWENTY CRM")
    print("=" * 60)
    with open(OVERTURE_CSV, "r", encoding="utf-8") as f:
        reader = list(csv.DictReader(f))
    total = len(reader)
    print(f"Loaded {total:,} records from Overture CSV.")

    batch = []
    imported = 0
    for idx, row in enumerate(reader):
        rec = {
            "name": (row.get("name") or "Unknown Practice")[:255],
            "overtureId": row.get("overture_id") or "",
            "cashPaySignalType": row.get("cashpay_signal_type") or "",
            "matchedKeyword": row.get("matched_keyword") or "",
            "category": row.get("category") or "",
            "streetAddress": row.get("address") or "",
            "city": row.get("city") or "",
            "state": row.get("state") or "",
            "postalCode": str(row.get("zip") or ""),
            "phone": row.get("phone") or "",
            "website": row.get("website") or "",
            "position": "first"
        }
        batch.append(rec)
        if len(batch) >= BATCH_SIZE or idx == total - 1:
            res = send_batch("overtureCashPayPractices", batch)
            if res:
                imported += len(batch)
            sys.stdout.write(f"\r  Progress: {imported:,} / {total:,} records imported ({imported/total*100:.1f}%)")
            sys.stdout.flush()
            batch = []
            time.sleep(RATE_DELAY)
    print(f"\n Done Overture! Total imported: {imported:,}\n")

def import_pdl():
    print("=" * 60)
    print("  IMPORTING PDL CASH-PAY COMPANIES INTO TWENTY CRM")
    print("=" * 60)
    with open(PDL_CSV, "r", encoding="utf-8") as f:
        reader = list(csv.DictReader(f))
    total = len(reader)
    print(f"Loaded {total:,} records from PDL CSV.")

    batch = []
    imported = 0
    for idx, row in enumerate(reader):
        rec = {
            "name": (row.get("name") or "Unknown Company")[:255],
            "pdlId": row.get("pdl_id") or "",
            "cashPaySignalType": row.get("cashpay_signal_type") or "",
            "matchedKeyword": row.get("matched_keyword") or "",
            "industry": row.get("industry") or "",
            "companySize": row.get("size") or "",
            "foundedYear": str(row.get("founded") or ""),
            "locality": row.get("locality") or "",
            "region": row.get("region") or "",
            "website": row.get("website") or "",
            "linkedinUrl": row.get("linkedin_url") or "",
            "position": "first"
        }
        batch.append(rec)
        if len(batch) >= BATCH_SIZE or idx == total - 1:
            res = send_batch("pdlCashPayCompanies", batch)
            if res:
                imported += len(batch)
            sys.stdout.write(f"\r  Progress: {imported:,} / {total:,} records imported ({imported/total*100:.1f}%)")
            sys.stdout.flush()
            batch = []
            time.sleep(RATE_DELAY)
    print(f"\n Done PDL! Total imported: {imported:,}\n")

if __name__ == "__main__":
    t0 = time.time()
    import_overture()
    import_pdl()
    elapsed = time.time() - t0
    print(f" All imports completed successfully in {elapsed:.1f} seconds!")
