#!/usr/bin/env python3
"""
Bulk ingest FL opt-out providers via Twenty REST API.
Uses /api/batch endpoint or /api/objects/optOutProviders/batch.
"""
import json, os, sys, ssl, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading, time

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

TOKEN = os.environ.get("TWENTY_API_KEY", "")
BASE_URL = os.environ.get("TWENTY_BASE_URL", "https://20.beenex.cloud")
BATCHES_DIR = str(Path(__file__).parent / "twenty_batches")

if not TOKEN:
    print("❌ Missing TWENTY_API_KEY in environment or .env", file=sys.stderr)
    sys.exit(1)

lock = threading.Lock()
stats = {"created": 0, "failed": 0, "errors": [], "batch_done": 0}

def rest_call(method, path, body=None):
    """Call Twenty REST API."""
    url = f"{BASE_URL}{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {TOKEN}"
        },
        method=method
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:300]
        return {"error": f"HTTP {e.code}", "body": body}
    except Exception as e:
        return {"error": str(e)}


def create_batch(batch_idx, records):
    """Send a batch of records to the REST API."""
    result = rest_call("POST", "/api/objects/optOutProviders/batch", records)
    
    with lock:
        stats["batch_done"] += 1
        if "error" in result:
            stats["failed"] += len(records)
            stats["errors"].append(f"Batch {batch_idx}: {result.get('error', '')} - {result.get('body', '')[:100]}")
        else:
            created = result.get("data", {}).get("createOptOutProviders", [])
            if isinstance(created, list):
                stats["created"] += len(created)
            else:
                stats["created"] += len(records)
        
        if stats["batch_done"] % 10 == 0:
            print(f"  [{stats['batch_done']}/111] created: {stats['created']}, failed: {stats['failed']}")
    
    return result


def main():
    # Load remaining batches (2-112)
    batches = []
    for i in range(2, 113):
        with open(os.path.join(BATCHES_DIR, f"batch_{i:03d}.json")) as f:
            batches.append((i, json.load(f)["records"]))
    
    total = sum(len(b[1]) for b in batches)
    print(f"Ingesting {total} records in {len(batches)} batches via REST API...")
    
    # First test with one batch
    test = rest_call("GET", "/api/objects/optOutProviders?limit=1")
    print(f"API test: {json.dumps(test)[:200]}")
    
    # Try batch create via REST
    test_batch = rest_call("POST", "/api/objects/optOutProviders/batch", batches[0][1])
    print(f"Batch test: {json.dumps(test_batch)[:300]}")


if __name__ == "__main__":
    main()
