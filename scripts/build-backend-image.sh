#!/usr/bin/env bash
#
# Build a candidate backend Docker image and run Tier 1 promotion gates against
# it. ONLY tags `:latest` if every gate passes; on failure the previous good
# `:latest` is untouched and prod stays on whatever it was running.
#
# Tier 1 gates:
#   A. backend pytest passes against the to-be-vendored rag_bot
#   B. docker build succeeds
#   C. candidate container responds to /health on a test port (8089)
#
# Usage:
#   bash scripts/build-backend-image.sh                       # build + gates
#   docker compose up -d backend                              # promote to prod
#   docker tag backend-v2:previous backend-v2:latest \
#     && docker compose up -d backend                          # rollback
#
# After a successful run:
#   :latest    → the new candidate (passed gates, not yet swapped to prod)
#   :previous  → whatever :latest used to be (last-known-good)
#   <date>-rag-X-be-Y  → permanent immutable tag of this exact build
#
# Tier 2/3 gates (rag_bot pytest, partner_api E2E, retrieval recall, latency)
# can be added without changing this contract.

set -euo pipefail

# ─── Inputs ────────────────────────────────────────────────────────────────
BACKEND_DIR="${BACKEND_DIR:-/mnt/data/backend}"
RAG_BOT_DIR="${RAG_BOT_DIR:-/mnt/data/rag_bot}"
TEST_PORT="${TEST_PORT:-8089}"
NETWORK="${NETWORK:-changpt_net}"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-30}"

cd "$BACKEND_DIR"

# ─── Tag derivation ────────────────────────────────────────────────────────
RAG_BOT_SHA=$(git -C "$RAG_BOT_DIR" rev-parse --short HEAD 2>/dev/null || echo nogit)
BACKEND_SHA=$(git rev-parse --short HEAD)
TAG="$(date +%Y%m%d)-rag-${RAG_BOT_SHA}-be-${BACKEND_SHA}"

# Capture last-known-good BEFORE we change anything. If `:latest` doesn't
# exist (first build), LKG_ID stays empty and the previous-tag dance is
# skipped. Two-step pattern (test then read) avoids the `|| echo none`
# trick whose stdout-capture leaves a stray newline that confuses string
# compares.
if docker image inspect backend-v2:latest >/dev/null 2>&1; then
    LKG_ID=$(docker image inspect backend-v2:latest --format '{{.Id}}')
else
    LKG_ID=""
fi

echo "→ candidate:       backend-v2:$TAG"
echo "→ rag_bot source:  $RAG_BOT_DIR (sha $RAG_BOT_SHA)"
echo "→ backend source:  $BACKEND_DIR (sha $BACKEND_SHA)"
echo "→ last-known-good: ${LKG_ID:-(none — first build)}"
echo

# ─── Cleanup helper ────────────────────────────────────────────────────────
cleanup_candidate() {
    docker rm -f backend-v2-candidate >/dev/null 2>&1 || true
    docker rmi backend-v2:candidate >/dev/null 2>&1 || true
}
on_exit() {
    rc=$?
    if [ $rc -ne 0 ]; then
        echo
        echo "✗ aborted (rc=$rc) — :latest untouched (still ${LKG_ID:-none})"
        cleanup_candidate
    fi
}
trap on_exit EXIT

# ─── Snapshot rag_bot into the build context ───────────────────────────────
echo "→ snapshotting rag_bot into vendor/ (excluding data/ — bind-mounted at runtime)"
rm -rf vendor/rag_bot
mkdir -p vendor
# Use rsync to exclude data/ during the copy itself; cp -a then rm would
# briefly stage 842 MB of files we'd just delete. data/ is bind-mounted via
# DATA_ROOT=/data at runtime; .git etc. are dev-only.
rsync -a \
    --exclude=data \
    --exclude=.venv \
    --exclude=venv \
    --exclude=.git \
    --exclude=.pytest_cache \
    --exclude=dist \
    --exclude=build \
    --exclude='__pycache__' \
    --exclude='*.egg-info' \
    "$RAG_BOT_DIR/" vendor/rag_bot/

# ─── Gate A: backend pytest ────────────────────────────────────────────────
echo
echo "→ [gate A] backend pytest (against current rag_bot in venv)"
# shellcheck disable=SC1091
source venv/bin/activate
python -m pytest -x -q
echo "  ✓ Gate A passed"

# ─── Gate B: docker build ──────────────────────────────────────────────────
echo
echo "→ [gate B] docker build"
docker build -t "backend-v2:$TAG" -t "backend-v2:candidate" .
echo "  ✓ Gate B passed"

# ─── Gate C: candidate /health probe ───────────────────────────────────────
echo
echo "→ [gate C] candidate /health probe on :$TEST_PORT (timeout ${HEALTH_TIMEOUT_SEC}s)"
# `.env` uses host-relative URLs (localhost:5434, localhost:8080, etc.) that
# don't resolve from inside the container. Override with changpt_net service
# names — these are stable across builds and match what docker-compose's prod
# entry will use.
#
# rag_bot's DataSourceManager reads source manifests + snapshot data from
# DATA_ROOT (~840 MB of files). Too big to bake into the image and updated
# out-of-band from code (data ingestion is its own pipeline), so we bind-mount
# it. Read-only is sufficient — the container only reads existing data.
docker run -d --name backend-v2-candidate \
    --network "$NETWORK" \
    -p "$TEST_PORT:8082" \
    --env-file .env \
    -v /mnt/data/rag_bot/data:/data:ro \
    -e DATA_ROOT=/data \
    -e POSTGRES_URI="postgresql://langgraph:langgraph@langgraph-postgres:5432/langgraph" \
    -e MILVUS_HOST="milvus-standalone" \
    -e EMBEDDING_BASE_URL="http://tei-embedder:80" \
    -e RERANK_ENDPOINT="http://tei-reranker:80/rerank" \
    -e LANGFUSE_BASE_URL="http://langfuse-langfuse-web-1:3000" \
    "backend-v2:candidate" >/dev/null

ok=0
for _ in $(seq 1 "$HEALTH_TIMEOUT_SEC"); do
    if curl -fsS "http://localhost:$TEST_PORT/health" >/dev/null 2>&1; then
        ok=1
        break
    fi
    sleep 1
done

# Always stop the test container; we never leave it running
docker stop backend-v2-candidate >/dev/null

if [ "$ok" != "1" ]; then
    echo "  ✗ Gate C failed — /health never responded"
    docker logs backend-v2-candidate 2>&1 | tail -50
    exit 1
fi
echo "  ✓ Gate C passed"

# ─── All gates green: promote tags (NOT prod swap) ─────────────────────────
echo
echo "→ all gates green — promoting tags"
if [ -n "$LKG_ID" ]; then
    docker tag backend-v2:latest backend-v2:previous
    echo "  :previous → $LKG_ID"
fi
docker tag "backend-v2:$TAG" backend-v2:latest
docker rmi backend-v2:candidate >/dev/null 2>&1 || true

# Disable the trap; success path
trap - EXIT

echo
echo "✓ build complete"
echo
echo "  :latest   → backend-v2:$TAG"
echo "  :previous → ${LKG_ID}"
echo
echo "Next steps:"
echo "  Promote prod:        cd $BACKEND_DIR && docker compose up -d backend"
echo "  Rollback prod:       docker tag backend-v2:previous backend-v2:latest && docker compose up -d backend"
echo "  Inspect this image:  docker run --rm -it backend-v2:$TAG /bin/bash"
