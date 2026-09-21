#!/bin/bash
set -e

cd "$(dirname "$0")"

npm --prefix backend install
npm --prefix frontend install
npm --prefix frontend run build

mkdir -p /var/www/spectra/frontend
cp -R frontend/dist/* /var/www/spectra/frontend/
cp nginx.conf /etc/nginx/conf.d/spectra.conf

if command -v pm2 >/dev/null 2>&1; then
  pm2 restart spectra-backend || pm2 start backend/src/server.js --name spectra-backend --watch
else
  echo "PM2 not installed. Install it with: npm install -g pm2"
fi

nginx -s reload || service nginx restart || echo "Nginx not installed or not running on this system"
