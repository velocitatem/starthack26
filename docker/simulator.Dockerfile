FROM python:3.12-slim

WORKDIR /app

# Only the deps the simulator actually needs
RUN pip install --no-cache-dir numpy pandas

# Install shacklib as a package
COPY pyproject.toml ./pyproject.toml
COPY shacklib/ ./shacklib/
RUN pip install --no-cache-dir --no-deps .

# Bake the dataset into the image so it is fully self-sufficient
COPY ml/data/anomaly_dataset.csv ./ml/data/anomaly_dataset.csv

# Copy entrypoint
COPY apps/simulator/ ./apps/simulator/

ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

CMD ["python", "apps/simulator/run.py"]
