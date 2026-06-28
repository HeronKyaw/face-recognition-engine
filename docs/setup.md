# Setup Guide

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (for containerized dependencies or the API itself)
- [Node.js](https://nodejs.org/) 18+ (for the web client)
- Internet connection (the ArcFace ONNX model is auto-downloaded from HuggingFace on first run)

---

## 1. MySQL & ChromaDB

Choose one of the following options.

### Option A — Docker (recommended)

Run both with single commands:

```bash
# MySQL 8
docker run -d --name face-mysql \
  -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=root \
  -e MYSQL_DATABASE=face_recognition_db \
  -e MYSQL_USER=face_recognition_user \
  -e MYSQL_PASSWORD=F@ceRecognition4PI \
  mysql:8.0

# ChromaDB
docker run -d --name face-chroma \
  -p 8000:8000 \
  chromadb/chroma:0.6.3
```

### Option B — Local install

| Service  | Notes |
|----------|-------|
| **MySQL 8.0+** | Create database `face_recognition_db` and user `face_recognition_user` |
| **ChromaDB 0.6+** | Install via `pip install chromadb` and run with `chroma run --port 8000` |

---

## 2. Database Schema

```bash
docker exec -i face-mysql mysql -u root -p < backend-api/db/init.sql
```

If using a local MySQL, run `backend-api/db/init.sql` directly against your instance.

---

## 3. Backend API

```bash
cd backend-api
cp .env.example .env
```

Edit `.env` to point to your MySQL and ChromaDB hosts (`MYSQL_HOST`, `CHROMA_HOST`). The defaults assume Docker service names — use `localhost` for local installs or `host.docker.internal` when running the API in Docker and services on the host.

Then start the API:

```bash
docker compose up --build
```

The API serves at `http://localhost:5050`. Swagger docs at `/docs`.

---

## 4. Web Client

```bash
cd clients/web
npm install
npm run dev
```

Opens at `http://localhost:3000`. Configure the API URL in the client if needed (defaults to `http://localhost:5050`).

---

## Quick Start (all services)

```bash
# 1. MySQL + ChromaDB (Docker)
docker run -d --name face-mysql -p 3306:3306 -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=face_recognition_db -e MYSQL_USER=face_recognition_user -e MYSQL_PASSWORD=F@ceRecognition4PI mysql:8.0
docker run -d --name face-chroma -p 8000:8000 chromadb/chroma:0.6.3

# 2. Initialize DB
docker exec -i face-mysql mysql -u root -p < backend-api/db/init.sql

# 3. Start API
cd backend-api
cp .env.example .env
docker compose up --build

# 4. Start Web (separate terminal)
cd clients/web
npm install
npm run dev
```
