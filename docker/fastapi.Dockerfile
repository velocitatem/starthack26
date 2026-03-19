FROM python:3.12-slim

WORKDIR /app

# System deps - layer rarely changes
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Install external dependencies only - layer cached until requirements.txt changes.
# requirements.txt keeps heavy ML deps (like torch) disabled.
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Install local shared library without pulling full project dependencies.
COPY pyproject.toml ./pyproject.toml
COPY shacklib/ ./shacklib/
COPY ml/data/anomaly_dataset.csv ./ml/data/anomaly_dataset.csv
RUN touch README.md \
    && pip install --no-cache-dir --no-deps . \
    && rm README.md

# Copy application source last - most frequently changed
COPY apps/backend/fastapi/ ./apps/backend/fastapi/

WORKDIR /app/apps/backend/fastapi

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python -c "import os, requests; requests.get(f\"http://localhost:{os.getenv('PORT', '5000')}/health\", timeout=5)" || exit 1

RUN useradd --create-home --shell /bin/bash app
RUN chown -R app:app /app
USER app

EXPOSE 5000

CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-5000}"]
