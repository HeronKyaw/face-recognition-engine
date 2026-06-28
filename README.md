# Face Recognition Engine

A multi-platform face recognition system with a FastAPI backend, Next.js web dashboard, and Flutter mobile app.

## Architecture

```
                   ┌──────────────┐
                   │  Next.js Web │
                   │  (clients/)  │
                   └──────┬───────┘
                          │ HTTP
                    ┌─────▼──────┐
┌──────────────┐    │  FastAPI   │    ┌──────────┐
│ Flutter App  ├────┤ (backend-  ├────► ChromaDB │
│ (clients/)   │    │  api/)     │    │ (vectors)│
└──────────────┘    │            │    └──────────┘
                    │  OpenCV    │
                    │  (ONNX)    │    ┌──────────┐
                    └─────┬──────┘    │  MySQL   │
                          └───────────► (records)│
                                      └──────────┘
```

- **Backend**: FastAPI (Python) — face embedding extraction via OpenCV DNN (ArcFace ONNX), 1:N vector search with ChromaDB, user records/audit logs in MySQL
- **Web**: Next.js 16 (App Router) — dashboard, user management, face enrollment/verification with webcam support
- **Mobile**: Flutter — same functionality on Android/iOS with camera/gallery input

## Repo Structure

```
face-recognition-engine/
├── backend-api/         # Python FastAPI server
│   ├── app/             # Application code
│   │   ├── main.py      # Route handlers & lifespan
│   │   ├── config.py    # Pydantic settings
│   │   ├── schemas/     # Pydantic request/response models
│   │   └── services/    # MySQL, ChromaDB, OpenCV services
│   ├── models/          # ONNX model files
│   ├── db/init.sql      # MySQL schema
│   ├── Dockerfile
│   └── docker-compose.yml
├── clients/
│   ├── web/             # Next.js dashboard
│   ├── mobile/          # Flutter mobile app
│   └── desktop/         # (placeholder)
└── docs/                # Postman collection
```

## Quick Start

### Backend API

```bash
cd backend-api
cp .env.example .env   # configure MySQL & ChromaDB connections
docker compose up --build
```

API available at `http://localhost:5050`. Swagger docs at `/docs`.

### Web Client

```bash
cd clients/web
npm install
npm run dev
```

Opens at `http://localhost:3000`.

### Mobile App

```bash
cd clients/mobile
flutter pub get
flutter run
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (MySQL, ChromaDB, OpenCV) |
| POST | `/api/v1/users` | Create user |
| GET | `/api/v1/users` | List users (paginated) |
| GET | `/api/v1/users/{id}` | Get user |
| PUT | `/api/v1/users/{id}` | Update user |
| DELETE | `/api/v1/users/{id}` | Delete user + embedding |
| POST | `/api/v1/enroll` | Enroll face for user |
| POST | `/api/v1/verify` | 1:N face verification |
| GET | `/api/v1/verification-logs` | Audit log |

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Python 3.11, FastAPI, Uvicorn |
| Face Detection | MediaPipe |
| Face Embedding | ArcFace MobileFaceNet (ONNX) |
| Vector DB | ChromaDB (cosine distance, threshold 0.4) |
| Relational DB | MySQL 8.0+ |
| Web Client | Next.js 16, React 19, Tailwind CSS v4 |
| Mobile Client | Flutter 3.12+, Material Design 3 |
| Containerization | Docker, Docker Compose |
