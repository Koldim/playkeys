#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/opt/playkeys}"

if [[ ! -d "$APP_DIR/.git" ]]; then
  git clone https://github.com/Koldim/playkeys.git "$APP_DIR"
fi

cd "$APP_DIR"
git pull --ff-only

if [[ ! -f .env ]]; then
  cp .env.production.example .env
  echo "Edit $APP_DIR/.env (POSTGRES_PASSWORD, ADMIN_TOKEN), then re-run."
  exit 1
fi

docker compose -f docker-compose.prod.yml --env-file .env up -d --build
docker compose -f docker-compose.prod.yml ps
