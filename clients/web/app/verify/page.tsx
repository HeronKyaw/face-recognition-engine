"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { api, VerifyResponse, LivenessMethod, ClientLivenessResult } from "@/lib/api";
import { ClientLivenessService, ClientChallengeStep } from "@/lib/client-liveness";

const LIVENESS_FRAME_COUNT = 10;
const LIVENESS_FRAME_INTERVAL = 200;
const CHALLENGE_FRAMES_PER_STEP = 15;
const CHALLENGE_FRAME_INTERVAL = 80;
const DETECTION_TIMEOUT_MS = 15000;

const FACE_CONNECTIONS: [number, number][] = [
  [10, 338], [338, 297], [297, 332], [332, 284], [284, 251],
  [251, 389], [389, 356], [356, 454], [454, 323], [323, 361],
  [361, 288], [288, 397], [397, 365], [365, 379], [379, 378],
  [378, 400], [400, 377], [377, 152], [152, 148], [148, 176],
  [176, 149], [149, 150], [150, 136], [136, 172], [172, 58],
  [58, 132], [132, 93], [93, 234], [234, 127], [127, 162],
  [162, 21], [21, 54], [54, 103], [103, 67], [67, 109], [109, 10],
  [33, 7], [7, 163], [163, 144], [144, 145], [145, 153],
  [153, 154], [154, 155], [155, 133], [133, 173], [173, 157],
  [157, 158], [158, 159], [159, 160], [160, 161], [161, 246], [246, 33],
  [362, 382], [382, 381], [381, 380], [380, 374], [374, 373],
  [373, 390], [390, 249], [249, 263], [263, 466], [466, 388],
  [388, 387], [387, 386], [386, 385], [385, 384], [384, 398], [398, 362],
  [46, 53], [53, 52], [52, 65], [65, 55], [55, 70],
  [70, 63], [63, 105], [105, 66], [66, 107],
  [276, 283], [283, 282], [282, 295], [295, 285], [285, 300],
  [300, 293], [293, 334], [334, 296], [296, 336],
  [61, 185], [185, 40], [40, 39], [39, 37], [37, 0],
  [0, 267], [267, 269], [269, 270], [270, 409], [409, 291],
  [291, 375], [375, 321], [321, 405], [405, 314], [314, 17],
  [17, 84], [84, 181], [181, 91], [91, 146], [146, 61],
  [78, 191], [191, 80], [80, 81], [81, 82], [82, 13],
  [13, 312], [312, 311], [311, 310], [310, 415], [415, 308],
  [308, 324], [324, 318], [318, 402], [402, 317], [317, 14],
  [14, 87], [87, 178], [178, 88], [88, 95], [95, 78],
  [168, 197], [197, 196], [196, 195], [195, 5], [5, 4],
  [4, 1], [1, 19], [19, 94], [94, 2],
  [97, 98], [98, 99], [99, 100], [100, 101], [101, 102],
  [102, 103], [103, 104], [104, 105], [105, 106], [106, 107],
  [107, 108], [108, 109], [109, 110], [110, 111], [111, 112],
  [112, 113], [113, 114], [114, 115], [115, 116], [116, 117],
  [117, 118], [118, 119], [119, 120], [120, 121], [121, 122],
  [122, 97],
];

type VerifyState = "idle" | "challenge_init" | "countdown" | "step_capturing" | "step_verifying" | "challenge_complete" | "client_analysing" | "verifying" | "done";

