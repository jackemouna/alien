#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"
IMAGE_NAME="$(docker_e2e_resolve_image "alien-bundled-plugin-install-uninstall-e2e" ALIEN_BUNDLED_PLUGIN_INSTALL_UNINSTALL_E2E_IMAGE)"

docker_e2e_build_or_reuse "$IMAGE_NAME" bundled-plugin-install-uninstall
ALIEN_TEST_STATE_SCRIPT_B64="$(docker_e2e_test_state_shell_b64 bundled-plugin-install-uninstall empty)"

DOCKER_ENV_ARGS=(
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  -e "ALIEN_TEST_STATE_SCRIPT_B64=$ALIEN_TEST_STATE_SCRIPT_B64"
)
for env_name in \
  ALIEN_BUNDLED_PLUGIN_SWEEP_TOTAL \
  ALIEN_BUNDLED_PLUGIN_SWEEP_INDEX \
  ALIEN_BUNDLED_PLUGIN_SWEEP_IDS \
  ALIEN_BUNDLED_PLUGIN_RUNTIME_SMOKE \
  ALIEN_BUNDLED_PLUGIN_RUNTIME_PORT_BASE \
  ALIEN_BUNDLED_PLUGIN_RUNTIME_READY_MS \
  ALIEN_BUNDLED_PLUGIN_RUNTIME_RPC_MS \
  ALIEN_BUNDLED_PLUGIN_RUNTIME_WATCHDOG_MS \
  ALIEN_BUNDLED_PLUGIN_TTS_LIVE_PROVIDER \
  OPENAI_API_KEY; do
  env_value="${!env_name:-}"
  if [[ -n "$env_value" && "$env_value" != "undefined" && "$env_value" != "null" ]]; then
    DOCKER_ENV_ARGS+=(-e "$env_name")
  fi
done

echo "Running bundled plugin install/uninstall Docker E2E..."
RUN_LOG="$(mktemp "${TMPDIR:-/tmp}/alien-bundled-plugin-install-uninstall.XXXXXX")"
if ! docker_e2e_run_with_harness \
  "${DOCKER_ENV_ARGS[@]}" \
  "$IMAGE_NAME" \
  bash scripts/e2e/lib/bundled-plugin-install-uninstall/sweep.sh >"$RUN_LOG" 2>&1
then
  cat "$RUN_LOG"
  rm -f "$RUN_LOG"
  exit 1
fi
cat "$RUN_LOG"
rm -f "$RUN_LOG"

echo "OK"
