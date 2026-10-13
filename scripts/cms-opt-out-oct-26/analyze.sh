#!/bin/bash
BASE="extracted/Opt Out Affidavits"

echo "=== MONTHLY ROW COUNTS ==="
for dir in $(ls -d "$BASE"/*/  | sort); do
  month=$(basename "$dir")
  csv=$(find "$dir" -name "*.csv" | head -1)
  if [ -n "$csv" ]; then
    count=$(($(wc -l < "$csv") - 1))
    echo "$month: $count providers"
  fi
done

echo ""
echo "=== LATEST FILE (2026-08) DETAILED ANALYSIS ==="
LATEST=$(find "$BASE/2026-08" -name "*.csv" | head -1)

echo ""
echo "--- Total records ---"
tail -n +2 "$LATEST" | wc -l

echo ""
echo "--- Top 20 Specialties ---"
tail -n +2 "$LATEST" | awk -F',' '{print $4}' | sort | uniq -c | sort -rn | head -20

echo ""
echo "--- Top 20 States ---"
tail -n +2 "$LATEST" | awk -F',' '{print $10}' | sort | uniq -c | sort -rn | head -20

echo ""
echo "--- Eligible to Order and Refer breakdown ---"
tail -n +2 "$LATEST" | awk -F',' '{print $12}' | sort | uniq -c | sort -rn

echo ""
echo "--- Opt-out year distribution (Effective Date year) ---"
tail -n +2 "$LATEST" | awk -F',' '{split($5,d,"/"); print d[3]}' | sort | uniq -c | sort -k2n

echo ""
echo "--- Top 20 Cities ---"
tail -n +2 "$LATEST" | awk -F',' '{print $9}' | sort | uniq -c | sort -rn | head -20

echo ""
echo "=== UNIQUE NPI COUNTS OVER TIME (first/last 5 months) ==="
months=($(ls -d "$BASE"/*/ | sort))
for i in 0 1 2 3 4; do
  dir="${months[$i]}"
  month=$(basename "$dir")
  csv=$(find "$dir" -name "*.csv" | head -1)
  if [ -n "$csv" ]; then
    npis=$(tail -n +2 "$csv" | awk -F',' '{print $3}' | sort -u | wc -l)
    echo "$month: $npis unique NPIs"
  fi
done
echo "..."
total=${#months[@]}
for i in $(seq $((total-5)) $((total-1))); do
  dir="${months[$i]}"
  month=$(basename "$dir")
  csv=$(find "$dir" -name "*.csv" | head -1)
  if [ -n "$csv" ]; then
    npis=$(tail -n +2 "$csv" | awk -F',' '{print $3}' | sort -u | wc -l)
    echo "$month: $npis unique NPIs"
  fi
done
