import pyarrow.parquet as pq
import pandas as pd
import re
import json

SOURCE_PARQUET = "/Users/thomasthemaker/Development/ComfySpace/playground/TwentyBee/scripts/npi-import/data/web_sources/overture_us_places.parquet"
OUTPUT_CSV = "/Users/thomasthemaker/Development/ComfySpace/playground/TwentyBee/scripts/pdl-overture-cashpay/overture_cashpay_medical_practices.csv"

# Keyword rules and categories
SIGNALS = [
    ("Direct Primary Care", re.compile(r'\b(direct\s*primary\s*care|direct\s*primary\s*health|dpc\b|direct\s*medicine)\b', re.I)),
    ("Concierge Medicine", re.compile(r'\b(concierge\s*(medicine|medical|doctor|physician|pcp|care|health|pediatric|cardiology|internal|clinic)|concierge)\b', re.I)),
    ("Boutique / Membership Medicine", re.compile(r'\b(boutique\s*(medicine|medical|physician|health|clinic)|membership\s*(medicine|health|clinic)|retainer\s*(medicine|physician))\b', re.I)),
    ("Cash / Self Pay", re.compile(r'\b(cash\s*pay|cash\s*only|self\s*pay|private\s*pay|no\s*insurance)\b', re.I)),
    ("Functional / Integrative Medicine", re.compile(r'\b(functional\s*medicine|integrative\s*medicine|integrative\s*health|functional\s*health)\b', re.I)),
    ("Regenerative Medicine", re.compile(r'\b(regenerative\s*medicine|stem\s*cell\s*(therapy|center|clinic)|prp\s*therapy)\b', re.I)),
    ("Longevity / Anti-Aging", re.compile(r'\b(longevity\s*(center|clinic|medicine|health)|anti[-\s]aging\s*(clinic|center|medical|medicine))\b', re.I)),
]

PET_PAT = re.compile(r'\b(pet|pets|dog|dogs|cat|cats|vet|veterinary|veterinarian|animal|animals|equine)\b', re.I)
EXCLUDE_CATEGORIES = {
    'veterinarian', 'animal_hospital', 'pet_hospice', 'emergency_pet_hospital',
    'hospital_equipment_and_supplies', 'sperm_clinic', 'dentistry_schools'
}

print(f"Reading {SOURCE_PARQUET}...")
table = pq.read_table(SOURCE_PARQUET)
df = table.to_pandas()
print(f"Total rows in source: {len(df):,}")

matches = []

for idx, row in df.iterrows():
    name = str(row['name']) if pd.notna(row['name']) else ""
    cat = str(row['category']) if pd.notna(row['category']) else ""
    
    if not name or cat in EXCLUDE_CATEGORIES:
        continue
    
    # Exclude pets/veterinary
    if PET_PAT.search(name):
        continue
    
    matched_type = None
    matched_kw = None
    
    for label, pat in SIGNALS:
        m = pat.search(name)
        if m:
            matched_type = label
            matched_kw = m.group(0)
            break
            
    if matched_type:
        alt_cats = row['alt_categories']
        alt_cats_str = json.dumps(list(alt_cats)) if isinstance(alt_cats, (list, tuple)) and len(alt_cats) > 0 else ""
        
        matches.append({
            'overture_id': row['id'],
            'name': name,
            'cashpay_signal_type': matched_type,
            'matched_keyword': matched_kw,
            'category': cat,
            'alt_categories': alt_cats_str,
            'address': row.get('address', '') or '',
            'city': row.get('city', '') or '',
            'state': row.get('state', '') or '',
            'zip': row.get('zip', '') or '',
            'phone': row.get('phone', '') or '',
            'website': row.get('website', '') or '',
            'social_url': row.get('social_url', '') or '',
            'confidence': row.get('confidence', '') or '',
            'latitude': row.get('latitude', '') or '',
            'longitude': row.get('longitude', '') or ''
        })

matched_df = pd.DataFrame(matches)
# Deduplicate on name + city + state
matched_df = matched_df.drop_duplicates(subset=['name', 'city', 'state'])
matched_df.sort_values(by=['cashpay_signal_type', 'state', 'name'], inplace=True)
matched_df.to_csv(OUTPUT_CSV, index=False)

print(f"Saved {len(matched_df):,} likely cash-pay practices to {OUTPUT_CSV}")
print("\nBreakdown by Signal Type:")
print(matched_df['cashpay_signal_type'].value_counts().to_string())
