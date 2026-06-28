"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { api, EnrollResponse, UserResponse } from "@/lib/api";

export default function EnrollPage() {
  const [users, setUsers] = useState<UserResponse[]>([]);
  const [userId, setUserId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<EnrollResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

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

  const captureFromCamera = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const f = new File([blob], "capture.jpg", { type: "image/jpeg" });
      setFile(f);
      setPreview(URL.createObjectURL(f));
      setResult(null);
      setError("");
      stopCamera();
    }, "image/jpeg");
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
    setError("");
    stopCamera();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !userId) return;
    setError("");
    setLoading(true);
    try {
      const res = await api.enroll(userId, file);
      setResult(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
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
        <div className={`px-4 py-3 rounded-lg text-sm border flex items-start gap-2 ${
          result.success
            ? "bg-emerald-50 border-emerald-200 text-emerald-700"
            : "bg-amber-50 border-amber-200 text-amber-700"
        }`}>
          <span className="mt-0.5">{result.success ? "✓" : "!"}</span>
          <span>{result.message}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-5">
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

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Face Image</label>

          <div className="flex gap-2 mb-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Choose Photo
            </button>
            <button
              type="button"
              onClick={cameraActive ? stopCamera : startCamera}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              {cameraActive ? "Stop Camera" : "Capture Photo"}
            </button>
          </div>

          <input ref={fileRef} type="file" accept="image/jpeg,image/png" onChange={handleFileChange} className="hidden" />

          {cameraActive && (
            <div className="space-y-2">
              <video ref={videoRef} autoPlay playsInline className="w-full rounded-lg border border-slate-200" />
              <button
                type="button"
                onClick={captureFromCamera}
                className="w-full bg-emerald-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
              >
                Snap Photo
              </button>
            </div>
          )}

          {error && error.includes("Camera") && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mt-2">{error}</div>
          )}

          {preview && (
            <div className="mt-3">
              <div className="text-xs text-slate-400 mb-1.5">Preview</div>
              <img src={preview} alt="preview" className="max-h-48 rounded-lg border border-slate-200" />
            </div>
          )}
        </div>

        <button
          disabled={loading || !file || !userId}
          className="w-full bg-indigo-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 shadow-sm transition-colors"
        >
          {loading ? "Enrolling..." : "Enroll Face"}
        </button>
      </form>
    </div>
  );
}
