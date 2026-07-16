"use client";

import { useEffect, useState } from "react";
import { api, HealthResponse } from "@/lib/api";

export default function Dashboard() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState("");
  const [userCount, setUserCount] = useState(0);

  useEffect(() => {
    api.health().then(setHealth).catch((e) => setError(e.message));
    api.listUsers(1, 1).then((r) => setUserCount(r.total)).catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">System overview and health status</p>
        </div>
        {health && (
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
            health.status === "healthy" ? "bg-green-50 text-green-700 ring-1 ring-green-600/20" : "bg-red-50 text-red-700 ring-1 ring-red-600/20"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${health.status === "healthy" ? "bg-green-500" : "bg-red-500"}`} />
            {health.status}
          </span>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
          <span className="text-lg">⚠</span> {error}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">API Status</div>
          <div className={`mt-2 text-2xl font-bold ${health?.status === "healthy" ? "text-emerald-600" : "text-slate-300"}`}>
            {health?.status ?? <span className="skeleton inline-block w-20 h-7 align-middle" />}
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">Version</div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{health?.version ?? <span className="skeleton inline-block w-16 h-7 align-middle" />}</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">MySQL</div>
          <div className={`mt-2 text-2xl font-bold ${health?.checks.mysql === true ? "text-emerald-600" : health?.checks.mysql === false ? "text-red-500" : "text-slate-300"}`}>
            {health ? (health.checks.mysql ? "Connected" : "Down") : <span className="skeleton inline-block w-20 h-7 align-middle" />}
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">ChromaDB</div>
          <div className={`mt-2 text-2xl font-bold ${health?.checks.chromadb === true ? "text-emerald-600" : health?.checks.chromadb === false ? "text-red-500" : "text-slate-300"}`}>
            {health ? (health.checks.chromadb ? "Connected" : "Down") : <span className="skeleton inline-block w-20 h-7 align-middle" />}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">Total Users</div>
          <div className="mt-1 text-3xl font-bold text-slate-900">{userCount}</div>
          <div className="mt-3 flex gap-3">
            <a href="/users" className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">View all →</a>
            <a href="/users/create" className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">Add user →</a>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">Quick Actions</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href="/enroll" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-sm font-medium hover:bg-indigo-100 transition-colors">
              ○ Face Enrollment
            </a>
            <a href="/verify" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-sm font-medium hover:bg-indigo-100 transition-colors">
              ◐ Face Verification
            </a>
            <a href="/logs" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-sm font-medium hover:bg-indigo-100 transition-colors">
              ⊞ Activity Logs
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
