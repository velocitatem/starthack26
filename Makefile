# Makefile - Ultiplate Template
.PHONY: help init bootstrap venv deps lock envlink fmt lint type test clean doctor
.PHONY: up down logs ps rebuild
.PHONY: dev run.webapp run.webapp.simple run.backend run.classifier run.worker run.ml
.PHONY: lift lift.ml lift.minio lift.tensorboard lift.mlflow lift.logging lift.database
.PHONY: etl train infer seed
.PHONY: nx.graph nx.projects nx.affected
.DEFAULT_GOAL := help

WD         := $(shell pwd)
ENV        := $(shell readlink -f .env 2>/dev/null || echo .env)
PYTHON_VER := 3.12
PYTHON     := python$(PYTHON_VER)
UV         := $(shell command -v uv 2>/dev/null || echo uv)
BUN        := $(shell command -v bun 2>/dev/null || echo bun)
NX         := $(BUN) x nx

## ── Quick Start ──────────────────────────────────────────────────────────────

init: bootstrap ## First-time setup (alias for bootstrap)

dev: run.webapp ## Start the Vite webapp (fastest entry point)

## ── Environment Setup ────────────────────────────────────────────────────────

bootstrap: venv envlink deps ## Full initial setup: venv + deps + env linking
	@echo "Bootstrap complete. Activate Python env: source .venv/bin/activate"

venv: ## Create Python virtual environment (idempotent)
	@if [ ! -d ".venv" ]; then \
		echo "Creating uv-managed venv (Python $(PYTHON_VER))..."; \
		$(UV) venv --python $(PYTHON_VER) .venv; \
	fi

deps: venv ## Install/update Python dependencies
	@$(UV) sync
	@if [ -f package.json ]; then $(BUN) install; fi
	@cd apps/webapp && $(BUN) install --frozen-lockfile 2>/dev/null || $(BUN) install

lock: ## Refresh uv lockfile
	@$(UV) lock

envlink: ## Propagate root .env to all sub-apps
	@mkdir -p apps/webapp apps/worker ml
	@touch "$(WD)/apps/webapp/.env" "$(WD)/apps/worker/.env" "$(WD)/ml/.env"
	@if [ -f "$(ENV)" ]; then \
		ln -sf "$(ENV)" "$(WD)/apps/webapp/.env"; \
		ln -sf "$(ENV)" "$(WD)/apps/worker/.env"; \
		ln -sf "$(ENV)" "$(WD)/ml/.env"; \
	fi

doctor: ## Verify toolchain (bun, docker, python)
	@echo "Checking toolchain..."
	@$(PYTHON) --version || (echo "python$(PYTHON_VER) not found"; exit 1)
	@$(UV) --version || echo "uv not found - install: curl -LsSf https://astral.sh/uv/install.sh | sh"
	@$(BUN) --version || echo "bun not found - install: curl -fsSL https://bun.sh/install | bash"
	@docker --version || echo "docker not found"
	@docker compose version || echo "docker compose not found"
	@echo "OK"

## ── Code Quality ─────────────────────────────────────────────────────────────

fmt: venv ## Format Python with black
	@$(UV) run black src/ ml/ apps/worker/ apps/backend/ 2>/dev/null || echo "Run: make deps"

lint: venv ## Lint Python with ruff
	@$(UV) run ruff check src/ ml/ apps/worker/ apps/backend/ 2>/dev/null || echo "Run: make deps"

type: venv ## Type check Python with mypy
	@$(UV) run mypy src/ ml/ apps/worker/ apps/backend/ 2>/dev/null || echo "Run: make deps"

test: venv ## Run pytest
	@$(UV) run pytest tests/ -v 2>/dev/null || echo "No tests yet - create tests/"

## ── Docker ───────────────────────────────────────────────────────────────────

up: ## Start core services (postgres, redis, backend, classifier, worker)
	@docker compose up -d postgres redis backend-fastapi backend-classifier worker

down: ## Stop all services
	@docker compose down

logs: ## Tail all service logs
	@docker compose logs -f

ps: ## Show service status
	@docker compose ps

rebuild: ## Rebuild + restart all services (no cache)
	@docker compose build --no-cache && docker compose up -d

