#!/usr/bin/env python3
"""
Bulk ingest FL opt-out providers directly via Twenty GraphQL API.
Uses concurrent requests for speed.
"""
import json, os, sys, ssl, urllib.request, urllib.error
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

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
API_URL = f"{BASE_URL}/api"
BATCHES_DIR = str(Path(__file__).parent / "twenty_batches")

if not TOKEN:
    print("❌ Missing TWENTY_API_KEY in environment or .env", file=sys.stderr)
    sys.exit(1)

lock = threading.Lock()
progress = {"created": 0, "failed": 0, "batch_done": 0}

MUTATION = """
mutation CreateManyOptOutProviders($data: [OptOutProviderCreateInput!]!) {
  createOptOutProviders(data: $data) {
    id
    name
  }
}
"""

def graphql_call(query, variables):
    body = json.dumps({"query": query, "variables": variables}).encode()
    req = urllib.request.Request(
        API_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {TOKEN}"
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}", "body": e.read().decode()[:500]}
    except Exception as e:
        return {"error": str(e)}


def test_api():
    """Test API connectivity and discover schema."""
    # Introspection query to find the exact mutation name
    query = """
    {
      __schema {
        mutationType {
          fields {
            name
          }
        }
      }
    }
    """
    result = graphql_call(query, {})
    if "error" in result:
        print(f"API Error: {result}")
        return False
    
    mutations = result.get("data", {}).get("__schema", {}).get("mutationType", {}).get("fields", [])
    # Find opt out provider mutations
    opt_out_mutations = [m["name"] for m in mutations if "ptOut" in m["name"] or "opt_out" in m["name"].lower() or "OptOut" in m["name"]]
    print(f"Found {len(mutations)} mutations total")
    print(f"Opt-out related mutations: {opt_out_mutations}")
    
    # Also check for create mutations
    create_mutations = [m["name"] for m in mutations if "create" in m["name"].lower()]
    print(f"Create mutations: {[m for m in create_mutations if 'ptOut' in m or 'opt' in m.lower()]}")
    
    return True


if __name__ == "__main__":
    print("Testing Twenty GraphQL API...")
    test_api()
