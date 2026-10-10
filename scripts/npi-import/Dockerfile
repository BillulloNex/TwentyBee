FROM node:22-slim

WORKDIR /app

# Copy package files and install deps
COPY package.json ./
RUN npm install --production --no-fund --no-audit

# Copy application code
COPY config.mjs import.mjs ./
COPY lib/ ./lib/
COPY phases/ ./phases/

# Copy .env
COPY .env .env

# Create state directory and copy saved progress
RUN mkdir -p /app/state
COPY state/progress.json /app/state/progress.json

# Copy data files needed for remaining phases
# Quality (HCAHPS resume + remaining sources)
RUN mkdir -p /app/data/gov_data
COPY data/gov_data/cms_hcahps_patient_experience.csv /app/data/gov_data/
COPY data/gov_data/cms_timely_effective_care.csv /app/data/gov_data/
COPY data/gov_data/cms_hospital_readmissions.csv /app/data/gov_data/
COPY data/gov_data/cms_promoting_interop.csv /app/data/gov_data/

# People
RUN mkdir -p /app/data/people_sources
COPY data/people_sources/cms_doctors_clinicians.csv /app/data/people_sources/

# Enrichment
RUN mkdir -p /app/data/nppes_raw
COPY data/nppes_raw/nppes_full.zip /app/data/nppes_raw/

# Run all phases — progress.json auto-skips completed ones
CMD ["node", "import.mjs"]
