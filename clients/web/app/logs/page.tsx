"use client";

import { useEffect, useState } from "react";
import { api, VerificationLog } from "@/lib/api";

const METHOD_LABELS: Record<string, string> = {
  frame_burst: "Frame Burst",
  challenge: "Challenge",
  client: "Client",
};

const TYPE_LABELS: Record<string, string> = {
  verification: "Verification",
  enrollment: "Enrollment",
};

function formatMethod(method?: string): string {
  if (!method) return "—";
  return METHOD_LABELS[method] || method;
}

export default function LogsPage() {
  const [logs, setLogs] = useState<VerificationLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [userIdFilter, setUserIdFilter] = useState("");
  const [logTypeFilter, setLogTypeFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    api.listLogs({ page, page_size: pageSize, user_id: userIdFilter || undefined, log_type: logTypeFilter || undefined }).then((r) => {
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

  const clearFilters = () => {
    setUserIdFilter("");
    setLogTypeFilter("");
    setPage(1);
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Activity Logs</h1>
        <p className="text-sm text-slate-500 mt-0.5">{total} total entries</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
          <span>⚠</span> {error}
        </div>
      )}

      <form onSubmit={handleSearch} className="flex items-center gap-2 flex-wrap">
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
        <select
          value={logTypeFilter}
          onChange={(e) => { setLogTypeFilter(e.target.value); setPage(1); }}
          className="border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-shadow"
        >
          <option value="">All Types</option>
          <option value="verification">Verification</option>
          <option value="enrollment">Enrollment</option>
        </select>
        <button
          type="submit"
          className="px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 shadow-sm transition-colors"
        >
          Filter
        </button>
        {(userIdFilter || logTypeFilter) && (
          <button
            type="button"
            onClick={clearFilters}
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
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">ID</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">User ID</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Method</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Distance</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Device</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Reason</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3.5 font-mono text-xs text-slate-500">#{l.id}</td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                        l.log_type === "enrollment"
                          ? "text-blue-700 bg-blue-50"
                          : "text-purple-700 bg-purple-50"
                      }`}>
                        {TYPE_LABELS[l.log_type] || l.log_type}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      {l.user_id ? (
                        <code className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-700">{l.user_id}</code>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-slate-600">{formatMethod(l.method)}</td>
                    <td className="px-4 py-3.5 font-mono text-xs">
                      {l.distance !== undefined && l.distance !== null ? (
                        <span className={l.distance < 0.4 ? "text-emerald-600" : l.distance < 0.45 ? "text-amber-600" : "text-red-600"}>
                          {l.distance.toFixed(4)}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-slate-600 text-xs">{l.device_id || <span className="text-slate-400">—</span>}</td>
                    <td className="px-4 py-3.5">
                      {l.success ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                          Success
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 px-2 py-0.5 rounded-full">
                          Failed
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-slate-600 max-w-xs truncate" title={l.reason || ""}>
                      {l.reason || <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3.5 text-slate-500 text-xs whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</td>
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