## ── Service Profiles ─────────────────────────────────────────────────────────

lift: up ## Alias for 'up'

lift.ml: ## Start core services + ML inference
	@docker compose --profile ml up -d postgres redis backend-fastapi backend-classifier ml-inference worker

lift.sim: ## Start core services + node simulator
	@docker compose --profile sim up -d postgres redis backend-fastapi backend-classifier node-simulator
	@echo "Node simulator publishing to backend-fastapi"

lift.minio: ## Start core services + MinIO object storage
	@docker compose --profile minio up -d
	@echo "MinIO console: http://localhost:9901 (minioadmin/minioadmin)"

lift.tensorboard: ## Start TensorBoard
	@docker compose --profile tensorboard up -d
	@echo "TensorBoard: http://localhost:6006"

lift.mlflow: ## Start optional MLflow tracking server
	@docker compose --profile mlflow up -d
	@echo "MLflow: http://localhost:5000"

lift.logging: ## Start Loki + Grafana logging stack
	@docker compose --profile logging up -d
	@if [ -f .env ]; then . ./.env 2>/dev/null; fi; \
	echo "Grafana: http://localhost:$${GRAFANA_PORT:-3000} (admin/admin)"; \
	echo "Loki:    http://localhost:$${LOKI_PORT:-3100}"

lift.database: ## Start database services (postgres/mongodb)
	@docker compose --profile database up -d

## ── Run Applications ─────────────────────────────────────────────────────────

run.webapp: ## Start Vite webapp with bun
	@echo "Starting webapp at http://localhost:3000"
	@$(NX) run webapp:dev

run.webapp.simple: ## Start Streamlit minimal webapp
	@$(NX) run webapp-minimal:dev

run.backend: ## Start API backend (BACKEND_MODE=fastapi|flask, default: fastapi)
	@if [ -f .env ]; then . ./.env; fi; \
	MODE=$${BACKEND_MODE:-fastapi}; \
	if [ "$$MODE" = "fastapi" ]; then \
		$(NX) run backend-fastapi:dev; \
	elif [ "$$MODE" = "flask" ]; then \
		$(NX) run backend-flask:dev; \
	else \
		echo "Unknown BACKEND_MODE=$$MODE (fastapi|flask)"; exit 1; \
	fi

run.classifier: ## Start classifier loop worker
	@$(NX) run worker:classify

run.worker: ## Start Celery worker (requires redis)
	@$(NX) run worker:dev

run.ml: ## Start ML inference server (FastAPI)
	@$(NX) run ml:dev

## ── ML Workflow ──────────────────────────────────────────────────────────────

etl: venv ## Run ETL pipeline
	@$(NX) run ml:etl

train: venv ## Run model training
	@$(NX) run ml:train

nx.graph: ## Open Nx project graph
	@$(NX) graph

nx.projects: ## List Nx projects in workspace
	@$(NX) show projects

nx.affected: ## Run lint/test/build only for affected projects
	@$(NX) affected -t lint,test,build

infer: run.ml ## Alias for run.ml

## ── Utilities ────────────────────────────────────────────────────────────────

seed: venv ## Seed development data
	@$(PYTHON) scripts/seed.py 2>/dev/null || echo "Create scripts/seed.py for seeding"

clean: ## Remove caches, build artifacts, and compiled files
	@find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	@find . -type f -name "*.pyc" -delete 2>/dev/null || true
	@find . -type d -name "*.egg-info" -exec rm -rf {} + 2>/dev/null || true
	@find . -type d -name ".pytest_cache" -exec rm -rf {} + 2>/dev/null || true
	@find . -type d -name ".mypy_cache" -exec rm -rf {} + 2>/dev/null || true
	@find . -type d -name ".ruff_cache" -exec rm -rf {} + 2>/dev/null || true
	@rm -rf build/ dist/ 2>/dev/null || true

help: ## Show this help
	@echo "Ultiplate - make targets"
	@echo ""
	@echo "  Quick start:"
	@echo "    make init         - First-time setup"
	@echo "    make dev          - Start Vite webapp"
	@echo "    make up           - Start Docker services"
	@echo ""
	@grep -E '^[a-zA-Z_.%-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  %-22s %s\n", $$1, $$2}'
