#!/usr/bin/env bash

set -euo pipefail

# TGIS pod bootstrap script
# Usage:
#   bash scripts/setup_tgis.sh
#   bash scripts/setup_tgis.sh --setup-aitk
#   bash scripts/setup_tgis.sh --setup-aitk --rebuild-aitk
#
# Notes:
# - Designed for RunPod + Network Volume.
# - Rebuilds .venv_tgis by default to avoid broken venv after pod restarts.
# - AI Toolkit setup is optional (use --setup-aitk).

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

ok()    { echo -e "${GREEN}  [OK] $1${NC}"; }
warn()  { echo -e "${YELLOW}  [WARN] $1${NC}"; }
err()   { echo -e "${RED}  [ERR] $1${NC}"; }
info()  { echo -e "${CYAN}  [INFO] $1${NC}"; }
step()  { echo -e "\n${BOLD}${BLUE}== $1 ==${NC}"; }

ERRORS=0
add_error() { err "$1"; ERRORS=$((ERRORS + 1)); }

PROJECT="/workspace/epic-insight-engine"
WORKSPACE="/workspace"
VENV_TGIS="/workspace/.venv_tgis"
VENV_AITK="/workspace/.venv_aitk"
AITK_REPO="/workspace/ai-toolkit"
SETUP_AITK=false
REBUILD_AITK=false
REBUILD_TGIS=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      PROJECT="$2"
      shift 2
      ;;
    --setup-aitk)
      SETUP_AITK=true
      shift
      ;;
    --rebuild-aitk)
      REBUILD_AITK=true
      shift
      ;;
    --no-rebuild-tgis)
      REBUILD_TGIS=false
      shift
      ;;
    -h|--help)
      cat <<'EOF'
Usage: bash scripts/setup_tgis.sh [options]

Options:
  --project <path>      Project path (default: /workspace/epic-insight-engine)
  --setup-aitk          Also prepare AI Toolkit repo + .venv_aitk
  --rebuild-aitk        Force recreate .venv_aitk
  --no-rebuild-tgis     Do not force recreate .venv_tgis
EOF
      exit 0
      ;;
    *)
      add_error "Unknown argument: $1"
      exit 1
      ;;
  esac
done

ARTIFACTS="$PROJECT/ml/tgis/artifacts"
ENV_FILE="$PROJECT/ml/tgis/deploy/worker.env"
ENV_EXAMPLE="$PROJECT/ml/tgis/deploy/worker.env.example"
CONFIG_FILE="$PROJECT/ml/tgis/configs/base.yaml"
REQ_MAIN="$PROJECT/ml/tgis/requirements.txt"
REQ_CLOUD="$PROJECT/ml/tgis/requirements-cloud.txt"

CRITICAL_FILES=(
  "$ARTIFACTS/cloud/visual_clusters.csv"
  "$ARTIFACTS/training_metadata.csv"
  "$ARTIFACTS/training_metadata_report.json"
)

step "1/6 Workspace and disk"

if [[ ! -d "$WORKSPACE" ]]; then
  add_error "Workspace not found: $WORKSPACE"
  exit 1
fi

df -h "$WORKSPACE" | tail -1 | awk '{print "  disk: total="$2", used="$3", free="$4", used%="$5}'

for d in epic-insight-engine ai-toolkit .venv_tgis .venv_aitk; do
  if [[ -e "$WORKSPACE/$d" ]]; then
    size="$(du -sh "$WORKSPACE/$d" 2>/dev/null | cut -f1 || true)"
    ok "$d present ${size:+($size)}"
  else
    warn "$d not present"
  fi
done

if [[ ! -d "$PROJECT" ]]; then
  add_error "Project missing: $PROJECT"
  exit 1
fi
ok "Project found: $PROJECT"

step "2/6 Critical TGIS artifacts"

for f in "${CRITICAL_FILES[@]}"; do
  if [[ -f "$f" ]]; then
    ls -lh "$f" | awk '{print "  " $9 "  size=" $5 "  modified=" $6 " " $7 " " $8}'
  else
    warn "Missing artifact: $f"
  fi
done

REPORT="$ARTIFACTS/training_metadata_report.json"
if [[ -f "$REPORT" ]]; then
  info "training_metadata_report summary"
  python - <<PY
