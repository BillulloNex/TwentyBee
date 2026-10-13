#!/usr/bin/env python3
"""
Enrich top 200 active CMS opt-out providers with practice websites via Exa API.
Outputs a CSV with the original data + website URL.
"""

import csv
import json
import os
import sys
import time
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime

BASE_DIR = "/Users/thomasthemaker/Development/ComfySpace/playground/TwentyBee/scripts/cms-opt-out-oct-26"
CONSOLIDATED_CSV = os.path.join(BASE_DIR, "cms_opt_out_consolidated.csv")
OUTPUT_CSV = os.path.join(BASE_DIR, "cms_opt_out_enriched_200.csv")
EXA_API_KEY = os.environ.get("EXA_API_KEY", "")

AGGREGATOR_DOMAINS = {
    "psychologytoday.com", "zocdoc.com", "healthgrades.com", "vitals.com",
    "webmd.com", "npidb.org", "npino.com", "npiprofile.com", "docinfo.org",
    "wellness.com", "yelp.com", "yellowpages.com", "bbb.org", "facebook.com",
    "linkedin.com", "instagram.com", "twitter.com", "x.com",
    "ratemds.com", "sharecare.com", "doximity.com", "castleconnolly.com",
    "usnews.com", "google.com", "maps.google.com"
}


def search_exa(first, last, specialty, city, state):
    """Search Exa for a provider's practice website."""
    query = f"{first} {last} {specialty} practice {city} {state}"

    url = "https://api.exa.ai/search"
    headers = {
        "Content-Type": "application/json",
        "x-api-key": EXA_API_KEY,
        "Accept": "application/json"
    }
    body = json.dumps({
        "query": query,
        "numResults": 5,
        "type": "auto",
    }).encode()

    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
            results = data.get("results", [])
            if results:
                # Find first non-aggregator result
                for r in results:
                    rurl = r.get("url", "")
                    from urllib.parse import urlparse
                    domain = urlparse(rurl).netloc.replace("www.", "")
                    if domain not in AGGREGATOR_DOMAINS:
                        return rurl, r.get("title", ""), results[0].get("url", "")
                # All aggregators — return first anyway
                return results[0].get("url", ""), results[0].get("title", ""), results[0].get("url", "")
            return "", "", ""
    except urllib.error.HTTPError as e:
        err = e.read().decode()[:200]
        print(f"    ⚠️  HTTP {e.code}: {err}")
        return "", "", ""
    except Exception as e:
        print(f"    ⚠️  Error: {e}")
        return "", "", ""


def main():
    if not EXA_API_KEY:
        print("❌ Set EXA_API_KEY env var")
        sys.exit(1)

    # Load first 200 active providers
    rows = []
    with open(CONSOLIDATED_CSV) as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                end = datetime.strptime(row["Latest Optout End Date"], "%m/%d/%Y")
                if end <= datetime.now():
                    continue
            except:
                continue
            rows.append(row)
            if len(rows) >= 200:
                break

    print(f"Processing {len(rows)} active providers through Exa...\n")

    # Enrich
    fieldnames = list(rows[0].keys()) + ["Website URL", "Website Title", "Exa Top Result"]
    enriched = []
    found = 0
    errors = 0

    for i, row in enumerate(rows):
        first = row["First Name"]
        last = row["Last Name"]
        spec = row["Specialty"]
        city = row["City Name"]
        state = row["State Code"]

        website, title, top_result = search_exa(first, last, spec, city, state)

        row["Website URL"] = website
        row["Website Title"] = title
        row["Exa Top Result"] = top_result
        enriched.append(row)

        if website:
            found += 1
            status = "✅"
        else:
            errors += 1
            status = "❌"

        if (i + 1) % 10 == 0 or i < 5 or website == "":
            print(f"[{i+1:3d}/200] {status} {first} {last} | {spec} | {city}, {state}")
            if website:
                print(f"          → {website}")

        # Rate limit: ~5 req/sec to be safe
        time.sleep(0.22)

    # Write output
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(enriched)

    print(f"\n{'='*60}")
    print(f"DONE!")
    print(f"{'='*60}")
    print(f"Total processed:  {len(rows)}")
    print(f"Website found:    {found} ({found/len(rows)*100:.0f}%)")
    print(f"No website:       {errors} ({errors/len(rows)*100:.0f}%)")
    print(f"Output:           {OUTPUT_CSV}")
    print(f"File exists:      {os.path.exists(OUTPUT_CSV)}")
    print(f"Est. cost:        ${len(rows)/1000 * 7:.2f}")


if __name__ == "__main__":
    main()

