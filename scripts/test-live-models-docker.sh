#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="${SPECIAL_AGENT_IMAGE:-${SPECIAL_AGENT_IMAGE:-special-agent:local}}"
CONFIG_DIR="${SPECIAL_AGENT_CONFIG_DIR:-${SPECIAL_AGENT_CONFIG_DIR:-$HOME/.special-agent}}"
WORKSPACE_DIR="${SPECIAL_AGENT_WORKSPACE_DIR:-${SPECIAL_AGENT_WORKSPACE_DIR:-$HOME/.special-agent/workspace}}"
PROFILE_FILE="${SPECIAL_AGENT_PROFILE_FILE:-${SPECIAL_AGENT_PROFILE_FILE:-$HOME/.profile}}"

PROFILE_MOUNT=()
if [[ -f "$PROFILE_FILE" ]]; then
  PROFILE_MOUNT=(-v "$PROFILE_FILE":/home/node/.profile:ro)
fi

echo "==> Build image: $IMAGE_NAME"
docker build -t "$IMAGE_NAME" -f "$ROOT_DIR/Dockerfile" "$ROOT_DIR"

echo "==> Run live model tests (profile keys)"
docker run --rm -t \
  --entrypoint bash \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e HOME=/home/node \
  -e NODE_OPTIONS=--disable-warning=ExperimentalWarning \
  -e SPECIAL_AGENT_LIVE_TEST=1 \
  -e SPECIAL_AGENT_LIVE_MODELS="${SPECIAL_AGENT_LIVE_MODELS:-${SPECIAL_AGENT_LIVE_MODELS:-all}}" \
  -e SPECIAL_AGENT_LIVE_PROVIDERS="${SPECIAL_AGENT_LIVE_PROVIDERS:-${SPECIAL_AGENT_LIVE_PROVIDERS:-}}" \
  -e SPECIAL_AGENT_LIVE_MODEL_TIMEOUT_MS="${SPECIAL_AGENT_LIVE_MODEL_TIMEOUT_MS:-${SPECIAL_AGENT_LIVE_MODEL_TIMEOUT_MS:-}}" \
  -e SPECIAL_AGENT_LIVE_REQUIRE_PROFILE_KEYS="${SPECIAL_AGENT_LIVE_REQUIRE_PROFILE_KEYS:-${SPECIAL_AGENT_LIVE_REQUIRE_PROFILE_KEYS:-}}" \
  -v "$CONFIG_DIR":/home/node/.special-agent \
  -v "$WORKSPACE_DIR":/home/node/.special-agent/workspace \
  "${PROFILE_MOUNT[@]}" \
  "$IMAGE_NAME" \
  -lc "set -euo pipefail; [ -f \"$HOME/.profile\" ] && source \"$HOME/.profile\" || true; cd /app && pnpm test:live"