import json
p = r"$REPORT"
try:
    r = json.load(open(p, "r", encoding="utf-8"))
    print("  rows_total:", r.get("rows_total"))
    print("  clusters:", r.get("clusters"))
    print("  use_vision:", r.get("use_vision"))
    byc = r.get("by_cluster", {})
    for name, val in sorted(byc.items(), key=lambda x: x[1], reverse=True):
        bar = "#" * max(1, int(val / 300))
        print(f"  {name:<15} {val:>6}  {bar}")
except Exception as e:
    print("  failed to parse report:", e)
PY
fi

step "3/6 Build .venv_tgis and install dependencies"

deactivate 2>/dev/null || true

if [[ "$REBUILD_TGIS" == "true" || ! -x "$VENV_TGIS/bin/python" ]]; then
  info "Recreating $VENV_TGIS"
  rm -rf "$VENV_TGIS"
  python -m venv "$VENV_TGIS"
else
  info "Keeping existing $VENV_TGIS"
fi

# shellcheck disable=SC1090
source "$VENV_TGIS/bin/activate"
python -m pip install --upgrade pip

if [[ -f "$REQ_MAIN" ]]; then
  python -m pip install -r "$REQ_MAIN"
  ok "Installed requirements.txt"
else
  add_error "Missing requirements file: $REQ_MAIN"
fi

if [[ -f "$REQ_CLOUD" ]]; then
  python -m pip install -r "$REQ_CLOUD"
  ok "Installed requirements-cloud.txt"
else
  add_error "Missing requirements file: $REQ_CLOUD"
fi

step "4/6 Environment and preflight"

if [[ ! -f "$ENV_FILE" ]]; then
  warn "worker.env not found at $ENV_FILE"
  if [[ -f "$ENV_EXAMPLE" ]]; then
    warn "Copy and edit first:"
    echo "  cp $ENV_EXAMPLE $ENV_FILE"
  fi
  add_error "Cannot continue preflight without worker.env"
else
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  ok "Loaded env: $ENV_FILE"
fi

export PYTHONPATH="$PROJECT"
cd "$PROJECT"
ok "cwd=$PROJECT"

if [[ -f "$CONFIG_FILE" ]]; then
  if python -m ml.tgis.train.preflight_check --config "$CONFIG_FILE"; then
    ok "preflight_check passed"
  else
    add_error "preflight_check failed"
  fi
else
  add_error "Missing config file: $CONFIG_FILE"
fi

step "5/6 Optional AI Toolkit setup"

if [[ "$SETUP_AITK" == "true" ]]; then
  if [[ ! -d "$AITK_REPO/.git" ]]; then
    info "Cloning AI Toolkit repo"
    git clone https://github.com/ostris/ai-toolkit.git "$AITK_REPO"
  else
    info "AI Toolkit repo already present"
  fi

  if [[ "$REBUILD_AITK" == "true" || ! -x "$VENV_AITK/bin/python" ]]; then
    info "Recreating $VENV_AITK"
    rm -rf "$VENV_AITK"
    python -m venv "$VENV_AITK"
  fi

  # shellcheck disable=SC1090
  source "$VENV_AITK/bin/activate"
  python -m pip install --upgrade pip

  # Recommended by AI Toolkit README.
  python -m pip install --no-cache-dir torch==2.7.0 torchvision==0.22.0 torchaudio==2.7.0 --index-url https://download.pytorch.org/whl/cu126
  python -m pip install -r "$AITK_REPO/requirements.txt"

  cd "$AITK_REPO"
  if python run.py -h >/dev/null 2>&1; then
    ok "AI Toolkit ready"
  else
    add_error "AI Toolkit validation failed (python run.py -h)"
  fi
else
  info "Skipping AI Toolkit setup (use --setup-aitk to enable)"
fi

step "6/6 Summary"

if [[ "$ERRORS" -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}TGIS setup finished with no errors.${NC}"
else
  echo -e "${YELLOW}${BOLD}TGIS setup finished with $ERRORS error(s).${NC}"
fi

echo ""
echo "Common next commands:"
echo "  source $VENV_TGIS/bin/activate"
echo "  cd $PROJECT"
echo "  python -m ml.tgis.train.preflight_check --config ml/tgis/configs/base.yaml"
echo ""
echo "For training:"
echo "  source $VENV_AITK/bin/activate"
echo "  cd $AITK_REPO"
echo "  python run.py /path/to/config.yaml"

exit "$ERRORS"
