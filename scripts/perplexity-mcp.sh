#!/bin/sh
# Starts Perplexity's MCP server with the key from the git-ignored scripts/.env, so the key never lands in Pi's mcp.json.
PERPLEXITY_API_KEY="$(grep '^PERPLEXITY_API_KEY=' "$(dirname "$0")/.env" | cut -d= -f2-)" exec npx -y @perplexity-ai/mcp-server@1.3.0
