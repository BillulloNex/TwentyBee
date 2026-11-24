#!/usr/bin/env bash
# Posts to the BeeNex Sales Telegram topic (through the resend-inbound-webhook worker) when the disk
# is nearly full or the TwentyBee worker container has stopped. Each problem is re-announced at most every 3 hours.
set -u
URL="https://resend-inbound-webhook.thomas-aed.workers.dev/server-alert"
TOKEN=$(cat "$HOME/.config/beenex/alert-token")
STATE="$HOME/.config/beenex/alert-state"
mkdir -p "$STATE"
THRESHOLD=85
WORKER=worker-m94qqxppyqfozxwp1b6jels9

alert() {
  local key=$1 text=$2 now last
  now=$(date +%s)
  last=$(cat "$STATE/$key" 2>/dev/null || echo 0)
  [ $((now - last)) -lt 10800 ] && return
  if curl -fsS -m 20 -X POST "$URL" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      --data "$(python3 -c "import json,sys; print(json.dumps({\"text\": sys.argv[1]}))" "$text")" >/dev/null; then
    echo "$now" > "$STATE/$key"
  fi
}

used=$(df --output=pcent / | tail -1 | tr -dc 0-9)
if [ "$used" -ge "$THRESHOLD" ]; then
  alert disk "prime disk is ${used}% full ($(df -h --output=avail / | tail -1 | tr -d " ") free). At 100% the Twenty worker crashes and campaign sending stops."
else
  rm -f "$STATE/disk"
fi

running=$(docker inspect -f "{{.State.Running}}" "$WORKER" 2>/dev/null || echo missing)
if [ "$running" != "true" ]; then
  alert worker "TwentyBee worker container is not running ($running). Campaign emails and scheduled jobs are stopped. Restart: docker restart $WORKER"
else
  rm -f "$STATE/worker"
fi
