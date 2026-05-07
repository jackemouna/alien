#!/usr/bin/env bash
# Verifies embedded Pi bundle MCP tool materialization and tool-policy behavior
# inside the package-installed functional E2E image.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"
IMAGE_NAME="$(docker_e2e_resolve_image "alien-pi-bundle-mcp-tools-e2e" ALIEN_IMAGE)"
CONTAINER_NAME="alien-pi-bundle-mcp-tools-e2e-$$"
RUN_LOG="$(mktemp -t alien-pi-bundle-mcp-tools-log.XXXXXX)"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -f "$RUN_LOG"
}
trap cleanup EXIT

docker_e2e_build_or_reuse "$IMAGE_NAME" pi-bundle-mcp-tools
ALIEN_TEST_STATE_SCRIPT_B64="$(docker_e2e_test_state_shell_b64 pi-bundle-mcp-tools empty)"

echo "Running in-container Pi bundle MCP tool availability smoke..."
# Harness files are mounted read-only; the app under test comes from /app/dist.
set +e
docker_e2e_run_with_harness \
  --name "$CONTAINER_NAME" \
  -e "ALIEN_TEST_STATE_SCRIPT_B64=$ALIEN_TEST_STATE_SCRIPT_B64" \
  "$IMAGE_NAME" \
  bash -lc "set -euo pipefail
    source scripts/lib/alien-e2e-instance.sh
    alien_e2e_eval_test_state_from_b64 \"\${ALIEN_TEST_STATE_SCRIPT_B64:?missing ALIEN_TEST_STATE_SCRIPT_B64}\"
    tsx scripts/e2e/pi-bundle-mcp-tools-docker-client.ts
  " >"$RUN_LOG" 2>&1
status=${PIPESTATUS[0]}
set -e

if [ "$status" -ne 0 ]; then
  echo "Docker Pi bundle MCP tool availability smoke failed"
  cat "$RUN_LOG"
  exit "$status"
fi

cat "$RUN_LOG"
echo "OK"
