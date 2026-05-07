#!/usr/bin/env bash
set -euo pipefail

cd /repo

export ALIEN_STATE_DIR="/tmp/alien-test"
export ALIEN_CONFIG_PATH="${ALIEN_STATE_DIR}/alien.json"

echo "==> Build"
if ! pnpm build >/tmp/alien-cleanup-build.log 2>&1; then
  cat /tmp/alien-cleanup-build.log
  exit 1
fi

echo "==> Seed state"
mkdir -p "${ALIEN_STATE_DIR}/credentials"
mkdir -p "${ALIEN_STATE_DIR}/agents/main/sessions"
echo '{}' >"${ALIEN_CONFIG_PATH}"
echo 'creds' >"${ALIEN_STATE_DIR}/credentials/marker.txt"
echo 'session' >"${ALIEN_STATE_DIR}/agents/main/sessions/sessions.json"

echo "==> Reset (config+creds+sessions)"
if ! pnpm alien reset --scope config+creds+sessions --yes --non-interactive >/tmp/alien-cleanup-reset.log 2>&1; then
  cat /tmp/alien-cleanup-reset.log
  exit 1
fi

test ! -f "${ALIEN_CONFIG_PATH}"
test ! -d "${ALIEN_STATE_DIR}/credentials"
test ! -d "${ALIEN_STATE_DIR}/agents/main/sessions"

echo "==> Recreate minimal config"
mkdir -p "${ALIEN_STATE_DIR}/credentials"
echo '{}' >"${ALIEN_CONFIG_PATH}"

echo "==> Uninstall (state only)"
if ! pnpm alien uninstall --state --yes --non-interactive >/tmp/alien-cleanup-uninstall.log 2>&1; then
  cat /tmp/alien-cleanup-uninstall.log
  exit 1
fi

test ! -d "${ALIEN_STATE_DIR}"

echo "OK"
