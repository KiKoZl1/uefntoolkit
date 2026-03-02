#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SERVICE_SRC="$ROOT_DIR/ml/tgis/deploy/systemd/tgis-worker.service"
TIMER_SRC="$ROOT_DIR/ml/tgis/deploy/systemd/tgis-worker.timer"
ENV_SRC="$ROOT_DIR/ml/tgis/deploy/worker.env.example"
ENV_DST="$ROOT_DIR/ml/tgis/deploy/worker.env"

if [[ ! -f "$ENV_DST" ]]; then
  cp "$ENV_SRC" "$ENV_DST"
  echo "Created $ENV_DST from example. Fill secrets before enabling timer."
fi

sudo cp "$SERVICE_SRC" /etc/systemd/system/tgis-worker.service
sudo cp "$TIMER_SRC" /etc/systemd/system/tgis-worker.timer
sudo systemctl daemon-reload
sudo systemctl enable --now tgis-worker.timer
sudo systemctl status tgis-worker.timer --no-pager

echo "TGIS worker timer installed."
