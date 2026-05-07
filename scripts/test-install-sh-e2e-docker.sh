#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-build.sh"
IMAGE_NAME="${ALIEN_INSTALL_E2E_IMAGE:-alien-install-e2e:local}"
INSTALL_URL="${ALIEN_INSTALL_URL:-https://alien.bot/install.sh}"

OPENAI_API_KEY="${OPENAI_API_KEY:-}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
ANTHROPIC_API_TOKEN="${ANTHROPIC_API_TOKEN:-}"
ALIEN_E2E_MODELS="${ALIEN_E2E_MODELS:-}"

echo "==> Build image: $IMAGE_NAME"
docker_build_run install-e2e-build \
  -t "$IMAGE_NAME" \
  -f "$ROOT_DIR/scripts/docker/install-sh-e2e/Dockerfile" \
  "$ROOT_DIR/scripts/docker"

echo "==> Run E2E installer test"
docker run --rm \
  -e ALIEN_INSTALL_URL="$INSTALL_URL" \
  -e ALIEN_INSTALL_TAG="${ALIEN_INSTALL_TAG:-latest}" \
  -e ALIEN_E2E_MODELS="$ALIEN_E2E_MODELS" \
  -e ALIEN_INSTALL_E2E_PREVIOUS="${ALIEN_INSTALL_E2E_PREVIOUS:-}" \
  -e ALIEN_INSTALL_E2E_SKIP_PREVIOUS="${ALIEN_INSTALL_E2E_SKIP_PREVIOUS:-0}" \
  -e ALIEN_INSTALL_E2E_AGENT_TURN_TIMEOUT_SECONDS="${ALIEN_INSTALL_E2E_AGENT_TURN_TIMEOUT_SECONDS:-600}" \
  -e ALIEN_INSTALL_E2E_AGENT_TURNS_PARALLEL="${ALIEN_INSTALL_E2E_AGENT_TURNS_PARALLEL:-1}" \
  -e ALIEN_NO_ONBOARD=1 \
  -e OPENAI_API_KEY \
  -e ANTHROPIC_API_KEY \
  -e ANTHROPIC_API_TOKEN \
  "$IMAGE_NAME"
