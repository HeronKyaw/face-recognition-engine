"use client";

import { useEffect, useState } from "react";
import { api, HealthResponse, VerificationLog } from "@/lib/api";
import VerifyModal from "@/components/VerifyModal";

const quickActions = [
  { href: "/users", label: "Manage Users", icon: "◎", desc: "View, create, and manage registered users" },
  { href: "/users/create", label: "Add User", icon: "+", desc: "Register a new user identity" },
  { href: "/logs", label: "Activity Log", icon: "⊞", desc: "View verification and enrollment history" },
];

function ActivityGraph({ logs }: { logs: VerificationLog[] }) {
  const maxH = 100;
  const days = 14;
  const now = new Date();
  const dayKeys: string[] = [];
  const labelMap = new Map<string, number>();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    dayKeys.push(key);
    labelMap.set(key, days - 1 - i);
  }

  const buckets: { success: number; failed: number }[] = Array.from({ length: days }, () => ({ success: 0, failed: 0 }));

  for (const log of logs) {
    const logDate = new Date(log.created_at + (log.created_at.endsWith("Z") ? "" : "Z")).toISOString().slice(0, 10);
    const idx = labelMap.get(logDate);
    if (idx !== undefined) {
      if (log.success) buckets[idx].success++;
      else buckets[idx].failed++;
    }
  }

  const maxVal = Math.max(1, ...buckets.map((b) => b.success + b.failed));

  return (
    <div>
      <div className="flex items-center gap-4 mb-3">
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className="w-2 h-2 rounded-sm bg-emerald-400" /> Success
        </span>
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className="w-2 h-2 rounded-sm bg-red-400" /> Failed
        </span>
      </div>
      <div className="flex items-end gap-1.5 h-28" style={{ height: `${maxH}px` }}>
        {buckets.map((b, i) => {
          const total = b.success + b.failed;
          const barH = total > 0 ? Math.round((total / maxVal) * maxH) : 2;
          const successH = total > 0 ? Math.round((b.success / maxVal) * maxH) : 0;
          const label = dayKeys[i].slice(5);
          return (
            <div key={dayKeys[i]} className="flex-1 flex flex-col justify-end items-center" title={`${label}: ${b.success} success, ${b.failed} failed`}>
              <div className="w-full rounded-t-md overflow-hidden" style={{ height: `${barH}px` }}>
                {b.success > 0 && <div className="bg-emerald-400" style={{ height: `${successH}px` }} />}
                {b.failed > 0 && <div className="bg-red-400" style={{ height: `${barH - successH}px` }} />}
              </div>
              <div className="text-[9px] text-slate-400 font-mono mt-1 truncate w-full text-center">{label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState("");
  const [userCount, setUserCount] = useState(0);
  const [enrolledCount, setEnrolledCount] = useState(0);
  const [logs, setLogs] = useState<VerificationLog[]>([]);
  const [verifyOpen, setVerifyOpen] = useState(false);

  useEffect(() => {
    api.health().then(setHealth).catch((e) => setError(e.message));
    api.listUsers(1, 100).then((r) => {
      setUserCount(r.total);
      setEnrolledCount(r.users.filter((u) => u.face_enrolled).length);
    }).catch(() => {});
    api.listLogs({ page: 1, page_size: 100 }).then((r) => setLogs(r.logs)).catch(() => {});
  }, []);

  const healthValue = (key: string): string | boolean => {
    if (!health) return "";
    if (key === "status") return health.status;
    if (key === "version") return health.version;
    return health.checks[key as keyof typeof health.checks] ?? false;
  };

  const isHealthy = (key: string): boolean | null => {
    if (!health) return null;
    if (key === "status") return health.status === "healthy";
    if (key === "version") return true;
    return health.checks[key as keyof typeof health.checks] ?? false;
  };

  const statCards = [
    { label: "API Status", key: "status", icon: "◉", gradient: "from-emerald-500 to-teal-600" },
    { label: "Version", key: "version", icon: "⚙", gradient: "from-indigo-500 to-purple-600" },
    { label: "MySQL", key: "mysql", icon: "▤", gradient: "from-sky-500 to-blue-600" },
    { label: "ChromaDB", key: "chromadb", icon: "◈", gradient: "from-violet-500 to-fuchsia-600" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">System overview and activity at a glance</p>
        </div>
        {health && (
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
            health.status === "healthy" ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20" : "bg-red-50 text-red-700 ring-1 ring-red-600/20"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${health.status === "healthy" ? "bg-emerald-500 animate-pulse" : "bg-red-500"}`} />
            {health.status}
          </span>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
          <span className="text-lg">⚠</span> {error}
        </div>
      )}

      {/* Health Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => {
          const val = healthValue(card.key);
          const healthy = isHealthy(card.key);
          return (
            <div key={card.key} className="relative group cursor-default">
              <div className={`absolute inset-0 bg-gradient-to-br ${card.gradient} rounded-2xl opacity-90 group-hover:opacity-100 transition-opacity`} />
              <div className="relative p-5 text-white">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-2xl opacity-60">{card.icon}</span>
                  {healthy !== null && (
                    <span className={`w-2 h-2 rounded-full ${healthy ? "bg-white animate-pulse" : "bg-red-300"}`} />
                  )}
                </div>
                <div className="text-xs font-medium uppercase tracking-wider opacity-80">{card.label}</div>
                <div className="mt-1 text-xl font-bold truncate">
                  {val || <span className="skeleton inline-block w-16 h-6 align-middle rounded" />}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Stats + Quick Actions + Verify */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* User Stats */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Registered Users</span>
            <span className="text-xl text-indigo-400">◎</span>
          </div>
          <div className="text-4xl font-bold text-slate-900">{userCount}</div>
          <div className="mt-2 flex items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              {enrolledCount} enrolled
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 text-xs font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
              {userCount - enrolledCount} pending
            </span>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 p-5 hover:shadow-md transition-shadow">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-4">Quick Actions</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {quickActions.map((action) => (
              <a
                key={action.href}
                href={action.href}
                className="group flex flex-col items-center gap-2 p-4 rounded-xl bg-slate-50 border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50/50 transition-all text-center"
              >
                <span className="text-2xl text-indigo-400 group-hover:text-indigo-600 transition-colors">{action.icon}</span>
                <span className="text-sm font-semibold text-slate-700 group-hover:text-indigo-700">{action.label}</span>
                <span className="text-[11px] text-slate-400 leading-tight">{action.desc}</span>
              </a>
            ))}
            <button
              onClick={() => setVerifyOpen(true)}
              className="group flex flex-col items-center gap-2 p-4 rounded-xl bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 hover:border-indigo-300 transition-all cursor-pointer text-center"
            >
              <span className="text-2xl text-indigo-500 group-hover:text-indigo-700 transition-colors">◐</span>
              <span className="text-sm font-semibold text-indigo-700 group-hover:text-indigo-800">Verify Face</span>
              <span className="text-[11px] text-indigo-400 leading-tight">Camera-based verification</span>
            </button>
          </div>
        </div>
      </div>

      {/* Activity Graph */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 hover:shadow-md transition-shadow">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Activity (Last 14 Days)</span>
          <a href="/logs" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">View all →</a>
        </div>
        {logs.length === 0 ? (
          <div className="text-center py-8 text-sm text-slate-400">No activity yet</div>
        ) : (
          <ActivityGraph logs={logs} />
        )}
      </div>

      <VerifyModal open={verifyOpen} onClose={() => setVerifyOpen(false)} />
    </div>
  );
}
