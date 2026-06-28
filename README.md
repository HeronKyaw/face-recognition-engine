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

See [docs/setup.md](docs/setup.md) for detailed setup instructions covering MySQL, ChromaDB, the backend API, and the web client.

```bash
# TL;DR — full stack with Docker
docker run -d --name face-mysql -p 3306:3306 -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=face_recognition_db -e MYSQL_USER=face_recognition_user -e MYSQL_PASSWORD=F@ceRecognition4PI mysql:8.0
docker run -d --name face-chroma -p 8000:8000 chromadb/chroma:0.6.3
cd backend-api && cp .env.example .env && docker compose up --build
```

API at `http://localhost:5050` — Swagger docs at `/docs`.  
Web client at `http://localhost:3000` — run `cd clients/web && npm install && npm run dev`.

## Documentation

| File | Contents |
|------|----------|
| [docs/setup.md](docs/setup.md) | Full setup guide (MySQL, ChromaDB, API, Web) |
| [docs/face_recognition_api.postman_collection.json](docs/face_recognition_api.postman_collection.json) | Postman collection for all API endpoints |

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

## Backend Flow

### Face Detection & Alignment

```
Upload image → MediaPipe Face Mesh (468 landmarks)
                → Compute 5 ArcFace reference points (eye centers, nose tip, mouth corners)
                → cv2.estimateAffinePartial2D() aligns to 5 canonical positions
                → cv2.warpAffine() produces 112×112 rotation-normalized crop
```

Critical for accuracy — ArcFace models are trained on aligned faces. Skipping alignment produces poor embeddings.

### Embedding Extraction

```
112×112 aligned face → Convert BGR→RGB
                        → Normalize: (pixel - 127.5) / 128.0
                        → ONNX ArcFace MobileFaceNet
                        → 512-d raw embedding
                        → L2-normalize: emb = emb / ||emb||
```

The L2 normalization ensures cosine similarity between any two embeddings equals their dot product.

### 1:N Vector Search (ChromaDB)

Embeddings are stored in a ChromaDB collection with HNSW index using cosine distance (`distance = 1 - cosine_similarity`). Lower distance = more similar. ArcFace achieves ~0.15–0.3 for genuine matches and >0.6 for impostors.

### Enrollment

```
POST /api/v1/enroll
  1. Verify user exists in MySQL (404 if not)
  2. Extract embedding from uploaded face image
  3. Search ChromaDB — if distance < 0.4: REJECT (anti-fraud)
  4. Store embedding in ChromaDB mapped to user_id
  5. Mark user as face_enrolled in MySQL
```

Anti-fraud prevents one person registering multiple accounts.

### Verification

```
POST /api/v1/verify
  1. Extract embedding from uploaded face image
  2. Search ChromaDB for nearest neighbor (top-1)
  3. If no match or distance >= 0.4 → 401 Unauthorized
  4. Fetch matched user from MySQL
  5. Log verification to audit trail
  6. Return 200 with user details
```

This is 1:N identification — the system searches all enrolled faces and returns the best match within threshold.

### End-to-End Flow

```
┌──────────────────────────────────────────────────────────────┐
│  1. Image Upload (multipart/form-data)                      │
├──────────────────────────────────────────────────────────────┤
│  2. Decode bytes → OpenCV BGR image                        │
├──────────────────────────────────────────────────────────────┤
│  3. MediaPipe Face Mesh → 468 landmarks → 5 reference pts  │
├──────────────────────────────────────────────────────────────┤
│  4. cv2.estimateAffinePartial2D + warpAffine → 112×112     │
│     (rotation/scale/translation normalization)              │
├──────────────────────────────────────────────────────────────┤
│  5. Normalize pixels → (pixel - 127.5) / 128.0             │
├──────────────────────────────────────────────────────────────┤
│  6. ONNX ArcFace MobileFaceNet → 512-d raw embedding        │
├──────────────────────────────────────────────────────────────┤
│  7. L2-normalize: emb = emb / ||emb||                       │
├──────────────────────────────────────────────────────────────┤
│  8. ChromaDB HNSW cosine search (1:N, top-1)                │
│     ┌────────────┐                                          │
│     │ distance   │  < 0.4 → MATCH (verified/enrolled)       │
│     │ < 0.4?     │  ≥ 0.4 → NO MATCH (reject)              │
│     └────────────┘                                          │
├──────────────────────────────────────────────────────────────┤
│  9. MySQL: fetch user details / log audit trail             │
└──────────────────────────────────────────────────────────────┘
```

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
