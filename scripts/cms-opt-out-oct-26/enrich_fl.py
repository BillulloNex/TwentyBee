#!/usr/bin/env python3
"""
Enrich FL providers with website URLs — FAST concurrent version.
Uses 20 threads for Exa + URL validation in parallel.
"""

import csv, json, os, sys, ssl, threading
import urllib.request, urllib.error
from datetime import datetime
from urllib.parse import urlparse
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE_DIR = "/Users/thomasthemaker/Development/ComfySpace/playground/TwentyBee/scripts/cms-opt-out-oct-26"
CONSOLIDATED = os.path.join(BASE_DIR, "cms_opt_out_consolidated.csv")
OUTPUT = os.path.join(BASE_DIR, "cms_opt_out_fl_enriched.csv")
EXA_API_KEY = os.environ.get("EXA_API_KEY", "")
MAX_WORKERS = 20

AGGREGATOR_DOMAINS = {
    'psychologytoday.com','zocdoc.com','healthgrades.com','vitals.com',
    'webmd.com','npidb.org','npino.com','npiprofile.com','docinfo.org',
    'wellness.com','yelp.com','yellowpages.com','bbb.org','facebook.com',
    'linkedin.com','instagram.com','twitter.com','x.com',
    'ratemds.com','sharecare.com','doximity.com','castleconnolly.com',
    'usnews.com','google.com','maps.google.com'
}

SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

lock = threading.Lock()
progress = {"done": 0, "live": 0, "dead": 0, "not_found": 0}
sample_urls = []


def search_exa(first, last, specialty, city, state):
    query = f"{first} {last} {specialty} practice {city} {state}"
    body = json.dumps({"query": query, "numResults": 5, "type": "auto"}).encode()
    req = urllib.request.Request("https://api.exa.ai/search", data=body,
        headers={"Content-Type": "application/json", "x-api-key": EXA_API_KEY, "Accept": "application/json"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            results = json.loads(resp.read()).get("results", [])
            for r in results:
                rurl = r.get("url", "")
                domain = urlparse(rurl).netloc.replace("www.", "")
                if domain not in AGGREGATOR_DOMAINS:
                    return rurl
            if results:
                return results[0].get("url", "")
    except:
        pass
    return ""


def validate_url(url):
    if not url:
        return False, "no_url"
    try:
        req = urllib.request.Request(url, method="HEAD",
            headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"})
        resp = urllib.request.urlopen(req, timeout=6, context=SSL_CTX)
        return True, f"HTTP {resp.getcode()}"
    except urllib.error.HTTPError as e:
        if e.code in (403, 405):
            return True, f"HTTP {e.code}"
        return False, f"HTTP {e.code}"
    except urllib.error.URLError as e:
        return False, f"URLError"
    except:
        return False, "Error"


def process_provider(idx, row, total):
    first, last = row["First Name"], row["Last Name"]
    spec, city = row["Specialty"], row["City Name"]

    url = search_exa(first, last, spec, city, "FL")

    if url:
        is_live, status = validate_url(url)
        if is_live:
            row["Website URL"] = url
            row["URL Status"] = "live"
            with lock:
                progress["live"] += 1
                if len(sample_urls) < 15:
                    sample_urls.append((first, last, spec, city, url))
        else:
            row["Website URL"] = ""
            row["URL Status"] = f"dead: {status}"
            with lock:
                progress["dead"] += 1
    else:
        row["Website URL"] = ""
        row["URL Status"] = "not_found"
        with lock:
            progress["not_found"] += 1

    with lock:
        progress["done"] += 1
        done = progress["done"]
        if done % 200 == 0 or done == total:
            print(f"  [{done:4d}/{total}] {progress['live']} live, {progress['dead']} dead, {progress['not_found']} not found")

    return idx, row


def main():
    if not EXA_API_KEY:
        print("❌ Set EXA_API_KEY"); sys.exit(1)

    fl_rows = []
    with open(CONSOLIDATED) as f:
        for row in csv.DictReader(f):
            if row["State Code"] != "FL":
                continue
            try:
                end = datetime.strptime(row["Latest Optout End Date"], "%m/%d/%Y")
                if end <= datetime.now():
                    continue
            except:
                continue
            fl_rows.append(row)

    total = len(fl_rows)
    print(f"Processing {total} active FL providers with {MAX_WORKERS} concurrent workers...\n")

    fieldnames = list(fl_rows[0].keys())
    for col in ["Website URL", "URL Status"]:
        if col not in fieldnames:
            fieldnames.append(col)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(process_provider, i, row, total): i for i, row in enumerate(fl_rows)}
        for future in as_completed(futures):
            try:
                future.result()
            except Exception as e:
                print(f"  ⚠️  Worker error: {e}")

    with open(OUTPUT, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(fl_rows)

    print(f"\n{'='*60}")
    print(f"DONE — FL PROVIDERS (concurrent)")
    print(f"{'='*60}")
    print(f"Total processed: {total}")
    print(f"✅ Live URLs:    {progress['live']} ({progress['live']/total*100:.0f}%)")
    print(f"❌ Dead URLs:    {progress['dead']} ({progress['dead']/total*100:.0f}%)")
    print(f"⏭️  Not found:    {progress['not_found']} ({progress['not_found']/total*100:.0f}%)")
    print(f"Est. cost:       ${total/1000 * 7:.2f}")
    print(f"Output:          {OUTPUT}")
    print(f"File exists:     {os.path.exists(OUTPUT)}")

    print(f"\n--- SAMPLE WORKING URLs ---")
    for first, last, spec, city, url in sample_urls:
        print(f"  {first} {last} | {spec} | {city}, FL")
        print(f"    → {url}")


if __name__ == "__main__":
    main()
