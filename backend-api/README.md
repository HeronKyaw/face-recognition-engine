# Face Recognition API

High-concurrency face verification and identity management API built with FastAPI, OpenCV 5 DNN, ChromaDB, and MySQL.

## Architecture

```
Client ──▶ FastAPI ──▶ OpenCV DNN (embedding extraction)
                 ├─▶ ChromaDB (1:N vector search)
                 └─▶ MySQL (user records + audit logs)
```

## Prerequisites

- Docker & Docker Compose
- An ArcFace/MobileFaceNet ONNX model placed at `models/arcface_mobilefacenet.onnx`
- Running MySQL and ChromaDB instances (see [docs/setup.md](../docs/setup.md))

## Quick Start

See [docs/setup.md](../docs/setup.md) for the full setup guide covering MySQL, ChromaDB, and this API.

```bash
cp .env.example .env          # configure MySQL & ChromaDB connections
docker compose up --build
```

The API starts at `http://localhost:8000`. Swagger docs at `/docs`.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MYSQL_HOST` | `host.docker.internal` | MySQL server host |
| `MYSQL_PORT` | `3306` | MySQL server port |
| `MYSQL_USER` | `face_recognition_user` | MySQL user |
| `MYSQL_PASSWORD` | `F@ceRecognition4PI` | MySQL password |
| `MYSQL_DATABASE` | `face_recognition_db` | Database name |
| `MYSQL_POOL_SIZE` | `10` | Connection pool size |
| `CHROMA_HOST` | `host.docker.internal` | ChromaDB server host |
| `CHROMA_PORT` | `8000` | ChromaDB server port |
| `CHROMA_COLLECTION` | `face_embeddings` | ChromaDB collection name |
| `VERIFICATION_THRESHOLD` | `0.4` | Cosine distance threshold |
| `MODEL_PATH` | `/app/models/arcface_mobilefacenet.onnx` | ONNX model path |

## API Endpoints

### Health

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness probe (checks all services) |

### User Management

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/users` | Create user |
| GET | `/api/v1/users` | List users (paginated) |
| GET | `/api/v1/users/{user_id}` | Get user |
| PUT | `/api/v1/users/{user_id}` | Update user |
| DELETE | `/api/v1/users/{user_id}` | Delete user + face embedding |

### Face Verification

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/enroll` | Enroll face for existing user |
| POST | `/api/v1/verify` | 1:N face identification |

### Audit

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/verification-logs` | Verification audit log |

## Enrollment Flow

1. `POST /api/v1/users` — create user identity
2. `POST /api/v1/enroll` — upload face image (rejected if face already enrolled to another user)

## Verification Flow

1. `POST /api/v1/verify` — upload face image with optional `device_id`
2. Returns user details if match found within threshold, 401 otherwise
3. Each successful verification is logged with device info

## Project Structure

```
├── app/
│   ├── main.py              # FastAPI endpoints
│   ├── config.py            # Environment configuration
│   ├── services/
│   │   ├── mysql_service.py # Connection pooling & user CRUD
│   │   ├── chroma_service.py# Vector indexing & search
│   │   └── opencv_service.py# DNN model & embedding extraction
│   └── schemas/             # Pydantic models
├── models/                  # Place ONNX model here
├── db/init.sql              # Database schema
├── Dockerfile               # Multi-stage OpenCV 5 build
└── docker-compose.yml
```
