"use client";

import { useEffect, useState } from "react";
import { api, VerificationLog } from "@/lib/api";

export default function LogsPage() {
  const [logs, setLogs] = useState<VerificationLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [userIdFilter, setUserIdFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    api.listLogs({ page, page_size: pageSize, user_id: userIdFilter || undefined }).then((r) => {
      setLogs(r.logs);
      setTotal(r.total);
    }).catch((e) => setError(e.message))
    .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [page]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    load();
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Verification Logs</h1>
        <p className="text-sm text-slate-500 mt-0.5">{total} total entries</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
          <span>⚠</span> {error}
        </div>
      )}

      <form onSubmit={handleSearch} className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <input
            value={userIdFilter}
            onChange={(e) => setUserIdFilter(e.target.value)}
            className="w-full border border-slate-300 rounded-lg pl-3.5 pr-10 py-2.5 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-shadow"
            placeholder="Filter by User ID"
          />
          {userIdFilter && (
            <button
              type="button"
              onClick={() => { setUserIdFilter(""); setPage(1); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm"
            >
              ✕
            </button>
          )}
        </div>
        <button
          type="submit"
          className="px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 shadow-sm transition-colors"
        >
          Filter
        </button>
        {userIdFilter && (
          <button
            type="button"
            onClick={() => { setUserIdFilter(""); setPage(1); }}
            className="px-4 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors"
          >
            Clear
          </button>
        )}
      </form>

      {loading ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="divide-y divide-slate-100">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-5 py-4 flex items-center gap-4">
                <div className="skeleton w-8 h-4" />
                <div className="skeleton w-24 h-4" />
                <div className="skeleton w-20 h-4" />
                <div className="skeleton w-16 h-4" />
              </div>
            ))}
          </div>
        </div>
      ) : logs.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
          <div className="text-3xl text-slate-300 mb-3">⊞</div>
          <p className="text-slate-500 text-sm">No logs found.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">ID</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">User ID</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Device</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Distance</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-5 py-3.5 font-mono text-xs text-slate-500">#{l.id}</td>
                    <td className="px-5 py-3.5">
                      {l.user_id ? (
                        <code className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-700">{l.user_id}</code>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-slate-600 text-xs">{l.device_id || <span className="text-slate-400">—</span>}</td>
                    <td className="px-5 py-3.5">
                      {l.distance !== null && l.distance !== undefined ? (
                        <span className={`font-mono text-xs ${
                          l.distance < 0.4 ? "text-emerald-600" : l.distance < 0.6 ? "text-amber-600" : "text-red-600"
                        }`}>
                          {l.distance.toFixed(4)}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-slate-500 text-xs">{new Date(l.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-white rounded-xl shadow-sm border border-slate-200 px-5 py-3">
          <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            >
              ← Previous
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
