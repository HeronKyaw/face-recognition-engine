# Finding Report: Face Detection & Recognition Pipeline Comparison

## MediaPipe + OpenCV vs. OpenCV 5 Only (YuNet + SFace)

### 1. Executive Summary

The current face-recognition-engine uses **MediaPipe for face detection and landmark tracking** paired with **OpenCV DNN + SFace for face recognition embedding extraction**. With the release of `opencv-python 5.0.0.93` (Jul 2, 2026), we evaluated two migration paths:

| Approach | Decision | Rationale |
|----------|----------|-----------|
| **A: Upgrade OpenCV to 5.x, keep MediaPipe** | **Adopted** | Minimal risk, preserves all liveness features, single dependency change |
| **B: OpenCV 5 only (YuNet + SFace)** | **Rejected** | Requires complete liveness system rewrite; 5 landmarks insufficient for current feature set |

---

### 2. Detailed Comparison

| Criteria | Approach A: MediaPipe + OpenCV 5 | Approach B: OpenCV 5 Only (YuNet + SFace) |
|----------|----------------------------------|-------------------------------------------|
| **Face landmarks** | 468-point 3D face mesh | 5 points (eye corners, nose tip, mouth corners) |
| **Blink detection (EAR)** | ✅ 6 eyelid points per eye | ❌ Impossible with 5 landmarks |
| **Mouth-open detection (MAR)** | ✅ Multiple lip landmarks | ❌ Impossible with 5 landmarks |
| **Smile detection** | ✅ Lip lift ratio from 12+ landmarks | ❌ Impossible with 5 landmarks |
| **Wink detection** | ✅ Asymmetric EAR between eyes | ❌ Impossible with 5 landmarks |
| **Head pose estimation** | ✅ 7-point solvePnP (accurate) | ⚠️ 5-point solvePnP (poor accuracy, degenerate cases) |
| **Face detection** | MediaPipe (good) | YuNet (fast, potentially better) |
| **Face recognition** | SFace via OpenCV DNN (unchanged) | SFace via OpenCV DNN (unchanged) |
| **Active liveness (challenge-response)** | ✅ Full support (turn, nod, wink, smile, blink) | ❌ All action detection lost |
| **Dependencies** | opencv-python-headless + mediapipe | opencv-python-headless only |
| **Image size** | ~250 MB (OpenCV) + ~50 MB (MediaPipe) | ~250 MB (OpenCV only) |
| **Platform support** | MediaPipe limited on some ARM / old Linux | OpenCV 5 broad support |
| **API stability** | MediaPipe APIs changed (solutions→tasks) — adapted | Single stable API surface |
| **Migration effort** | ~1 day (dependency + small code changes) | ~2-3 weeks (rewrite liveness system) |

---

### 3. Architecture Impact Analysis

#### Files Changed (Approach A)
| File | Change | Reason |
|------|--------|--------|
| `requirements.txt` | `4.10.0.84` → `5.0.0.93` | Upgrade OpenCV |
| `opencv_service.py` | Comment update | Re-evaluate `alignCrop` workaround |

#### Files That Would Change (Approach B)
| File | Change | Effort |
|------|--------|--------|
| `requirements.txt` | Remove mediapipe | Trivial |
| `opencv_service.py` | Replace MediaPipe with YuNet + new landmark model | High |
| `liveness_service.py` | Complete rewrite (EAR, MAR, blink, smile detection) | Very High |
| `challenge_service.py` | Replace all action detection logic | Very High |
| `config.py` | Remove MediaPipe config, add YuNet config | Medium |

#### Liveness Feature Matrix

| Feature | Current (MediaPipe) | OpenCV Only (5 landmarks) |
|---------|---------------------|--------------------------|
| Passive (blur, color) | ✅ OpenCV (no change) | ✅ OpenCV (no change) |
| Frame diversity | ✅ OpenCV (no change) | ✅ OpenCV (no change) |
| Blink detection (EAR) | ✅ 6 points/eye | ❌ |
| Smile detection | ✅ Lip lift ratio | ❌ |
| Mouth open detection | ✅ MAR | ❌ |
| Wink detection | ✅ Asymmetric EAR | ❌ |
| Head turn (left/right) | ✅ 7-point solvePnP | ⚠️ Degraded |
| Head nod (up/down) | ✅ 7-point solvePnP | ⚠️ Degraded |
| Look straight | ✅ 7-point solvePnP | ⚠️ Degraded |

---

### 4. Risk Assessment

| Risk | Approach A | Approach B | Mitigation |
|------|-----------|-----------|------------|
| **OpenCV API incompatibility** | Low — Python API is backward compatible | Same | Test health endpoint post-deployment |
| **SFace model loading** | Low — ONNX model is version-independent | Same | Already tested with OpenCV 5 |
| **MediaPipe API breakage** | Moderate — already handled both solutions & tasks APIs | N/A | Keep both API paths maintained |
| **alignCrop bug** | Low — workaround in place; re-evaluate with 5.0.0 | N/A | The workaround is already in code |
| **Loss of liveness features** | None | Critical — 80% of liveness features lost | Not applicable for Approach B |
| **Regression in production** | Low — unit tested | High — complete rewrite | Not applicable for Approach B |

---

### 5. Recommendation

**Near-term (immediate):** Upgrade OpenCV to 5.0.0.93 while retaining MediaPipe. This is a safe, low-risk change that brings the OpenCV 5 benefits (improved DNN module, bug fixes, new features) without sacrificing the critical liveness detection capabilities that depend on MediaPipe's rich 468-point face mesh.

**Long-term (consider):** If a future requirement reduces or eliminates the need for landmark-based liveness (e.g., switching to a ML-based liveness classifier that doesn't depend on facial landmarks), then migrating to a pure OpenCV 5 stack becomes viable. At that point, evaluate:

- OpenCV Zoo's face landmark models (106-point PFLD) as a MediaPipe alternative
- Third-party ONNX landmark models (e.g., 2D/3D facial landmark models)
- ML-based presentation attack detection (PAD) as a replacement for blink/smile challenges

**Status:** Approach A implemented on branch `feat/opencv5-upgrade`.
