"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { api, VerifyResponse, LivenessMethod, ClientLivenessResult, ChallengeStep } from "@/lib/api";
import { ClientLivenessService, ClientChallengeStep } from "@/lib/client-liveness";

interface Props {
  open: boolean;
  onClose: () => void;
}

const LIVENESS_FRAME_COUNT = 5;
const LIVENESS_FRAME_INTERVAL = 200;
const CHALLENGE_FRAMES_PER_STEP = 15;
const CHALLENGE_FRAME_INTERVAL = 80;
const DETECTION_TIMEOUT_MS = 15000;

export default function VerifyModal({ open, onClose }: Props) {
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [capturing, setCapturing] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [method, setMethod] = useState<LivenessMethod>("frame_burst");
  const [verifyState, setVerifyState] = useState<"idle" | "challenge_init" | "countdown" | "step_capturing" | "step_verifying" | "challenge_complete" | "client_analysing" | "verifying">("idle");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [challengeSteps, setChallengeSteps] = useState<ChallengeStep[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [stepMessage, setStepMessage] = useState("");
  const [stepProgress, setStepProgress] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [clientChallengeSteps, setClientChallengeSteps] = useState<ClientChallengeStep[]>([]);
  const [clientChallengeStepIndex, setClientChallengeStepIndex] = useState(0);
  const [stepGuide, setStepGuide] = useState("");
  const [clientReady, setClientReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loadingRef = useRef(false);
  const detectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clientRef = useRef<ClientLivenessService | null>(null);

  useEffect(() => {
    ClientLivenessService.getInstance().then((svc) => { clientRef.current = svc; setClientReady(true); });
  }, []);

  const stopCamera = useCallback(() => {
    if (detectTimerRef.current) clearTimeout(detectTimerRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
    setVerifyState("idle");
    setChallengeId(null);
    setChallengeSteps([]);
    setCurrentStep(0);
    setStepMessage("");
    setCountdown(0);
    setCapturing(0);
    setClientChallengeSteps([]);
    setClientChallengeStepIndex(0);
  }, []);

  useEffect(() => {
    if (open) {
      setResult(null);
      setError("");
      setLoading(false);
      setCapturing(0);
      setCameraReady(false);
      setVerifyState("idle");
      setChallengeId(null);
      setChallengeSteps([]);
      setCurrentStep(0);
      setStepMessage("");
      setStepProgress(0);
      setCountdown(0);
      setStepGuide("");
      setClientChallengeSteps([]);
      setClientChallengeStepIndex(0);
    }
    return stopCamera;
  }, [open, stopCamera]);

  useEffect(() => {
    if (cameraReady && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraReady]);

  const startCamera = async () => {
    setError("");
    setResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
        setCameraReady(true);
        handleVerify();
      }
    } catch {
      setError("Camera access denied or unavailable.");
    }
  };

  const captureBurst = (count: number, interval: number): Promise<{ faceImage: File; livenessFrames: File[] }> =>
    new Promise((resolve, reject) => {
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
          if (!blob) { reject(new Error("Failed to capture")); return; }
          frames.push(new File([blob], `${captured === 0 ? "face" : `frame_${captured}`}.jpg`, { type: "image/jpeg" }));
          captured++;
          setCapturing(Math.min(captured - 1, count));
          if (captured >= total) resolve({ faceImage: frames[0], livenessFrames: frames.slice(1) });
          else setTimeout(doCapture, captured === 1 ? 0 : interval);
        }, "image/jpeg", 85);
      };
      doCapture();
    });

  const captureStepFrames = (count: number, interval: number, mirror = true): Promise<File[]> =>
    new Promise((resolve, reject) => {
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
        if (mirror) { ctx.save(); ctx.scale(-1, 1); ctx.drawImage(video, -w, 0); ctx.restore(); }
        else ctx.drawImage(video, 0, 0);
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error("Failed to capture")); return; }
          frames.push(new File([blob], `frame_${captured}.jpg`, { type: "image/jpeg" }));
          captured++;
          setCapturing(captured);
          if (captured >= count) resolve(frames);
          else setTimeout(doCapture, interval);
        }, "image/jpeg", 85);
      };
      doCapture();
    });

  const captureSingleFrame = (): Promise<File> =>
    new Promise((resolve, reject) => {
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

  // Frame burst
  const handleFrameBurst = async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const { faceImage, livenessFrames } = await captureBurst(LIVENESS_FRAME_COUNT, LIVENESS_FRAME_INTERVAL);
      setVerifyState("verifying");
      const res = await api.verify(faceImage, livenessFrames, undefined, "frame_burst");
      setResult(res);
      setVerifyState("idle");
      if (res.success) setTimeout(stopCamera, 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setLoading(false);
      setCapturing(0);
      loadingRef.current = false;
    }
  };

  // Challenge flow
  const startChallenge = async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setError("");
    setResult(null);
    setVerifyState("challenge_init");
    try {
      const challenge = await api.initChallenge();
      setChallengeId(challenge.challenge_id);
      setChallengeSteps(challenge.steps);
      setCurrentStep(0);
      setVerifyState("idle");
      setStepMessage(challenge.steps[0].instruction);
      loadingRef.current = false;
      setTimeout(() => executeChallengeStep(challenge.challenge_id, 0, challenge.steps), 500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to init challenge");
      setVerifyState("idle");
      loadingRef.current = false;
    }
  };

  const executeChallengeStep = async (cid: string, stepIndex: number, steps: ChallengeStep[]) => {
    if (!cid) return;
    setVerifyState("countdown");
    setStepMessage(steps[stepIndex].instruction);
    for (let i = 3; i >= 1; i--) { setCountdown(i); await new Promise(r => setTimeout(r, 1000)); }
    setCountdown(0);
    setVerifyState("step_capturing");
    try {
      const frames = await captureStepFrames(CHALLENGE_FRAMES_PER_STEP, CHALLENGE_FRAME_INTERVAL);
      setVerifyState("step_verifying");
      const stepResult = await api.verifyChallengeStep(cid, stepIndex, frames);
      if (!stepResult.passed) {
        setError(`Step ${stepIndex + 1} failed: ${stepResult.message}`);
        setVerifyState("idle");
        setCapturing(0);
        return;
      }
      setCapturing(0);
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
      setCapturing(0);
    }
  };

  const doChallengeVerify = async (cid: string) => {
    setVerifyState("verifying");
    setLoading(true);
    try {
      const faceImage = await captureSingleFrame();
      const res = await api.verify(faceImage, [], undefined, "challenge", cid);
      setResult(res);
      setVerifyState("idle");
      if (res.success) setTimeout(stopCamera, 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Verification failed");
      setVerifyState("idle");
    } finally {
      setLoading(false);
    }
  };

  // Client flow
  const startClientChallenge = async () => {
    if (loadingRef.current) return;
    const svc = clientRef.current;
    if (!svc || !svc.isLoaded) { setError("Client liveness model not loaded yet"); return; }
    loadingRef.current = true;
    setError("");
    setResult(null);
    setVerifyState("challenge_init");
    const steps = svc.generateChallengeSteps();
    setClientChallengeSteps(steps);
    setClientChallengeStepIndex(0);
    setVerifyState("idle");
    setStepMessage(steps[0].instruction);
    loadingRef.current = false;
    setTimeout(() => executeClientStep(0, steps), 500);
  };

  const formatFeedback = (r: { guide?: string; progress?: number }): string => {
    const p = Math.min(1, Math.max(0, r.progress ?? 0));
    return r.guide ? `${r.guide} ${"█".repeat(Math.round(p * 10))}${"░".repeat(10 - Math.round(p * 10))} ${(p * 100).toFixed(0)}%` : "";
  };

  const detectAction = (svc: ClientLivenessService, video: HTMLVideoElement, action: string, params: Record<string, unknown>, instruction: string): Promise<boolean> =>
    new Promise((resolve) => {
      const timeout = setTimeout(() => { if (detectTimerRef.current) clearTimeout(detectTimerRef.current); resolve(false); }, DETECTION_TIMEOUT_MS);
      let inBlink = false, blinkCount = 0;
      const expected = action === "blink" ? (params.count as number) || 1 : 0;
      let holdCount = 0;
      const HOLD_REQUIRED = action === "blink" ? 1 : 3;
      let processing = false;
      const check = async () => {
        if (processing) { detectTimerRef.current = setTimeout(check, 50); return; }
        processing = true;
        try {
          if (action === "blink") {
            setStepMessage(instruction);
            const ear = await svc.computeEarFromVideo(video);
            if (ear !== null) {
              if (ear < 0.2) { if (!inBlink) inBlink = true; }
              else if (inBlink) { blinkCount++; inBlink = false; setCapturing(blinkCount); if (blinkCount >= expected) { clearTimeout(timeout); resolve(true); return; } }
            }
          } else {
            const r = await svc.verifyActionOnFrame(video, action);
            setStepMessage(instruction);
            setStepProgress(r.progress ?? 0);
            setStepGuide(formatFeedback(r));
            if (r.detected) { holdCount++; if (holdCount >= HOLD_REQUIRED) { clearTimeout(timeout); resolve(true); return; } }
            else holdCount = 0;
          }
        } catch { clearTimeout(timeout); resolve(false); return; }
        finally { processing = false; }
        detectTimerRef.current = setTimeout(check, 150);
      };
      detectTimerRef.current = setTimeout(check, 150);
    });

  const executeClientStep = async (stepIndex: number, steps: ClientChallengeStep[]) => {
    const svc = clientRef.current;
    if (!svc) return;
    setVerifyState("countdown");
    setStepMessage(steps[stepIndex].instruction);
    for (let i = 3; i >= 1; i--) { setCountdown(i); await new Promise(r => setTimeout(r, 1000)); }
    setCountdown(0);
    const video = videoRef.current;
    if (!video || !video.videoWidth) { setError("Camera not ready"); setVerifyState("idle"); return; }
    setCapturing(0);
    setVerifyState("step_capturing");
    try {
      const detected = await detectAction(svc, video, steps[stepIndex].action, steps[stepIndex].params, steps[stepIndex].instruction);
      if (!detected) { setError(`Step ${stepIndex + 1} failed`); setVerifyState("idle"); setCapturing(0); return; }
      setCapturing(0);
      if (stepIndex + 1 >= steps.length) {
        setVerifyState("challenge_complete");
        setStepMessage("All challenges passed! Verifying...");
        await handleClientVerify();
      } else {
        setClientChallengeStepIndex(stepIndex + 1);
        setVerifyState("idle");
        setStepMessage(steps[stepIndex + 1].instruction);
        setTimeout(() => executeClientStep(stepIndex + 1, steps), 500);
      }
    } catch { setError("Step failed"); setVerifyState("idle"); setCapturing(0); }
  };

  const handleClientVerify = async () => {
    setVerifyState("verifying");
    setLoading(true);
    try {
      const faceImage = await captureSingleFrame();
      const res = await api.verify(faceImage, [], undefined, "client");
      setResult(res);
      setVerifyState("idle");
      if (res.success) setTimeout(stopCamera, 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Verification failed");
      setVerifyState("idle");
    } finally { setLoading(false); }
  };

  const handleVerify = () => {
    if (method === "challenge") startChallenge();
    else if (method === "client") startClientChallenge();
    else handleFrameBurst();
  };

  const showBusy = loading || verifyState !== "idle";

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-[scaleIn_0.2s_ease-out]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">Face Verification</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors text-xl leading-none">&times;</button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">⚠ {error}</div>
          )}

          {/* Method selector - always visible while idle */}
          {!showBusy && !result && (
            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
              {(["frame_burst", "challenge", "client"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMethod(m)}
                  className={`flex-1 py-2 text-xs font-medium transition-colors ${
                    method === m ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {m === "frame_burst" ? "Auto" : m === "challenge" ? "Guided" : "Local"}
                </button>
              ))}
            </div>
          )}

          {/* Result card with separate try-again */}
          {result && (
            <div>
              <div className={`px-4 py-3 rounded-xl text-sm border ${
                result.success ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"
              }`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2 h-2 rounded-full ${result.success ? "bg-emerald-500" : "bg-amber-500"}`} />
                  <span className={`font-semibold ${result.success ? "text-emerald-800" : "text-amber-800"}`}>
                    {result.success ? "Verified" : "Not Matched"}
                  </span>
                </div>
                <p className={`text-xs ${result.success ? "text-emerald-700" : "text-amber-700"}`}>{result.message}</p>
                {result.user_id && (
                  <div className="mt-2 pt-2 border-t border-inherit space-y-1 text-xs">
                    <div><span className="text-slate-500">User:</span> <code className="font-mono bg-slate-100 px-1 rounded">{result.user_id}</code></div>
                    {result.name && <div><span className="text-slate-500">Name:</span> {result.name}</div>}
                    {result.distance !== undefined && <div><span className="text-slate-500">Distance:</span> {result.distance.toFixed(4)}</div>}
                  </div>
                )}
              </div>
              <button
                onClick={() => { stopCamera(); setResult(null); setError(""); }}
                className="mt-3 w-full py-2.5 rounded-xl text-sm font-medium border border-indigo-200 text-indigo-600 hover:bg-indigo-50 transition-colors"
              >
                Try Again
              </button>
            </div>
          )}

          {/* Video area - always mounted, visible whenever camera is on and no result */}
          <div className={`${cameraReady && !result ? "block" : "hidden"}`}>
            <div className="relative rounded-xl overflow-hidden bg-black">
              <video ref={videoRef} autoPlay playsInline muted className="w-full" style={{ transform: "scaleX(-1)" }} />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-40 h-48 rounded-[50%] border-2 border-white/50 shadow-[0_0_30px_rgba(0,0,0,0.2)]" />
              </div>
            </div>
          </div>

          {/* Busy states */}
          {showBusy && (
            <div className="text-center text-sm text-indigo-600 font-medium space-y-2">
              {/* Auto frame-burst capture phase */}
              {loading && verifyState === "idle" && capturing > 0 && (
                <div>
                  <div className="text-base font-medium text-indigo-700">Smile for the camera</div>
                  <div className="flex items-center gap-2 justify-center mt-2 text-sm">
                    <div className="w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${(capturing / LIVENESS_FRAME_COUNT) * 100}%` }} />
                    </div>
                    Capturing {capturing}/{LIVENESS_FRAME_COUNT}
                  </div>
                </div>
              )}
              {verifyState === "countdown" && (
                <div>
                  <div className="text-5xl font-bold text-indigo-600">{countdown}</div>
                  <div className="mt-2 text-base">{stepMessage}</div>
                </div>
              )}
              {verifyState === "step_capturing" && (
                <div>
                  <div className="text-base font-medium text-indigo-700">{stepMessage}</div>
                  {method === "challenge" && (
                    <div className="flex items-center gap-2 justify-center mt-2">
                      <div className="w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${(capturing / CHALLENGE_FRAMES_PER_STEP) * 100}%` }} />
                      </div>
                      Capturing {capturing}/{CHALLENGE_FRAMES_PER_STEP}
                    </div>
                  )}
                  {method === "client" && (
                    <div className="mt-2">
                      {clientChallengeSteps[clientChallengeStepIndex]?.action === "blink" ? (
                        <div className="flex items-center gap-2 justify-center text-sm">
                          <span className="inline-block w-3 h-3 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                          Blinks: {capturing}/{((clientChallengeSteps[clientChallengeStepIndex]?.params?.count as number) || 1)}
                        </div>
                      ) : stepGuide ? (
                        <div className="text-sm">{stepGuide}</div>
                      ) : (
                        <span className="inline-block w-3 h-3 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                      )}
                    </div>
                  )}
                </div>
              )}
              {(verifyState === "step_verifying" || verifyState === "challenge_complete" || verifyState === "verifying" || verifyState === "client_analysing") && (
                <div className="flex items-center justify-center gap-2">
                  <span className="inline-block w-3 h-3 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                  {stepMessage || (loading && capturing > 0 ? `Capturing ${capturing}/${LIVENESS_FRAME_COUNT}` : loading ? "Verifying..." : "")}
                </div>
              )}
            </div>
          )}

          {/* No-camera initial state */}
          {!cameraReady && !showBusy && !result && (
            <div className="text-center py-6">
              <div className="text-4xl text-slate-300 mb-3">◐</div>
              <p className="text-sm text-slate-500 mb-4">Open your camera to verify a face</p>
              <button
                onClick={startCamera}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all"
              >
                <span>📷</span> Start Camera
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
