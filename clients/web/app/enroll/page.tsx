"use client";

import Link from "next/link";
import { useState, useRef, useEffect, useCallback } from "react";
import { api, EnrollResponse, UserResponse, ChallengeStep, LivenessMethod } from "@/lib/api";

const LIVENESS_FRAME_COUNT = 10;
const LIVENESS_FRAME_INTERVAL = 200;
const CHALLENGE_FRAMES_PER_STEP = 15;
const CHALLENGE_FRAME_INTERVAL = 80;

type EnrollState = "idle" | "challenge_init" | "countdown" | "step_capturing" | "step_verifying" | "challenge_complete" | "enrolling" | "done";

export default function EnrollPage() {
  const [users, setUsers] = useState<UserResponse[]>([]);
  const [userId, setUserId] = useState("");
  const [result, setResult] = useState<EnrollResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [capturingFrames, setCapturingFrames] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [method, setMethod] = useState<LivenessMethod>("frame_burst");
  const [enrollState, setEnrollState] = useState<EnrollState>("idle");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [challengeSteps, setChallengeSteps] = useState<ChallengeStep[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [stepMessage, setStepMessage] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    api.listUsers(1, 100).then((r) => {
      setUsers(r.users);
      if (r.users.length > 0) setUserId(r.users[0].user_id);
    }).catch((e) => setError(e.message));
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
    setEnrollState("idle");
    setChallengeId(null);
    setChallengeSteps([]);
    setCurrentStep(0);
    setStepMessage("");
    setCountdown(0);
    setCapturingFrames(0);
  }, []);

  useEffect(() => {
    return stopCamera;
  }, [stopCamera]);

  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraActive]);

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

      const capture = () => {
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
            setTimeout(capture, captured === 1 ? 0 : interval);
          }
        }, "image/jpeg", 85);
      };
      capture();
    });
  };

  const captureStepFrames = (count: number, interval: number): Promise<File[]> => {
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

      const capture = () => {
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(video, -w, 0);
        ctx.restore();
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error("Failed to capture frame")); return; }
          frames.push(new File([blob], `frame_${captured}.jpg`, { type: "image/jpeg" }));
          captured++;
          setCapturingFrames(captured);

          if (captured >= count) {
            resolve(frames);
          } else {
            setTimeout(capture, interval);
          }
        }, "image/jpeg", 85);
      };
      capture();
    });
  };

  const startChallenge = async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setError("");
    setResult(null);
    setEnrollState("challenge_init");
    setStepMessage("");

    try {
      const challenge = await api.initChallenge();
      const steps = challenge.steps;
      setChallengeId(challenge.challenge_id);
      setChallengeSteps(steps);
      setCurrentStep(0);
      setEnrollState("idle");
      setStepMessage(steps[0].instruction);
      loadingRef.current = false;
      setTimeout(() => executeChallengeStep(challenge.challenge_id, 0, steps), 500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to init challenge");
      setEnrollState("idle");
      loadingRef.current = false;
    }
  };

  const executeChallengeStep = async (cid: string, stepIndex: number, steps: ChallengeStep[]) => {
    if (!cid) return;
    setEnrollState("countdown");
    setStepMessage(steps[stepIndex].instruction);
    for (let i = 3; i >= 1; i--) {
      setCountdown(i);
      await new Promise(r => setTimeout(r, 1000));
    }
    setCountdown(0);
    setEnrollState("step_capturing");

    try {
      const frames = await captureStepFrames(CHALLENGE_FRAMES_PER_STEP, CHALLENGE_FRAME_INTERVAL);
      setEnrollState("step_verifying");

      const stepResult = await api.verifyChallengeStep(cid, stepIndex, frames);

      if (!stepResult.passed) {
        setError(`Step ${stepIndex + 1} failed: ${stepResult.message}`);
        setEnrollState("idle");
        setCapturingFrames(0);
        return;
      }

      setCapturingFrames(0);

      if (stepResult.completed) {
        setEnrollState("challenge_complete");
        setStepMessage("Challenge passed! Enrolling...");
        await doChallengeEnroll(cid);
      } else if (stepResult.next_step_index !== undefined) {
        setCurrentStep(stepResult.next_step_index);
        setEnrollState("idle");
        setStepMessage(steps[stepResult.next_step_index].instruction);
        setTimeout(() => executeChallengeStep(cid, stepResult.next_step_index!, steps), 500);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Step verification failed");
      setEnrollState("idle");
      setCountdown(0);
      setCapturingFrames(0);
    }
  };

  const doChallengeEnroll = async (cid: string) => {
    if (!cid) return;
    setEnrollState("enrolling");
    setLoading(true);

    try {
      const faceImage = await captureSingleFrame();
      const res = await api.enroll(userId, faceImage, [], "challenge", cid);
      setResult(res);
      setEnrollState("done");
      if (res.success) stopCamera();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Enrollment failed");
      setEnrollState("idle");
    } finally {
      setLoading(false);
    }
  };

  const handleFrameBurstEnroll = async () => {
    if (loadingRef.current || !userId) return;
    loadingRef.current = true;
    setError("");
    setResult(null);
    setLoading(true);

    try {
      const { faceImage, livenessFrames } = await captureBurst(LIVENESS_FRAME_COUNT, LIVENESS_FRAME_INTERVAL);
      const res = await api.enroll(userId, faceImage, livenessFrames, "frame_burst");
      setResult(res);
      setEnrollState("done");
      if (res.success) stopCamera();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
      setCapturingFrames(0);
      loadingRef.current = false;
    }
  };

  const handleTryAgain = () => {
    setResult(null);
    setError("");
    setEnrollState("idle");
  };

  if (users.length === 0 && !error) {
    return (
      <div className="max-w-lg mx-auto space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Enroll Face</h1>
          <p className="text-sm text-slate-500 mt-0.5">Register a face image for an existing user</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
          <div className="text-3xl text-slate-300 mb-3">○</div>
          <p className="text-slate-500 text-sm">No users found.</p>
          <Link href="/users/create" className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-sm font-medium hover:bg-indigo-100 transition-colors">
            Create a user first
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Enroll Face</h1>
        <p className="text-sm text-slate-500 mt-0.5">Register a face image for an existing user</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
          <span>⚠</span> {error}
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
              <p className="font-medium">{result.message}</p>
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
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">User</label>
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            required
            disabled={cameraActive || enrollState !== "idle"}
            className="w-full border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-shadow disabled:opacity-50"
          >
            {users.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.name} ({u.user_id})
              </option>
            ))}
          </select>
        </div>

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
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-56 h-64 rounded-[50%] border-2 border-white/40 shadow-[0_0_40px_rgba(0,0,0,0.15)]" />
              </div>
            </div>

            {enrollState === "idle" && (
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
                        onClick={handleFrameBurstEnroll}
                        disabled={!userId}
                        className="mt-3 w-full bg-indigo-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 shadow-sm transition-colors"
                      >
                        Enroll Face
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

            {enrollState !== "idle" && (
              <div>
                {enrollState === "countdown" && (
                  <div className="mt-3 text-center">
                    <div className="text-5xl font-bold text-indigo-600">{countdown}</div>
                    <div className="text-base font-medium text-indigo-700 mt-2">
                      {stepMessage}
                    </div>
                  </div>
                )}
                {enrollState === "step_capturing" && (
                  <div className="mt-3 space-y-2">
                    <div className="text-center text-base font-medium text-indigo-700">
                      {challengeSteps[currentStep]?.instruction || stepMessage}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-indigo-600 font-medium justify-center">
                      <div className="w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500 rounded-full transition-all duration-200" style={{ width: `${(capturingFrames / CHALLENGE_FRAMES_PER_STEP) * 100}%` }} />
                      </div>
                      Capturing {capturingFrames}/{CHALLENGE_FRAMES_PER_STEP}
                    </div>
                  </div>
                )}

                {enrollState === "step_verifying" && (
                  <div className="mt-3 text-center text-sm text-indigo-600 font-medium">
                    Verifying step {currentStep + 1}...
                  </div>
                )}

                {(enrollState === "challenge_complete" || enrollState === "enrolling") && (
                  <div className="mt-3 text-center text-sm text-emerald-600 font-medium">
                    {stepMessage}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

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
