#!/bin/sh
set -e

echo "=== NPI Import Container Starting ==="
echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") — Downloading data from R2..."

DATA_DIR="/app/data"
R2_BASE="${R2_PUBLIC_URL:-https://npi-import-data.aed09ddf6077b29514def05ed3d5e699.r2.cloudflarestorage.com}"

mkdir -p "$DATA_DIR/people_sources" "$DATA_DIR/nppes_raw"

# --- CMS Doctors CSV (split into 4 chunks: aa, ab, ac, ad) ---
DOCTORS_FILE="$DATA_DIR/people_sources/cms_doctors_clinicians.csv"
if [ ! -f "$DOCTORS_FILE" ]; then
  echo "Downloading CMS doctors CSV (4 chunks, ~800 MB total)..."
  for part in aa ab ac ad; do
    echo "  Downloading doctors chunk $part..."
    wget -q -O "/tmp/doctors_$part" "$R2_BASE/doctors/npi_split_doctors_$part"
  done
  echo "  Reassembling..."
  cat /tmp/doctors_aa /tmp/doctors_ab /tmp/doctors_ac /tmp/doctors_ad > "$DOCTORS_FILE"
  rm -f /tmp/doctors_*
  echo "✓ CMS doctors ready ($(du -sh "$DOCTORS_FILE" | cut -f1))"
else
  echo "✓ CMS doctors already present"
fi

# --- NPPES zip (split into 5 chunks: aa, ab, ac, ad, ae) ---
NPPES_FILE="$DATA_DIR/nppes_raw/nppes_full.zip"
if [ ! -f "$NPPES_FILE" ]; then
  echo "Downloading NPPES zip (5 chunks, ~1.1 GB total)..."
  for part in aa ab ac ad ae; do
    echo "  Downloading NPPES chunk $part..."
    wget -q -O "/tmp/nppes_$part" "$R2_BASE/nppes/npi_split_nppes_$part"
  done
  echo "  Reassembling..."
  cat /tmp/nppes_aa /tmp/nppes_ab /tmp/nppes_ac /tmp/nppes_ad /tmp/nppes_ae > "$NPPES_FILE"
  rm -f /tmp/nppes_*
  echo "✓ NPPES zip ready ($(du -sh "$NPPES_FILE" | cut -f1))"
else
  echo "✓ NPPES zip already present"
fi

echo ""
echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") — Data download complete. Starting import..."
echo "  Progress state: $(cat /app/state/progress.json | grep currentPhase)"
echo ""

# Run all phases — progress.json will auto-skip completed phases
exec node import.mjs
