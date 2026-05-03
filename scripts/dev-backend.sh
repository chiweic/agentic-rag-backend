#!/usr/bin/env bash
# Dev backend launcher with features_v6 unified retrieval enabled.
#
# Why this exists:
#   The prod backend container reads /mnt/data/backend/.env via
#   `env_file: .env` in docker-compose.yml. Adding RETRIEVAL_AUTO_MODE=unified
#   to .env directly would silently flip prod to unified mode the next
#   time the container is recreated — exactly what we want to avoid until
#   features_v6 Phase 2/3 frontend work is in place.
#
#   This script keeps the unified-mode flag scoped to the dev uvicorn
#   process only. .env stays untouched; prod container is unaffected.
#
# Usage:
#   ./scripts/dev-backend.sh                # listens on 0.0.0.0:8088
#   PORT=8089 ./scripts/dev-backend.sh      # custom port
#
# To turn unified mode off for a session, just run uvicorn directly:
#   uvicorn app.main:app --reload --port 8088

set -euo pipefail

PORT="${PORT:-8088}"

# features_v6 Phase 0d — magic-wand unified retrieval.
# Override the operator-controlled flag for THIS process only.
export RETRIEVAL_AUTO_MODE=unified
export MILVUS_UNIFIED_COLLECTION=rag_bot_unified_20260503t031539z
export RERANK_ENABLED=true

# Activate venv if not already active.
if [[ -z "${VIRTUAL_ENV:-}" ]]; then
  # shellcheck disable=SC1091
  source "$(dirname "$0")/../venv/bin/activate"
fi

echo "==> dev backend on :${PORT}"
echo "    RETRIEVAL_AUTO_MODE=$RETRIEVAL_AUTO_MODE"
echo "    MILVUS_UNIFIED_COLLECTION=$MILVUS_UNIFIED_COLLECTION"
echo "    RERANK_ENABLED=$RERANK_ENABLED"
echo

exec uvicorn app.main:app --reload --host 0.0.0.0 --port "$PORT"
