#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"
IMAGE_NAME="$(docker_e2e_resolve_image "alien-kitchen-sink-plugin-e2e" ALIEN_KITCHEN_SINK_PLUGIN_E2E_IMAGE)"

docker_e2e_build_or_reuse "$IMAGE_NAME" kitchen-sink-plugin
ALIEN_TEST_STATE_SCRIPT_B64="$(docker_e2e_test_state_shell_b64 kitchen-sink-plugin empty)"
KITCHEN_SINK_NPM_SPEC="${ALIEN_KITCHEN_SINK_NPM_SPEC:-npm:@alien/kitchen-sink@latest}"
KITCHEN_SINK_NPM_MISSING_SPEC="${ALIEN_KITCHEN_SINK_NPM_MISSING_SPEC:-npm:@alien/kitchen-sink@beta}"

DEFAULT_KITCHEN_SINK_SCENARIOS="$(
  cat <<SCENARIOS
npm-latest-full|${KITCHEN_SINK_NPM_SPEC}|alien-kitchen-sink-fixture|npm|success|full
npm-latest-conformance|${KITCHEN_SINK_NPM_SPEC}|alien-kitchen-sink-fixture|npm|success|conformance|conformance
npm-latest-adversarial|${KITCHEN_SINK_NPM_SPEC}|alien-kitchen-sink-fixture|npm|success|adversarial|adversarial
npm-beta|${KITCHEN_SINK_NPM_MISSING_SPEC}|alien-kitchen-sink-fixture|npm|failure|none
clawhub-latest|clawhub:@alien/kitchen-sink@latest|alien-kitchen-sink-fixture|clawhub|success|basic
clawhub-beta|clawhub:@alien/kitchen-sink@beta|alien-kitchen-sink-fixture|clawhub|failure|none
npm-to-clawhub|clawhub:@alien/kitchen-sink@latest|alien-kitchen-sink-fixture|clawhub|success|basic||${KITCHEN_SINK_NPM_SPEC}
SCENARIOS
)"
KITCHEN_SINK_SCENARIOS="${ALIEN_KITCHEN_SINK_PLUGIN_SCENARIOS:-$DEFAULT_KITCHEN_SINK_SCENARIOS}"
MAX_MEMORY_MIB="${ALIEN_KITCHEN_SINK_MAX_MEMORY_MIB:-2048}"
MAX_CPU_PERCENT="${ALIEN_KITCHEN_SINK_MAX_CPU_PERCENT:-1200}"
CONTAINER_NAME="alien-kitchen-sink-plugin-e2e-$$"
RUN_LOG="$(mktemp "${TMPDIR:-/tmp}/alien-kitchen-sink-plugin.XXXXXX")"
STATS_LOG="$(mktemp "${TMPDIR:-/tmp}/alien-kitchen-sink-plugin-stats.XXXXXX")"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

DOCKER_ENV_ARGS=(
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  -e "ALIEN_TEST_STATE_SCRIPT_B64=$ALIEN_TEST_STATE_SCRIPT_B64"
  -e "KITCHEN_SINK_SCENARIOS=$KITCHEN_SINK_SCENARIOS"
)
if [[ "${ALIEN_KITCHEN_SINK_LIVE_CLAWHUB:-0}" = "1" ]]; then
  for env_name in \
    ALIEN_KITCHEN_SINK_LIVE_CLAWHUB \
    ALIEN_CLAWHUB_URL \
    CLAWHUB_URL \
    ALIEN_CLAWHUB_TOKEN \
    CLAWHUB_TOKEN \
    CLAWHUB_AUTH_TOKEN; do
    env_value="${!env_name:-}"
    if [[ -n "$env_value" && "$env_value" != "undefined" && "$env_value" != "null" ]]; then
      DOCKER_ENV_ARGS+=(-e "$env_name")
    fi
  done
fi

echo "Running kitchen-sink plugin Docker E2E..."
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker_e2e_harness_mount_args
docker run --name "$CONTAINER_NAME" "${DOCKER_E2E_HARNESS_ARGS[@]}" "${DOCKER_ENV_ARGS[@]}" -i "$IMAGE_NAME" bash scripts/e2e/lib/kitchen-sink-plugin/sweep.sh \
  >"$RUN_LOG" 2>&1 &
docker_pid="$!"

while kill -0 "$docker_pid" 2>/dev/null; do
  if docker inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
    docker stats --no-stream --format '{{json .}}' "$CONTAINER_NAME" >>"$STATS_LOG" 2>/dev/null || true
  fi
  sleep 2
done

set +e
wait "$docker_pid"
run_status="$?"
set -e

cat "$RUN_LOG"

node scripts/e2e/lib/docker-stats/assert-resource-ceiling.mjs "$STATS_LOG" "$MAX_MEMORY_MIB" "$MAX_CPU_PERCENT" kitchen-sink

rm -f "$RUN_LOG" "$STATS_LOG"
exit "$run_status"
