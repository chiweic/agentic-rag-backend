# syntax=docker/dockerfile:1.7
#
# Backend image — agentic RAG FastAPI + LangGraph + Langfuse, plus a vendored
# snapshot of rag_bot (the local sibling project that holds DDM data adapters).
#
# Two-stage build:
#   1. builder — installs all Python deps + rag_bot into a venv at /opt/venv
#   2. runtime — copies that venv into a minimal slim image; no build tools,
#                no source dirs beyond what pip already installed into the venv
#
# Build via scripts/build-backend-image.sh (NOT plain `docker build`) — the
# script handles vendoring rag_bot from /mnt/data/rag_bot first, then runs the
# Tier 1 promotion gates.

# ────────────────────────────────────────────────────────────────────────────
# Stage 1: builder
# ────────────────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

# build-essential is here as a safety net for any wheel that has to compile
# from source; most of our deps ship binary wheels for slim, so this is rarely
# triggered but keeps the build robust against future dep additions.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

# Isolated venv we ship to the runtime stage. Keeps the runtime image small
# (no pip cache, no site-packages clutter from the base image's system Python).
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir --upgrade pip setuptools wheel

WORKDIR /build

# Install backend itself (and its declared deps in pyproject.toml).
# Copying app/ + pyproject.toml together because setuptools' flat-layout
# autodiscovery (`include = ["app*"]`) requires the package to be present at
# install time. Result: app package lives in /opt/venv/lib/python3.12/site-packages/app
COPY pyproject.toml /build/
COPY app /build/app
RUN pip install --no-cache-dir .

# Install CPU-only PyTorch BEFORE rag_bot. rag_bot's [langchain] extra pulls
# `langchain-huggingface` which depends on `sentence-transformers` which
# depends on `torch`. PyPI's default torch wheel is GPU-enabled and drags in
# the full CUDA toolkit (~5 GB of nvidia-* packages). The backend doesn't do
# local inference — embedding + reranking are offloaded to the TEI sidecars
# (tei-embedder, tei-reranker) — so CPU-only torch is sufficient and the
# image goes from ~9 GB to ~1.5 GB.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# Vendored rag_bot. The build script (scripts/build-backend-image.sh) snapshots
# /mnt/data/rag_bot into ./vendor/rag_bot before invoking docker build.
# Install with the [langchain] extra — the rag_bot pyproject defines it.
# pip sees torch already satisfied → won't re-install the GPU version.
COPY vendor/rag_bot /build/vendor/rag_bot
RUN pip install --no-cache-dir "/build/vendor/rag_bot[langchain]"

# ────────────────────────────────────────────────────────────────────────────
# Stage 2: runtime
# ────────────────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

# Runtime-only deps:
#   - curl: used by HEALTHCHECK below + by /scripts/build-backend-image.sh's
#     Gate C probe from outside the container
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Non-root user. Avoids running uvicorn as root inside the container, which is
# both a security best practice and helps with bind-mount permissions if we
# ever attach one (we don't today; image is fully self-contained).
RUN groupadd -g 1000 backend && useradd -u 1000 -g backend -m -s /bin/bash backend
USER backend
WORKDIR /home/backend

EXPOSE 8082

# Docker-level healthcheck. Independent of and complementary to the build
# script's Gate C probe — this one runs continuously after the container is up,
# letting `docker compose` decide when to mark the service healthy and useful
# for any future restart policy that depends on health.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -fsS http://localhost:8082/health || exit 1

# Production: NO --reload (immutable image — code only changes via rebuild),
# bind 0.0.0.0 so other containers (frontend) can reach via host networking
# OR via changpt_net by service name (`http://backend:8082`).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8082"]
