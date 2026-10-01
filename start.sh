#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -f .env.local ]]; then
  cp .env.example .env.local
  echo "Created .env.local. Add OPENAI_API_KEY and a private POC_ACCESS_CODE, then run ./start.sh again."
  exit 0
fi
node --env-file=.env.local server.mjs
