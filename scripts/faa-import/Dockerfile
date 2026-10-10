FROM node:22-slim

WORKDIR /app

# Copy package files and install deps
COPY package.json ./
RUN npm install --production --no-fund --no-audit

# Copy all source files
COPY . .

# Create state directory
RUN mkdir -p /app/state

# The import script is the entrypoint
CMD ["node", "import.mjs"]
