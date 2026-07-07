"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { api, EnrollResponse, UserResponse } from "@/lib/api";

const LIVENESS_FRAME_COUNT = 10;
const LIVENESS_FRAME_INTERVAL = 200;

export default function EnrollPage() {
  const [users, setUsers] = useState<UserResponse[]>([]);
  const [userId, setUserId] = useState("");
  const [result, setResult] = useState<EnrollResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [capturingFrames, setCapturingFrames] = useState(0);
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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      setCameraActive(true);
    } catch {
      setError("Camera access denied or unavailable.");
    }
  };

  const captureBurst = (): Promise<{ faceImage: File; livenessFrames: File[] }> => {
    return new Promise((resolve, reject) => {
      const video = videoRef.current;
      if (!video) {
        reject(new Error("Camera not available"));
        return;
      }
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) {
        reject(new Error("Camera not ready"));
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas not available"));
        return;
      }

      const frames: File[] = [];
      let captured = 0;
      const total = 1 + LIVENESS_FRAME_COUNT;

      const capture = () => {
        ctx.drawImage(video, 0, 0);
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error("Failed to capture frame"));
            return;
          }
          const label = captured === 0 ? "face" : `frame_${captured}`;
          frames.push(new File([blob], `${label}.jpg`, { type: "image/jpeg" }));
          captured++;

          if (captured === 1) {
            setCapturingFrames(0);
          } else {
            setCapturingFrames(captured - 1);
          }

          if (captured >= total) {
            const faceImage = frames[0];
            const livenessFrames = frames.slice(1);
            resolve({ faceImage, livenessFrames });
          } else {
            setTimeout(capture, captured === 1 ? 0 : LIVENESS_FRAME_INTERVAL);
          }
        }, "image/jpeg", 85);
      };

      capture();
    });
  };

  const handleEnroll = async () => {
    if (loadingRef.current || !userId) return;
    loadingRef.current = true;
    setError("");
    setResult(null);
    setLoading(true);

    try {
      if (!cameraActive) {
        setError("Camera is required for liveness check.");
        return;
      }
      const { faceImage, livenessFrames } = await captureBurst();
      const res = await api.enroll(userId, faceImage, livenessFrames);
      setResult(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
      setCapturingFrames(0);
      loadingRef.current = false;
    }
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
          <a href="/users/create" className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-sm font-medium hover:bg-indigo-100 transition-colors">
            Create a user first
          </a>
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

      {error && !error.includes("Camera") && (
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
                    Liveness: {result.liveness.passed ? "Passed" : "Failed"}
                  </div>
                  <div className="text-slate-500">
                    Blur: {(result.liveness.blur_score * 100).toFixed(0)}% |
                    Color: {(result.liveness.color_score * 100).toFixed(0)}% |
                    Blink: {result.liveness.blink_detected ? "Yes" : "No"}
                  </div>
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
            className="w-full border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-shadow"
          >
            {users.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.name} ({u.user_id})
              </option>
            ))}
          </select>
        </div>

        {!cameraActive && !error && (
          <div className="text-center py-4">
            <button
              onClick={startCamera}
              className="px-6 py-3 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 shadow-sm transition-colors"
            >
              Start Camera
            </button>
          </div>
        )}

        {cameraActive && (
          <div>
            <div className="relative">
              <video ref={videoRef} autoPlay playsInline className="w-full rounded-lg border border-slate-200" />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-56 h-64 rounded-[50%] border-2 border-white/40 shadow-[0_0_40px_rgba(0,0,0,0.15)]" />
              </div>
            </div>

            {capturingFrames > 0 && (
              <div className="mt-3 flex items-center gap-2 text-sm text-indigo-600 font-medium">
                <div className="w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded-full transition-all duration-200"
                    style={{ width: `${(capturingFrames / LIVENESS_FRAME_COUNT) * 100}%` }}
                  />
                </div>
                Capturing {capturingFrames}/{LIVENESS_FRAME_COUNT}
              </div>
            )}

            {!loading && capturingFrames === 0 && (
              <p className="mt-3 text-center text-sm text-slate-500">
                Look at the camera and blink naturally
              </p>
            )}

            {!loading && capturingFrames === 0 && (
              <button
                onClick={handleEnroll}
                disabled={!userId}
                className="mt-3 w-full bg-indigo-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 shadow-sm transition-colors"
              >
                Enroll Face
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
