import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Face Recognition Engine",
  description: "Web client for face recognition API",
};

const navLinks = [
  { href: "/", label: "Dashboard", icon: "◉" },
  { href: "/users", label: "Users", icon: "◎" },
  { href: "/enroll", label: "Enroll", icon: "○" },
  { href: "/verify", label: "Verify", icon: "◐" },
  { href: "/logs", label: "Logs", icon: "⊞" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full flex">
        <aside className="w-56 bg-slate-900 text-white flex flex-col shrink-0">
          <div className="px-5 py-5 border-b border-slate-700">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">◈</span>
              <div>
                <div className="font-semibold text-sm tracking-tight">FR Engine</div>
                <div className="text-[10px] text-slate-400 font-mono mt-px">face-recognition</div>
              </div>
            </div>
          </div>
          <nav className="flex-1 px-3 py-4 space-y-1">
            {navLinks.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800/70 transition-all duration-150"
              >
                <span className="text-base w-5 text-center">{l.icon}</span>
                {l.label}
              </a>
            ))}
          </nav>
          <div className="px-5 py-4 border-t border-slate-700 text-[11px] text-slate-500">
            API &middot; v1.0.0
          </div>
        </aside>
        <main className="flex-1 overflow-auto">
          <div className="max-w-6xl mx-auto p-6 lg:p-8">{children}</div>
        </main>
      </body>
    </html>
  );
}
