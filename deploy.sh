#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/gpt.music-book.me"
PM2_APP_NAME="gpt-music-book"
BRANCH="${1:-main}"

cd "$APP_DIR"

echo "[deploy] app dir: $APP_DIR"
echo "[deploy] branch: $BRANCH"

git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

node --check server.js
node --check lib/orders.js
node --check scripts/import-tilda-orders.js
node --check public/app.js

pm2 restart "$PM2_APP_NAME"
pm2 show "$PM2_APP_NAME" | sed -n '1,20p'

echo "[deploy] done"
