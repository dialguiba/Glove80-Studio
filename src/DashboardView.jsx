import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

function toDate(val) {
  if (!val) return null;
  // Unix timestamp in seconds (number) or milliseconds
  if (typeof val === "number") return new Date(val < 1e10 ? val * 1000 : val);
  return new Date(val);
}

function relativeDate(val) {
  const date = toDate(val);
  if (!date || isNaN(date)) return null;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const diffSec = Math.round((date - Date.now()) / 1000);
  const diffDays = Math.round(diffSec / 86400);
  if (Math.abs(diffDays) < 1) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (Math.abs(diffDays) < 7) return rtf.format(diffDays, "day");
  if (Math.abs(diffDays) < 30) return rtf.format(Math.round(diffDays / 7), "week");
  if (Math.abs(diffDays) < 365) return rtf.format(Math.round(diffDays / 30), "month");
  return rtf.format(Math.round(diffDays / 365), "year");
}

export default function DashboardView({ layouts, loading, error, onRefresh, onLogout, onSelectLayout, activeLayoutId, onSetActive }) {
  const sortedLayouts = layouts
    ? [...layouts].sort((a, b) => {
        const aDate = (a.layout_meta ?? a).date ?? 0;
        const bDate = (b.layout_meta ?? b).date ?? 0;
        return bDate - aDate;
      })
    : layouts;

  return (
    <div className="min-h-screen bg-background-dark text-slate-100 flex flex-col items-center justify-start overflow-hidden">
      {/* Ambient background */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-background-dark/80 bg-glow" />
      </div>

      <div className="relative z-10 w-full max-w-3xl px-6 py-10 flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center border border-primary/20">
              <span className="material-symbols-outlined text-primary text-2xl">keyboard_alt</span>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight leading-none">MoErgo Glove80</h1>
              <p className="text-slate-400 text-xs mt-0.5">Your layouts</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { invoke("toggle_widget"); getCurrentWebviewWindow().hide(); }}
              className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg border border-slate-600/40 text-slate-400 hover:text-primary hover:border-primary/30 hover:bg-primary/5 transition-colors cursor-pointer"
              title="Toggle widget overlay"
            >
              <span className="material-symbols-outlined text-base">widgets</span>
              Widget
            </button>
            <button
              onClick={onRefresh}
              disabled={loading}
              className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg border border-primary/30 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <span className={`material-symbols-outlined text-base ${loading ? "animate-spin" : ""}`}>
                refresh
              </span>
              {loading ? "Loading..." : "Refresh"}
            </button>
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg border border-slate-600/40 text-slate-400 hover:text-red-400 hover:border-red-400/30 hover:bg-red-400/5 transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">logout</span>
              Sign out
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="glass-panel rounded-lg px-4 py-3 text-red-400 text-sm flex items-center gap-2">
            <span className="material-symbols-outlined text-base">error</span>
            {error}
          </div>
        )}

        {/* Layouts grid */}
        {sortedLayouts && (
          <div className="flex flex-col gap-3">
            <p className="text-slate-400 text-xs uppercase tracking-widest font-medium">
              {sortedLayouts.length} layout{sortedLayouts.length !== 1 ? "s" : ""} found
            </p>
            <div className="flex flex-col gap-2">
              {sortedLayouts.map((l) => {
                const meta = l.layout_meta ?? l;
                const id = meta.uuid ?? l.id;
                const name = meta.title ?? "(untitled)";
                const dateVal = meta.date ?? null;
                const tags = Array.isArray(meta.tags) ? meta.tags : [];
                const isActive = id === activeLayoutId;
                const rel = relativeDate(dateVal);
                const dateObj = toDate(dateVal);
                const full = dateObj
                  ? dateObj.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                  : null;

                return (
                  <div
                    key={id}
                    onClick={() => onSelectLayout(id)}
                    className={`glass-panel rounded-xl px-4 py-3 flex items-center gap-3 transition-colors cursor-pointer ${
                      isActive ? "border-primary/50 bg-primary/5" : "hover:border-primary/40"
                    }`}
                  >
                    <span className="material-symbols-outlined text-xl shrink-0 text-primary">
                      keyboard
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm leading-snug">{name}</p>
                        {isActive && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/25 font-medium leading-none">
                            Active
                          </span>
                        )}
                      </div>
                      {tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {tags.map((tag) => (
                            <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-700/50 text-slate-400 border border-slate-600/30 leading-none">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {!isActive && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSetActive(id, name);
                        }}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-600/40 text-slate-400 hover:text-primary hover:border-primary/30 hover:bg-primary/5 transition-colors cursor-pointer shrink-0"
                      >
                        Set active
                      </button>
                    )}
                    {rel && (
                      <div className="text-right shrink-0" title={full ?? undefined}>
                        <p className="text-slate-400 text-xs">{rel}</p>
                        <p className="text-slate-600 text-[10px] mt-0.5">{full}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && sortedLayouts && sortedLayouts.length === 0 && (
          <div className="glass-panel rounded-xl p-10 flex flex-col items-center gap-3 text-slate-400">
            <span className="material-symbols-outlined text-4xl">keyboard_hide</span>
            <p className="text-sm">No layouts found</p>
          </div>
        )}

        {/* Footer */}
        <div className="mt-4 flex justify-center gap-6 text-slate-600 text-xs uppercase tracking-widest font-medium">
          <a href="#" className="hover:text-primary transition-colors">Support</a>
          <span className="text-slate-700">•</span>
          <a href="#" className="hover:text-primary transition-colors">Privacy</a>
          <span className="text-slate-700">•</span>
          <a href="#" className="hover:text-primary transition-colors">Terms</a>
        </div>
      </div>
    </div>
  );
}
