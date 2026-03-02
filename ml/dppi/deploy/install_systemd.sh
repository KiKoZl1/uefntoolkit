#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

REPO_DIR="${1:-/opt/epic-insight-engine}"
SERVICE_USER="${2:-dppi}"
SERVICE_GROUP="${3:-dppi}"
ENV_FILE="/etc/dppi/worker.env"

if [[ ! -d "${REPO_DIR}" ]]; then
  echo "Repo dir not found: ${REPO_DIR}" >&2
  exit 1
fi

install -d -m 0755 /etc/dppi
install -d -m 0755 /var/log/dppi

if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "${SERVICE_USER}"
fi

cat > /etc/systemd/system/dppi-worker.service <<EOF
[Unit]
Description=DPPI Worker Tick
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
WorkingDirectory=${REPO_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/bash -lc 'source .venv/bin/activate && python ml/dppi/pipelines/worker_tick.py --config ml/dppi/configs/base.yaml --channel production'
StandardOutput=append:/var/log/dppi/worker.log
StandardError=append:/var/log/dppi/worker.err.log
TimeoutStartSec=20min
Nice=10

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/dppi-worker.timer <<'EOF'
[Unit]
Description=DPPI Worker Tick (every 10 min)

[Timer]
OnBootSec=2min
OnUnitActiveSec=10min
Persistent=true
Unit=dppi-worker.service

[Install]
WantedBy=timers.target
EOF

chown -R "${SERVICE_USER}:${SERVICE_GROUP}" /var/log/dppi
chmod 0600 "${ENV_FILE}" || true

systemctl daemon-reload
systemctl enable --now dppi-worker.timer

echo "Installed."
echo "Check status:"
echo "  systemctl status dppi-worker.timer"
echo "  journalctl -u dppi-worker.service -n 100 --no-pager"

