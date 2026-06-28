"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { api, VerifyResponse } from "@/lib/api";

export default function VerifyPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

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
    if (!file) return;
    setError("");
    setLoading(true);
    try {
      const res = await api.verify(file, deviceId || undefined);
      setResult(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Verify Face</h1>
        <p className="text-sm text-slate-500 mt-0.5">Identify a person from a face image</p>
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
            <div>
              <p className="font-medium">{result.message}</p>
              {result.user_id && (
                <div className="mt-2 space-y-1 text-sm">
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
                  {result.metadata && <div className="text-xs text-slate-400">Metadata: {result.metadata}</div>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-5">
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

        <button
          disabled={loading || !file}
          className="w-full bg-indigo-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 shadow-sm transition-colors"
        >
          {loading ? "Verifying..." : "Verify Face"}
        </button>
      </form>
    </div>
  );
}