export default function VerifyPage() {
  const [deviceId, setDeviceId] = useState("");
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [capturingFrames, setCapturingFrames] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [method, setMethod] = useState<LivenessMethod>("frame_burst");
  const [verifyState, setVerifyState] = useState<VerifyState>("idle");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [challengeSteps, setChallengeSteps] = useState<{ action: string; instruction: string }[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [stepMessage, setStepMessage] = useState("");
  const [stepProgress, setStepProgress] = useState(0);
  const [stepGuide, setStepGuide] = useState("");
  const [clientLivenessResult, setClientLivenessResult] = useState<ClientLivenessResult | null>(null);
  const [clientServiceReady, setClientServiceReady] = useState(false);
  const [clientChallengeSteps, setClientChallengeSteps] = useState<ClientChallengeStep[]>([]);
  const [clientChallengeStepIndex, setClientChallengeStepIndex] = useState(0);
  const [showFaceMesh, setShowFaceMesh] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loadingRef = useRef(false);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const detectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMeshDrawRef = useRef(0);
  const clientServiceRef = useRef<ClientLivenessService | null>(null);

  useEffect(() => {
    ClientLivenessService.getInstance().then((svc) => {
      clientServiceRef.current = svc;
      setClientServiceReady(true);
    });
  }, []);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(animRef.current);
    if (detectTimerRef.current) clearTimeout(detectTimerRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
    setVerifyState("idle");
    setChallengeId(null);
    setChallengeSteps([]);
    setCurrentStep(0);
    setStepMessage("");
    setStepProgress(0);
    setStepGuide("");
    setCountdown(0);
    setCapturingFrames(0);
    setClientLivenessResult(null);
    setClientChallengeSteps([]);
    setClientChallengeStepIndex(0);
  }, []);

  useEffect(() => {
    return stopCamera;
  }, [stopCamera]);

  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraActive]);

  const drawFaceMesh = useCallback(async () => {
    const video = videoRef.current;
    const canvas = overlayRef.current;
    const svc = clientServiceRef.current;
    if (!video || !canvas || !svc || !svc.isLoaded) return;

    const now = performance.now();
    if (now - lastMeshDrawRef.current < 100) return;
    lastMeshDrawRef.current = now;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const landmarks = await svc.detectFaces(video);
    if (!landmarks || landmarks.length < 468) return;

    const w = canvas.width;
    const h = canvas.height;

    ctx.strokeStyle = "#00dd88";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#00dd88";

    for (const [i, j] of FACE_CONNECTIONS) {
      const x1 = w - landmarks[i].x * w;
      const y1 = landmarks[i].y * h;
      const x2 = w - landmarks[j].x * w;
      const y2 = landmarks[j].y * h;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    ctx.fillStyle = "#88ffbb";
    for (let idx = 0; idx < 468; idx++) {
      const x = w - landmarks[idx].x * w;
      const y = landmarks[idx].y * h;
      ctx.beginPath();
      ctx.arc(x, y, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }, []);

  useEffect(() => {
    if (cameraActive && method === "client" && clientServiceReady && showFaceMesh && clientServiceRef.current?.isLoaded) {
      const loop = () => {
        drawFaceMesh();
        animRef.current = requestAnimationFrame(loop);
      };
      animRef.current = requestAnimationFrame(loop);
    } else {
      cancelAnimationFrame(animRef.current);
    }
    return () => cancelAnimationFrame(animRef.current);
  }, [cameraActive, method, clientServiceReady, drawFaceMesh, showFaceMesh]);

  const startCamera = async () => {
    setError("");
    setResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      setCameraActive(true);
    } catch {
      setError("Camera access denied or unavailable.");
    }
  };

  const captureSingleFrame = (): Promise<File> => {
    return new Promise((resolve, reject) => {
      const video = videoRef.current;
      if (!video) { reject(new Error("Camera not available")); return; }
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) { reject(new Error("Camera not ready")); return; }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas not available")); return; }
      ctx.drawImage(video, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error("Failed to capture")); return; }
        resolve(new File([blob], "face.jpg", { type: "image/jpeg" }));
      }, "image/jpeg", 85);
    });
  };

  const captureBurst = (count: number, interval: number): Promise<{ faceImage: File; livenessFrames: File[] }> => {
    return new Promise((resolve, reject) => {
      const video = videoRef.current;
      if (!video) { reject(new Error("Camera not available")); return; }
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) { reject(new Error("Camera not ready")); return; }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas not available")); return; }

      const frames: File[] = [];
      let captured = 0;
      const total = 1 + count;

      const doCapture = () => {
        ctx.drawImage(video, 0, 0);
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error("Failed to capture frame")); return; }
          const label = captured === 0 ? "face" : `frame_${captured}`;
          frames.push(new File([blob], `${label}.jpg`, { type: "image/jpeg" }));
          captured++;

          if (captured === 1) {
            setCapturingFrames(0);
          } else {
            setCapturingFrames(captured - 1);
          }

          if (captured >= total) {
            resolve({ faceImage: frames[0], livenessFrames: frames.slice(1) });
          } else {
            setTimeout(doCapture, captured === 1 ? 0 : interval);
          }
        }, "image/jpeg", 85);
      };
      doCapture();
    });
  };

  const captureStepFrames = (count: number, interval: number, mirror = true): Promise<File[]> => {
    return new Promise((resolve, reject) => {
      const video = videoRef.current;
      if (!video) { reject(new Error("Camera not available")); return; }
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) { reject(new Error("Camera not ready")); return; }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas not available")); return; }

      const frames: File[] = [];
      let captured = 0;

      const doCapture = () => {
        if (mirror) {
          ctx.save();
          ctx.scale(-1, 1);
          ctx.drawImage(video, -w, 0);
          ctx.restore();
        } else {
          ctx.drawImage(video, 0, 0);
        }
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error("Failed to capture frame")); return; }
          frames.push(new File([blob], `frame_${captured}.jpg`, { type: "image/jpeg" }));
          captured++;
          setCapturingFrames(captured);

          if (captured >= count) {
            resolve(frames);
          } else {
            setTimeout(doCapture, interval);
          }
        }, "image/jpeg", 85);
      };
      doCapture();
    });
  };

  const startChallenge = async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setError("");
    setResult(null);
    setStepMessage("");

    try {
      const challenge = await api.initChallenge();
      const steps = challenge.steps;
      setChallengeId(challenge.challenge_id);
      setChallengeSteps(steps);
      setCurrentStep(0);
      setVerifyState("idle");
      setStepMessage(steps[0].instruction);
      loadingRef.current = false;
      setTimeout(() => executeChallengeStep(challenge.challenge_id, 0, steps), 500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to init challenge");
      setVerifyState("idle");
      loadingRef.current = false;
    }
  };

  const executeChallengeStep = async (cid: string, stepIndex: number, steps: { action: string; instruction: string }[]) => {
    if (!cid) return;
    setVerifyState("countdown");
    setStepMessage(steps[stepIndex].instruction);
    for (let i = 3; i >= 1; i--) {
      setCountdown(i);
      await new Promise(r => setTimeout(r, 1000));
    }
    setCountdown(0);
    setVerifyState("step_capturing");

    try {
      const frames = await captureStepFrames(CHALLENGE_FRAMES_PER_STEP, CHALLENGE_FRAME_INTERVAL);
      setVerifyState("step_verifying");

      const stepResult = await api.verifyChallengeStep(cid, stepIndex, frames);

      if (!stepResult.passed) {
        setError(`Step ${stepIndex + 1} failed: ${stepResult.message}`);
        setVerifyState("idle");
        setCapturingFrames(0);
        return;
      }

      setCapturingFrames(0);

      if (stepResult.completed) {
        setVerifyState("challenge_complete");
        setStepMessage("All steps passed! Verifying...");
        await doChallengeVerify(cid);
      } else if (stepResult.next_step_index !== undefined) {
        setCurrentStep(stepResult.next_step_index);
        setVerifyState("idle");
        setStepMessage(steps[stepResult.next_step_index].instruction);
        setTimeout(() => executeChallengeStep(cid, stepResult.next_step_index!, steps), 500);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Step verification failed");
      setVerifyState("idle");
      setCountdown(0);
      setCapturingFrames(0);
    }
  };

  const startClientChallenge = async () => {
    if (loadingRef.current) return;
    const svc = clientServiceRef.current;
    if (!svc || !svc.isLoaded) {
      setError("Client liveness model not loaded yet");
      return;
    }
    loadingRef.current = true;
    setError("");
    setResult(null);
    setClientLivenessResult(null);
    setVerifyState("challenge_init");
    setStepMessage("");

    const steps = svc.generateChallengeSteps();
    setClientChallengeSteps(steps);
    setClientChallengeStepIndex(0);
    setVerifyState("idle");
    setStepMessage(steps[0].instruction);
    loadingRef.current = false;
    setTimeout(() => executeClientChallengeStep(0, steps), 500);
  };

  const formatFeedback = (result: { guide?: string; progress?: number; value?: number; threshold?: number }): string => {
    const guide = result.guide;
    const progress = Math.min(1, Math.max(0, result.progress ?? 0));
    if (!guide) return "";
    const bar = "█".repeat(Math.round(progress * 10)) + "░".repeat(10 - Math.round(progress * 10));
    return `${guide} ${bar} ${(progress * 100).toFixed(0)}%`;
  };

  const detectActionLive = (
    svc: ClientLivenessService,
    video: HTMLVideoElement,
    action: string,
    params: Record<string, unknown>,
    instruction: string
  ): Promise<boolean> => {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (detectTimerRef.current) clearTimeout(detectTimerRef.current);
        resolve(false);
      }, DETECTION_TIMEOUT_MS);

      let inBlink = false;
      let blinkCount = 0;
      const expected = action === "blink" ? (params.count as number) || 1 : 0;
      let holdCount = 0;
      const HOLD_REQUIRED = action === "blink" ? 1 : 3;
      let processing = false;

      const check = async () => {
        if (processing) {
          detectTimerRef.current = setTimeout(check, 50);
          return;
        }
        processing = true;
        try {
          if (action === "blink") {
            setStepGuide("");
            const ear = await svc.computeEarFromVideo(video);
            if (ear !== null) {
              if (ear < 0.2) {
                if (!inBlink) inBlink = true;
              } else if (inBlink) {
                blinkCount++;
                inBlink = false;
                setCapturingFrames(blinkCount);
                if (blinkCount >= expected) {
                  clearTimeout(timeout);
                  resolve(true);
                  return;
                }
              }
            }
          } else {
            const result = await svc.verifyActionOnFrame(video, action);
            setStepMessage(`${instruction}`);
            setStepProgress(result.progress ?? 0);
            setStepGuide(formatFeedback(result));
            if (result.detected) {
              holdCount++;
              if (holdCount >= HOLD_REQUIRED) {
                clearTimeout(timeout);
                setCapturingFrames(1);
                setTimeout(() => setCapturingFrames(0), 400);
                resolve(true);
                return;
              }
            } else {
              holdCount = 0;
            }
          }
        } catch {
          clearTimeout(timeout);
          resolve(false);
          return;
        } finally {
          processing = false;
        }
        detectTimerRef.current = setTimeout(check, 150);
      };
      detectTimerRef.current = setTimeout(check, 150);
    });
  };

  const executeClientChallengeStep = async (stepIndex: number, steps: ClientChallengeStep[]) => {
    const svc = clientServiceRef.current;
    if (!svc) return;

    setVerifyState("countdown");
    setStepMessage(steps[stepIndex].instruction);
    for (let i = 3; i >= 1; i--) {
      setCountdown(i);
      await new Promise((r) => setTimeout(r, 1000));
    }
    setCountdown(0);

    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setError("Camera not ready");
      setVerifyState("idle");
      return;
    }

    setCapturingFrames(0);
    setVerifyState("step_capturing");

    try {
      const detected = await detectActionLive(svc, video, steps[stepIndex].action, steps[stepIndex].params, steps[stepIndex].instruction);

      if (!detected) {
        setError(`Step ${stepIndex + 1} failed: could not detect "${steps[stepIndex].instruction}"`);
        setVerifyState("idle");
        setCapturingFrames(0);
        return;
      }

      setCapturingFrames(0);

      if (stepIndex + 1 >= steps.length) {
        setVerifyState("challenge_complete");
        setStepMessage("All challenges passed! Verifying...");
        await handleClientVerifyAfterChallenge();
      } else {
        const nextIndex = stepIndex + 1;
        setClientChallengeStepIndex(nextIndex);
        setVerifyState("idle");
        setStepMessage(steps[nextIndex].instruction);
        setTimeout(() => executeClientChallengeStep(nextIndex, steps), 500);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Step verification failed");
      setVerifyState("idle");
      setCountdown(0);
      setCapturingFrames(0);
    }
  };

  const handleClientVerifyAfterChallenge = async () => {
    setVerifyState("verifying");
    setLoading(true);

    try {
      const faceImage = await captureSingleFrame();
      const res = await api.verify(faceImage, [], deviceId || undefined, "client");
      setResult(res);
      setVerifyState("done");
      if (res.success) stopCamera();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Verification failed");
      setVerifyState("idle");
    } finally {
      setLoading(false);
    }
  };

  const doChallengeVerify = async (cid: string) => {
    if (!cid) return;
    setVerifyState("verifying");
    setLoading(true);

    try {
      const faceImage = await captureSingleFrame();
      const res = await api.verify(faceImage, [], deviceId || undefined, "challenge", cid);
      setResult(res);
      setVerifyState("done");
      if (res.success) stopCamera();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Verification failed");
      setVerifyState("idle");
    } finally {
      setLoading(false);
    }
  };

  const handleFrameBurstVerify = async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setError("");
    setResult(null);
    setLoading(true);

    try {
      const { faceImage, livenessFrames } = await captureBurst(LIVENESS_FRAME_COUNT, LIVENESS_FRAME_INTERVAL);
      const res = await api.verify(faceImage, livenessFrames, deviceId || undefined, "frame_burst");
      setResult(res);
      setVerifyState("done");
      if (res.success) stopCamera();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
      setCapturingFrames(0);
      loadingRef.current = false;
    }
  };

  const handleClientVerify = async () => {
    if (loadingRef.current) return;
    const svc = clientServiceRef.current;
    if (!svc || !svc.isLoaded) {
      setError("Client liveness model not loaded yet");
      return;
    }
    loadingRef.current = true;
    setError("");
    setResult(null);
    setClientLivenessResult(null);
    setLoading(true);
    cancelAnimationFrame(animRef.current);

    try {
      const { faceImage, livenessFrames } = await captureBurst(LIVENESS_FRAME_COUNT, LIVENESS_FRAME_INTERVAL);

      setVerifyState("client_analysing");
      setStepMessage("Running client-side liveness analysis...");

      const clientResult = await svc.fullAssessment(livenessFrames);
      setClientLivenessResult(clientResult);

      setVerifyState("verifying");
      setStepMessage("Verifying with server...");

      const res = await api.verify(faceImage, livenessFrames, deviceId || undefined, "client");
      setResult(res);
      setVerifyState("done");
      if (res.success) stopCamera();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Client verification failed");
      setVerifyState("idle");
    } finally {
      setLoading(false);
      setCapturingFrames(0);
      loadingRef.current = false;
    }
  };

  const handleTryAgain = () => {
    setResult(null);
    setError("");
    setVerifyState("idle");
    setClientLivenessResult(null);
    setClientChallengeSteps([]);
    setClientChallengeStepIndex(0);
  };

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Verify Face</h1>
        <p className="text-sm text-slate-500 mt-0.5">Identify a person from a face image</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
          <span>⚠</span> {error}
        </div>
      )}

      {clientLivenessResult && (
        <div className={`px-4 py-3 rounded-lg text-sm border ${
          clientLivenessResult.passed
            ? "bg-emerald-50 border-emerald-200 text-emerald-700"
            : "bg-amber-50 border-amber-200 text-amber-700"
        }`}>
          <div className="flex items-start gap-2">
            <span className="mt-0.5">{clientLivenessResult.passed ? "✓" : "!"}</span>
            <div className="flex-1">
              <p className="font-medium">Client Liveness: {clientLivenessResult.passed ? "Passed" : "Failed"}</p>
              <div className="mt-2 space-y-1 text-xs border-t border-emerald-200/50 pt-2">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${clientLivenessResult.face_detected ? "bg-emerald-500" : "bg-red-500"}`} />
                  Face Detected: {clientLivenessResult.face_detected ? "Yes" : "No"}
                </div>
                <div className="text-slate-500">
                  Passive: {(clientLivenessResult.passive_score * 100).toFixed(0)}% |
                  Blur: {(clientLivenessResult.blur_score * 100).toFixed(0)}% |
                  Color: {(clientLivenessResult.color_score * 100).toFixed(0)}%
                </div>
                <div className="text-slate-500">
                  Blink: {clientLivenessResult.blinks_count} detected {clientLivenessResult.blink_detected ? "✓" : "✗"} |
                  Diversity: {clientLivenessResult.frame_diversity.toFixed(1)} {clientLivenessResult.frame_diversity_ok ? "✓" : "✗"}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {result && (
        <div className={`px-4 py-3 rounded-lg text-sm border ${
          result.success
            ? "bg-emerald-50 border-emerald-200 text-emerald-700"
            : "bg-amber-50 border-amber-200 text-amber-700"
        }`}>
          <div className="flex items-start gap-2">
            <span className="mt-0.5">{result.success ? "✓" : "!"}</span>
            <div className="flex-1">
              <p className="font-medium">Server: {result.message}</p>
              {result.liveness && (
                <div className="mt-2 space-y-1 text-xs border-t border-emerald-200/50 pt-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${result.liveness.passed ? "bg-emerald-500" : "bg-red-500"}`} />
                    Liveness: {result.liveness.passed ? "Passed" : "Failed"} ({result.liveness.method})
                  </div>
                  {result.liveness.method === "frame_burst" && (
                    <div className="text-slate-500">
                      Blur: {(result.liveness.blur_score * 100).toFixed(0)}% |
                      Color: {(result.liveness.color_score * 100).toFixed(0)}% |
                      Blink: {result.liveness.blink_detected ? "Yes" : "No"}
                    </div>
                  )}
                  {result.liveness.method === "challenge" && (
                    <div className="text-slate-500">
                      Challenge: {result.liveness.challenge_verified ? "Verified ✓" : "Failed"}
                    </div>
                  )}
                  {result.liveness.method === "client" && (
                    <div className="text-slate-500">
                      Server-side liveness skipped (client check used)
                    </div>
                  )}
                </div>
              )}
              {result.user_id && (
                <div className="mt-2 space-y-1">
                  <div>
                    <span className="text-xs text-slate-500">User ID:</span>{" "}
                    <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-xs">{result.user_id}</code>
                  </div>
                  {result.name && <div><span className="text-xs text-slate-500">Name:</span> {result.name}</div>}
                  {result.distance !== undefined && (
                    <div>
                      <span className="text-xs text-slate-500">Distance:</span>{" "}
                      <span className="font-mono">{result.distance.toFixed(4)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-5">
        {!cameraActive && !result && !error && (
          <div>
            <div className="flex rounded-lg border border-slate-200 overflow-hidden mb-4">
              <button
                onClick={() => setMethod("frame_burst")}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  method === "frame_burst"
                    ? "bg-indigo-600 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Frame Burst
              </button>
              <button
                onClick={() => setMethod("challenge")}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  method === "challenge"
                    ? "bg-indigo-600 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Challenge
              </button>
              <button
                onClick={() => setMethod("client")}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  method === "client"
                    ? "bg-indigo-600 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Client
              </button>
            </div>

            <div className="text-center py-4">
              <button
                onClick={startCamera}
                className="px-6 py-3 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 shadow-sm transition-colors"
              >
                Start Camera
              </button>
            </div>
          </div>
        )}

        {cameraActive && (
          <div>
            <div className="relative">
              <video ref={videoRef} autoPlay playsInline className="w-full rounded-lg border border-slate-200" style={{ transform: 'scaleX(-1)' }} />
              {method === "client" && showFaceMesh && (
                <canvas
                  ref={overlayRef}
                  className="absolute inset-0 w-full h-full pointer-events-none rounded-lg"
                />
              )}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-56 h-64 rounded-[50%] border-2 border-white/40 shadow-[0_0_40px_rgba(0,0,0,0.15)]" />
              </div>
            </div>

            {verifyState === "idle" && (
              <div>
                {method === "frame_burst" && (
                  <div>
                    {capturingFrames > 0 && (
                      <div className="mt-3 flex items-center gap-2 text-sm text-indigo-600 font-medium">
                        <div className="w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-indigo-500 rounded-full transition-all duration-200" style={{ width: `${(capturingFrames / LIVENESS_FRAME_COUNT) * 100}%` }} />
                        </div>
                        Capturing {capturingFrames}/{LIVENESS_FRAME_COUNT}
                      </div>
                    )}

                    {!loading && capturingFrames === 0 && (
                      <p className="mt-3 text-center text-sm text-slate-500">Look at the camera and blink naturally</p>
                    )}

                    {!loading && capturingFrames === 0 && (
                      <button
                        onClick={handleFrameBurstVerify}
                        className="mt-3 w-full bg-indigo-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 shadow-sm transition-colors"
                      >
                        Verify
                      </button>
                    )}
                  </div>
                )}

                {method === "challenge" && (
                  <div>
                    <div className="text-center py-4">
                      <button
                        onClick={startChallenge}
                        className="px-6 py-3 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 shadow-sm transition-colors"
                      >
                        Start Challenge
                      </button>
                    </div>
                  </div>
                )}

                {method === "client" && (
                  <div>
                    {!clientServiceReady && verifyState === "idle" && (
                      <p className="mt-3 text-center text-sm text-amber-600">Loading face detection model...</p>
                    )}

                    {verifyState === "idle" && clientServiceReady && (
                      <div>
                        <div className="flex items-center justify-center gap-3 mt-3">
                          <button
                            onClick={() => setShowFaceMesh(!showFaceMesh)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                              showFaceMesh
                                ? "bg-emerald-100 text-emerald-700 border border-emerald-300"
                                : "bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200"
                            }`}
                          >
                            {showFaceMesh ? "Face Mesh: On" : "Face Mesh: Off"}
                          </button>
                        </div>
                        <div className="text-center py-4">
                          <button
                            onClick={startClientChallenge}
                            disabled={!clientServiceReady}
                            className="px-6 py-3 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 shadow-sm transition-colors disabled:opacity-50"
                          >
                            Start Challenge
                          </button>
                          <p className="mt-2 text-xs text-slate-400">You will be asked to perform a sequence of actions</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-center mt-4">
                  <button
                    onClick={stopCamera}
                    className="text-sm text-slate-500 hover:text-slate-700 font-medium"
                  >
                    Stop Camera
                  </button>
                </div>
              </div>
            )}

            {verifyState !== "idle" && (
              <div>
                {verifyState === "countdown" && (
                  <div className="mt-3 text-center">
                    <div className="text-5xl font-bold text-indigo-600">{countdown}</div>
                    <div className="text-base font-medium text-indigo-700 mt-2">
                      {stepMessage}
                    </div>
                  </div>
                )}
                {verifyState === "step_capturing" && method === "challenge" && (
                  <div className="mt-3 space-y-2">
                    <div className="text-center text-base font-medium text-indigo-700">
                      {challengeSteps[currentStep]?.instruction}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-indigo-600 font-medium justify-center">
                      <div className="w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500 rounded-full transition-all duration-200" style={{ width: `${(capturingFrames / CHALLENGE_FRAMES_PER_STEP) * 100}%` }} />
                      </div>
                      Capturing {capturingFrames}/{CHALLENGE_FRAMES_PER_STEP}
                    </div>
                  </div>
                )}

                {verifyState === "step_capturing" && method === "client" && (
                  <div className="mt-3 space-y-2">
                    <div className="text-center text-base font-medium text-indigo-700">
                      {clientChallengeSteps[clientChallengeStepIndex]?.instruction || stepMessage}
                    </div>
                    <div className="text-center text-sm text-indigo-600 font-medium">
                      {stepGuide && <span>{stepGuide}</span>}
                    </div>
                    {clientChallengeSteps[clientChallengeStepIndex]?.action === "blink" ? (
                      <div className="flex items-center gap-2 text-sm text-indigo-600 font-medium justify-center">
                        <span className="inline-block w-3 h-3 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                        Blinks: {capturingFrames}/{((clientChallengeSteps[clientChallengeStepIndex]?.params?.count as number) || 1)}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-indigo-600 font-medium justify-center">
                        {clientChallengeSteps[clientChallengeStepIndex]?.action === "turn_left" && (
                          <span className="text-2xl">{stepProgress < 0.3 ? "⬅️" : stepProgress < 0.7 ? "↩️" : "✅"}</span>
                        )}
                        {clientChallengeSteps[clientChallengeStepIndex]?.action === "turn_right" && (
                          <span className="text-2xl">{stepProgress < 0.3 ? "➡️" : stepProgress < 0.7 ? "↪️" : "✅"}</span>
                        )}
                        {clientChallengeSteps[clientChallengeStepIndex]?.action === "smile" && (
                          <span className="text-2xl">{stepProgress < 0.5 ? "😐" : stepProgress < 0.9 ? "🙂" : "😊"}</span>
                        )}
                        {clientChallengeSteps[clientChallengeStepIndex]?.action === "mouth_open" && (
                          <span className="text-2xl">{stepProgress < 0.5 ? "😶" : stepProgress < 0.9 ? "😮" : "😲"}</span>
                        )}
                        <div className="w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-indigo-500 rounded-full transition-all duration-150"
                            style={{ width: `${Math.min(100, stepProgress * 100)}%` }}
                          />
                        </div>
                        <span className="tabular-nums">{(stepProgress * 100).toFixed(0)}%</span>
                      </div>
                    )}
                  </div>
                )}

                {verifyState === "step_verifying" && (
                  <div className="mt-3 text-center text-sm text-indigo-600 font-medium">
                    Verifying step {(method === "challenge" ? currentStep : clientChallengeStepIndex) + 1}...
                  </div>
                )}

                {(verifyState === "challenge_complete" || verifyState === "verifying") && (
                  <div className="mt-3 text-center text-sm text-emerald-600 font-medium">
                    {stepMessage}
                  </div>
                )}

                {verifyState === "client_analysing" && (
                  <div className="mt-3 text-center text-sm text-indigo-600 font-medium flex items-center justify-center gap-2">
                    <span className="inline-block w-3 h-3 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                    {stepMessage}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Device ID <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <input
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-shadow"
            placeholder="e.g. camera-01"
          />
        </div>

        {(result || error) && (
          <div className="flex justify-center">
            <button
              onClick={handleTryAgain}
              className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
