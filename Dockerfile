# TeleClass: uma imagem só. O Node compila o frontend e o FastAPI serve a
# página e a API na mesma porta (como no `npm run build` + uvicorn de sempre).

# 1) Frontend
FROM node:22-alpine AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# 2) Backend
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/app/backend \
    TELEAULA_DATA_DIR=/app/data
WORKDIR /app

# Dependências antes do código, para o cache do Docker valer entre builds.
COPY pyproject.toml ./
RUN python -c "import tomllib; print('\n'.join(tomllib.load(open('pyproject.toml','rb'))['project']['dependencies']))" > /tmp/req.txt \
 && pip install -r /tmp/req.txt \
 && rm /tmp/req.txt

COPY backend/app ./backend/app
COPY --from=frontend /src/frontend/dist ./frontend/dist

VOLUME ["/app/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/', timeout=4)"

# Dentro do contêiner precisa ouvir em 0.0.0.0; quem limita a 127.0.0.1 é o
# docker-compose.yml (a porta só abre no próprio PC).
CMD ["uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000"]
