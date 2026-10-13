import gzip
import csv
import re
import pandas as pd

SOURCE_GZ = "/Users/thomasthemaker/Development/ComfySpace/playground/TwentyBee/scripts/npi-import/data/web_sources/free_company_dataset.csv.gz"
OUTPUT_CSV = "/Users/thomasthemaker/Development/ComfySpace/playground/TwentyBee/scripts/pdl-overture-cashpay/pdl_cashpay_medical_practices.csv"

SIGNALS = [
    ("Direct Primary Care", re.compile(r'\b(direct\s*primary\s*care|direct\s*primary\s*health|\bdpc\b|direct\s*medicine)\b', re.I)),
    ("Concierge Medicine", re.compile(r'\b(concierge\s*(medicine|medical|doctor|physician|pcp|care|health|pediatric|cardiology|internal|hospitalist|clinic)|concierge)\b', re.I)),
    ("Boutique / Membership Medicine", re.compile(r'\b(boutique\s*(medicine|medical|physician|health|clinic)|membership\s*(medicine|health|clinic)|retainer\s*(medicine|physician))\b', re.I)),
    ("Cash / Self Pay", re.compile(r'\b(cash\s*pay|cash\s*only|self\s*pay|private\s*pay|no\s*insurance)\b', re.I)),
    ("Functional / Integrative Medicine", re.compile(r'\b(functional\s*medicine|integrative\s*medicine|integrative\s*health|functional\s*health)\b', re.I)),
    ("Regenerative Medicine", re.compile(r'\b(regenerative\s*medicine|stem\s*cell\s*(therapy|center|clinic)|prp\s*therapy)\b', re.I)),
    ("Longevity / Anti-Aging", re.compile(r'\b(longevity\s*(center|clinic|medicine|health)|anti[-\s]aging\s*(clinic|center|medical|medicine))\b', re.I)),
]

PET_PAT = re.compile(r'\b(pet|pets|dog|dogs|cat|cats|vet|veterinary|veterinarian|animal|animals|equine)\b', re.I)
LEGAL_CORPORATE_PAT = re.compile(r'\b(md\s*pc|dmd\s*pc|dds\s*pc|dpm\s*pc|mdpc|dmdpc|ddspc)\b', re.I)

VALID_INDUSTRIES = {
    'medical practice', 'hospital & health care', 'health', 
    'alternative medicine', 'health wellness and fitness', 
    'mental health care'
}

print(f"Reading and streaming {SOURCE_GZ}...")

matches = []
processed = 0

with gzip.open(SOURCE_GZ, 'rt', encoding='utf-8', errors='replace') as f:
    reader = csv.DictReader(f)
    for row in reader:
        processed += 1
        if processed % 1000000 == 0:
            print(f"  Processed {processed:,} companies... found {len(matches)} matches so far")
            
        country = (row.get('country') or '').strip().lower()
        if country != 'united states':
            continue
            
        ind = (row.get('industry') or '').strip().lower()
        if ind not in VALID_INDUSTRIES:
            continue
            
        name = (row.get('name') or '').strip()
        if not name:
            continue
            
        if PET_PAT.search(name):
            continue
            
        matched_type = None
        matched_kw = None
        
        # Test each signal
        for label, pat in SIGNALS:
            m = pat.search(name)
            if m:
                # If matched DPC, check if it's just 'MD, PC' / 'MDPC' corporate suffix
                if label == "Direct Primary Care" and m.group(0).lower() == "dpc":
                    if LEGAL_CORPORATE_PAT.search(name):
                        continue
                matched_type = label
                matched_kw = m.group(0)
                break
                
        if matched_type:
            matches.append({
                'pdl_id': row.get('id', ''),
                'name': name,
                'cashpay_signal_type': matched_type,
                'matched_keyword': matched_kw,
                'industry': row.get('industry', ''),
                'size': row.get('size', ''),
                'founded': row.get('founded', ''),
                'locality': row.get('locality', ''),
                'region': row.get('region', ''),
                'country': row.get('country', ''),
                'website': row.get('website', ''),
                'linkedin_url': row.get('linkedin_url', '')
            })

print(f"Finished processing {processed:,} rows. Total raw matches: {len(matches):,}")

df = pd.DataFrame(matches)
# Deduplicate on name, locality, region
df.drop_duplicates(subset=['name', 'locality', 'region'], inplace=True)
df.sort_values(by=['cashpay_signal_type', 'region', 'name'], inplace=True)
df.to_csv(OUTPUT_CSV, index=False)

print(f"\nSaved {len(df):,} likely cash-pay practices to {OUTPUT_CSV}")
print("\nBreakdown by Signal Type:")
print(df['cashpay_signal_type'].value_counts().to_string())
