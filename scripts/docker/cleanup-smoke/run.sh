#!/usr/bin/env bash
set -euo pipefail

cd /repo

export SPECIAL_AGENT_STATE_DIR="/tmp/special-agent-test"
export SPECIAL_AGENT_CONFIG_PATH="${SPECIAL_AGENT_STATE_DIR}/special-agent.json"

echo "==> Build"
pnpm build

echo "==> Seed state"
mkdir -p "${SPECIAL_AGENT_STATE_DIR}/credentials"
mkdir -p "${SPECIAL_AGENT_STATE_DIR}/agents/main/sessions"
echo '{}' >"${SPECIAL_AGENT_CONFIG_PATH}"
echo 'creds' >"${SPECIAL_AGENT_STATE_DIR}/credentials/marker.txt"
echo 'session' >"${SPECIAL_AGENT_STATE_DIR}/agents/main/sessions/sessions.json"

echo "==> Reset (config+creds+sessions)"
pnpm special-agent reset --scope config+creds+sessions --yes --non-interactive

test ! -f "${SPECIAL_AGENT_CONFIG_PATH}"
test ! -d "${SPECIAL_AGENT_STATE_DIR}/credentials"
test ! -d "${SPECIAL_AGENT_STATE_DIR}/agents/main/sessions"

echo "==> Recreate minimal config"
mkdir -p "${SPECIAL_AGENT_STATE_DIR}/credentials"
echo '{}' >"${SPECIAL_AGENT_CONFIG_PATH}"

echo "==> Uninstall (state only)"
pnpm special-agent uninstall --state --yes --non-interactive

test ! -d "${SPECIAL_AGENT_STATE_DIR}"

echo "OK"
