#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"
IMAGE_NAME="$(docker_e2e_resolve_image "alien-onboard-e2e" ALIEN_ONBOARD_E2E_IMAGE)"
ALIEN_TEST_STATE_FUNCTION_B64="$(docker_e2e_test_state_function_b64)"

docker_e2e_build_or_reuse "$IMAGE_NAME" onboard

echo "Running onboarding E2E..."
docker_e2e_run_with_harness -t \
  -e "ALIEN_TEST_STATE_FUNCTION_B64=$ALIEN_TEST_STATE_FUNCTION_B64" \
  "$IMAGE_NAME" bash scripts/e2e/lib/onboard/scenario.sh

echo "E2E complete."
