"use client";

import { useEffect, useState } from "react";
import { api, UserResponse } from "@/lib/api";

export default function UsersPage() {
  const [users, setUsers] = useState<UserResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    api.listUsers(page, pageSize).then((r) => {
      setUsers(r.users);
      setTotal(r.total);
    }).catch((e) => setError(e.message))
    .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [page]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Users</h1>
          <p className="text-sm text-slate-500 mt-0.5">{total} total registered</p>
        </div>
        <a
          href="/users/create"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 shadow-sm transition-colors"
        >
          + New User
        </a>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
          <span>⚠</span> {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="divide-y divide-slate-100">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-5 py-4 flex items-center gap-4">
                <div className="skeleton w-8 h-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <div className="skeleton w-32 h-4" />
                  <div className="skeleton w-20 h-3" />
                </div>
                <div className="skeleton w-16 h-5 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ) : users.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
          <div className="text-3xl text-slate-300 mb-3">◎</div>
          <p className="text-slate-500 text-sm">No users yet.</p>
          <a href="/users/create" className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-sm font-medium hover:bg-indigo-100 transition-colors">
            + Create the first user
          </a>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">User ID</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Name</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Face</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Created</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.user_id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-5 py-3.5">
                      <code className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-700">{u.user_id}</code>
                    </td>
                    <td className="px-5 py-3.5 font-medium text-slate-900">{u.name}</td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        u.face_enrolled
                          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20"
                          : "bg-slate-100 text-slate-500 ring-1 ring-slate-300/20"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${u.face_enrolled ? "bg-emerald-500" : "bg-slate-400"}`} />
                        {u.face_enrolled ? "Enrolled" : "None"}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-500 text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
                    <td className="px-5 py-3.5 text-right">
                      <a href={`/users/${u.user_id}`} className="text-indigo-600 hover:text-indigo-800 text-xs font-medium hover:underline">
                        View →
                      </a>
                    </td>
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
