"use client";

import { useEffect, useState } from "react";
import { api, UserResponse } from "@/lib/api";
import { useParams, useRouter } from "next/navigation";

export default function UserDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const router = useRouter();
  const [user, setUser] = useState<UserResponse | null>(null);
  const [editName, setEditName] = useState("");
  const [editMeta, setEditMeta] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.getUser(userId).then((u) => {
      setUser(u);
      setEditName(u.name);
      setEditMeta(u.metadata || "");
    }).catch((e) => setError(e.message))
    .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [userId]);

  const handleUpdate = async () => {
    setError("");
    setMessage("");
    try {
      const body: { name?: string; metadata?: string } = {};
      if (editName !== user?.name) body.name = editName;
      const metaTrimmed = editMeta.trim() || undefined;
      if (metaTrimmed !== (user?.metadata || undefined)) body.metadata = metaTrimmed;
      if (Object.keys(body).length === 0) return;
      await api.updateUser(userId, body);
      setMessage("User updated successfully");
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete user "${userId}"? This cannot be undone.`)) return;
    setError("");
    setMessage("");
    try {
      await api.deleteUser(userId);
      router.push("/users");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  if (loading) {
    return (
      <div className="max-w-lg mx-auto space-y-5">
        <div className="skeleton w-48 h-7" />
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="skeleton w-16 h-3" />
              <div className="skeleton w-full h-9" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error && !user) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">⚠ {error}</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
          <div className="text-3xl text-slate-300 mb-3">◎</div>
          <p className="text-slate-500 text-sm">User not found.</p>
          <a href="/users" className="mt-3 inline-flex text-indigo-600 text-sm font-medium hover:underline">← Back to users</a>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{user.name}</h1>
          <code className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-500 mt-0.5 inline-block">{user.user_id}</code>
        </div>
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
          user.face_enrolled
            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20"
            : "bg-slate-100 text-slate-500 ring-1 ring-slate-300/20"
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${user.face_enrolled ? "bg-emerald-500" : "bg-slate-400"}`} />
          {user.face_enrolled ? "Face Enrolled" : "No Face"}
        </span>
      </div>

      {(error || message) && (
        <div className={`px-4 py-3 rounded-lg text-sm flex items-center gap-2 border ${
          error ? "bg-red-50 border-red-200 text-red-700" : "bg-emerald-50 border-emerald-200 text-emerald-700"
        }`}>
          <span>{error ? "⚠" : "✓"}</span> {error || message}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-5">
        <div className="grid grid-cols-2 gap-4 pb-4 border-b border-slate-100">
          <div>
            <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">User ID</div>
            <code className="font-mono text-sm text-slate-800 mt-1 block">{user.user_id}</code>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">Created</div>
            <div className="text-sm text-slate-800 mt-1">{new Date(user.created_at).toLocaleString()}</div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Name</label>
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-shadow"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Metadata</label>
          <textarea
            value={editMeta}
            onChange={(e) => setEditMeta(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-shadow"
            rows={3}
          />
        </div>

        <div className="flex gap-3 pt-1">
          <button onClick={handleUpdate} className="flex-1 bg-indigo-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 shadow-sm transition-colors">
            Save Changes
          </button>
          <button onClick={handleDelete} className="px-5 py-2.5 rounded-lg text-sm font-medium border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
