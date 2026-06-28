"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useRouter } from "next/navigation";

function genId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}

export default function CreateUserPage() {
  const router = useRouter();
  const [user_id] = useState(genId);
  const [name, setName] = useState("");
  const [metadata, setMetadata] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const body: { user_id: string; name: string; metadata?: string } = { user_id, name };
      if (metadata.trim()) body.metadata = metadata;
      await api.createUser(body);
      router.push("/users");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Create User</h1>
        <p className="text-sm text-slate-500 mt-0.5">Add a new user to the system</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
          <span>⚠</span> {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-5">
        <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 rounded-lg border border-slate-200">
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">User ID</span>
          <code className="font-mono text-sm bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-700">{user_id}</code>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-shadow"
            placeholder="e.g. John Doe"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Metadata <span className="text-slate-400 font-normal">(optional JSON)</span></label>
          <textarea
            value={metadata}
            onChange={(e) => setMetadata(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-shadow"
            rows={3}
            placeholder='{"department": "engineering"}'
          />
        </div>

        <div className="flex gap-3 pt-1">
          <button
            disabled={loading}
            className="flex-1 bg-indigo-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 shadow-sm transition-colors"
          >
            {loading ? "Creating..." : "Create User"}
          </button>
          <a
            href="/users"
            className="px-5 py-2.5 rounded-lg text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}
