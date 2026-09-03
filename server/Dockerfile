FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Deps first so the layer caches until requirements change
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY fixtures ./fixtures

# Non-root: the container serves untrusted traffic and has no reason to be root
RUN useradd --create-home --uid 1001 vanna && chown -R vanna:vanna /app
USER vanna

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
