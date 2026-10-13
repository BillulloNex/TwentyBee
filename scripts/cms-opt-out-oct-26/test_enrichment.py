#!/usr/bin/env python3
"""
Head-to-head test: Google Places vs Exa for finding practice websites.
Tests 10 diverse providers from the consolidated CMS opt-out list.
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

CONSOLIDATED_CSV = "cms_opt_out_consolidated.csv"
OUTPUT_FILE = "enrichment_test_results.json"

GOOGLE_API_KEY = os.environ.get("GOOGLE_PLACES_API_KEY", "")
EXA_API_KEY = os.environ.get("EXA_API_KEY", "")

# Domain blocklist for Exa — these are aggregators, not practice websites
AGGREGATOR_DOMAINS = {
    "psychologytoday.com", "zocdoc.com", "healthgrades.com", "vitals.com",
    "webmd.com", "npidb.org", "npino.com", "npiprofile.com", "docinfo.org",
    "wellness.com", "yelp.com", "yellowpages.com", "bbb.org", "facebook.com",
    "linkedin.com", "instagram.com", "twitter.com", "x.com",
    "ratemds.com", "sharecare.com", "doximity.com", "castleconnolly.com",
    "usnews.com", "google.com", "maps.google.com"
}


def load_sample(n=10):
    """Load n diverse active providers."""
    rows = []
    seen_specialties = set()
    seen_states = set()

    with open(CONSOLIDATED_CSV) as f:
        reader = csv.DictReader(f)
        all_rows = []
        for row in reader:
            try:
                end = datetime.strptime(row["Latest Optout End Date"], "%m/%d/%Y")
                if end <= datetime.now():
                    continue
            except:
                continue
            all_rows.append(row)

    # Pick diverse sample
    import random
    random.seed(42)
    random.shuffle(all_rows)

    for row in all_rows:
        spec = row["Specialty"]
        state = row["State Code"]
        # Prefer diversity
        if spec not in seen_specialties or state not in seen_states or len(rows) < n:
            rows.append(row)
            seen_specialties.add(spec)
            seen_states.add(state)
            if len(rows) >= n:
                break

    return rows


def search_google_places(first, last, specialty, city, state, api_key):
    """Google Places API (New) — Text Search."""
    query = f"Dr {first} {last} {specialty} {city} {state}"

    url = "https://places.googleapis.com/v1/places:searchText"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.rating,places.userRatingCount,places.googleMapsUri"
    }
    body = json.dumps({"textQuery": query, "maxResultCount": 3}).encode()

    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
            places = data.get("places", [])
            if places:
                p = places[0]
                return {
                    "found": True,
                    "query": query,
                    "matched_name": p.get("displayName", {}).get("text", ""),
                    "address": p.get("formattedAddress", ""),
                    "website": p.get("websiteUri", ""),
                    "phone": p.get("nationalPhoneNumber", ""),
                    "rating": p.get("rating", ""),
                    "reviews": p.get("userRatingCount", ""),
                    "maps_url": p.get("googleMapsUri", ""),
                    "total_results": len(places)
                }
            return {"found": False, "query": query, "error": "no results"}
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:300]
        return {"found": False, "query": query, "error": f"HTTP {e.code}: {body}"}


def search_exa(first, last, specialty, city, state, api_key):
    """Exa AI Search API."""
    query = f"{first} {last} {specialty} practice {city} {state}"

    url = "https://api.exa.ai/search"
    headers = {
        "Content-Type": "application/json",
        "x-api-key": api_key,
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
                practice_url = ""
                practice_title = ""
                all_urls = []
                for r in results:
                    rurl = r.get("url", "")
                    rtitle = r.get("title", "")
                    all_urls.append({"url": rurl, "title": rtitle})
                    if not practice_url:
                        from urllib.parse import urlparse
                        domain = urlparse(rurl).netloc.replace("www.", "")
                        if domain not in AGGREGATOR_DOMAINS:
                            practice_url = rurl
                            practice_title = rtitle

                return {
                    "found": True,
                    "query": query,
                    "practice_website": practice_url,
                    "practice_title": practice_title,
                    "top_result_url": results[0].get("url", ""),
                    "top_result_title": results[0].get("title", ""),
                    "is_aggregator": practice_url != results[0].get("url", ""),
                    "all_urls": all_urls,
                    "total_results": len(results)
                }
            return {"found": False, "query": query, "error": "no results"}
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:300]
        return {"found": False, "query": query, "error": f"HTTP {e.code}: {body}"}


def main():
    if not GOOGLE_API_KEY and not EXA_API_KEY:
        print("❌ No API keys. Set env vars:")
        print("   export GOOGLE_PLACES_API_KEY=your_key")
        print("   export EXA_API_KEY=your_key")
        sys.exit(1)

    print(f"Google Places: {'✅' if GOOGLE_API_KEY else '⏭️  skipped'}")
    print(f"Exa AI:        {'✅' if EXA_API_KEY else '⏭️  skipped'}")

    sample = load_sample(10)
    print(f"\nTesting {len(sample)} providers:\n")
    print("=" * 80)

    results = []
    google_websites = 0
    exa_websites = 0

    for i, row in enumerate(sample):
        first = row["First Name"]
        last = row["Last Name"]
        name = f"{first} {last}"
        spec = row["Specialty"]
        city = row["City Name"]
        state = row["State Code"]
        npi = row["npi"]

        print(f"\n[{i+1}/10] {name} | {spec} | {city}, {state} | NPI: {npi}")
        print("-" * 70)

        result = {"npi": npi, "name": name, "specialty": spec, "city": city, "state": state}

        if GOOGLE_API_KEY:
            gp = search_google_places(first, last, spec, city, state, GOOGLE_API_KEY)
            result["google"] = gp
            if gp.get("website"):
                google_websites += 1
                print(f"  Google ✅ {gp['website']}")
                print(f"         matched: {gp.get('matched_name', '')} | {gp.get('phone', '')}")
            else:
                print(f"  Google ❌ {gp.get('error', 'no website')}")
            time.sleep(0.3)

        if EXA_API_KEY:
            ex = search_exa(first, last, spec, city, state, EXA_API_KEY)
            result["exa"] = ex
            if ex.get("practice_website"):
                exa_websites += 1
                print(f"  Exa    ✅ {ex['practice_website']}")
                if ex.get("is_aggregator"):
                    print(f"         (top result was aggregator: {ex['top_result_url']})")
            elif ex.get("top_result_url"):
                print(f"  Exa    ⚠️  top result is aggregator: {ex['top_result_url']}")
            else:
                print(f"  Exa    ❌ {ex.get('error', 'no results')}")
            time.sleep(0.3)

        results.append(result)

    # Summary
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    if GOOGLE_API_KEY:
        print(f"Google Places: {google_websites}/10 found practice website ({google_websites*10}%)")
    if EXA_API_KEY:
        print(f"Exa AI:        {exa_websites}/10 found practice website ({exa_websites*10}%)")

    if GOOGLE_API_KEY and EXA_API_KEY:
        both = sum(1 for r in results if r.get("google", {}).get("website") and r.get("exa", {}).get("practice_website"))
        google_only = sum(1 for r in results if r.get("google", {}).get("website") and not r.get("exa", {}).get("practice_website"))
        exa_only = sum(1 for r in results if not r.get("google", {}).get("website") and r.get("exa", {}).get("practice_website"))
        neither = sum(1 for r in results if not r.get("google", {}).get("website") and not r.get("exa", {}).get("practice_website"))
        print(f"\nBoth found:    {both}")
        print(f"Google only:   {google_only}")
        print(f"Exa only:      {exa_only}")
        print(f"Neither:       {neither}")

    with open(OUTPUT_FILE, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nDetailed results → {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
