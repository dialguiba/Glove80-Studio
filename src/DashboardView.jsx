import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
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

function LayoutCard({ id, name, tags, rel, full, isActive, isPinned, onSelect, onTogglePin, onSetActive }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e) {
      if (!btnRef.current?.contains(e.target) && !menuRef.current?.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  function openMenu() {
    const rect = btnRef.current.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setMenuOpen((v) => !v);
  }

  return (
    <div
      onClick={onSelect}
      className={`relative group glass-panel rounded-xl px-4 py-3 flex items-center gap-3 transition-colors cursor-pointer ${
        isActive ? "border-primary/50 bg-primary/5" : isPinned ? "border-amber-400/30" : "hover:border-slate-600/60"
      }`}
    >
      <span className="material-symbols-outlined text-xl shrink-0 text-primary">keyboard</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-sm leading-snug">{name}</p>
          {isActive && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/25 font-medium leading-none">
              Active
            </span>
          )}
          {isPinned && (
            <span className="material-symbols-outlined text-amber-400 leading-none" style={{ fontSize: 14, fontVariationSettings: "'FILL' 1" }}>
              star
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
      {rel && (
        <div className="text-right shrink-0" title={full ?? undefined}>
          <p className="text-slate-400 text-xs">{rel}</p>
          <p className="text-slate-600 text-[10px] mt-0.5">{full}</p>
        </div>
      )}
      {/* 3-dot menu */}
      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
        <button
          ref={btnRef}
          onClick={openMenu}
          className="p-1 rounded text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
          title="Options"
        >
          <span className="material-symbols-outlined leading-none" style={{ fontSize: 18 }}>more_vert</span>
        </button>
        {menuOpen && createPortal(
          <div
            ref={menuRef}
            className="fixed z-[9999] min-w-[160px] bg-slate-900 rounded-lg border border-slate-700/60 shadow-2xl py-1 flex flex-col"
            style={{ top: menuPos.top, right: menuPos.right }}
          >
            <button
              onClick={(e) => { onTogglePin(e); setMenuOpen(false); }}
              className="flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700/60 transition-colors cursor-pointer text-left"
            >
              <span className="material-symbols-outlined text-amber-400/80 leading-none" style={{ fontSize: 15, fontVariationSettings: isPinned ? "'FILL' 1" : "'FILL' 0" }}>
                push_pin
              </span>
              {isPinned ? "Remove from favorites" : "Add to favorites"}
            </button>
            {!isActive && (
              <button
                onClick={() => { onSetActive(); setMenuOpen(false); }}
                className="flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700/60 transition-colors cursor-pointer text-left"
              >
                <span className="material-symbols-outlined text-primary/80 leading-none" style={{ fontSize: 15 }}>check_circle</span>
                Set as active
              </button>
            )}
          </div>,
          document.body
        )}
      </div>
    </div>
  );
}

export default function DashboardView({ layouts, loading, error, onRefresh, onLogout, onSelectLayout, activeLayoutId, onSetActive }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("date");
  const [view, setView] = useState("all"); // "all" | "favorites"
  const [pinnedIds, setPinnedIds] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("pinnedLayouts") ?? "[]"));
    } catch {
      return new Set();
    }
  });

  function togglePin(id, e) {
    e.stopPropagation();
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem("pinnedLayouts", JSON.stringify([...next]));
      return next;
    });
  }

  const sortedLayouts = layouts
    ? [...layouts].sort((a, b) => {
        const aMeta = a.layout_meta ?? a;
        const bMeta = b.layout_meta ?? b;
        if (sortBy === "name") {
          return (aMeta.title ?? "").localeCompare(bMeta.title ?? "");
        }
        // date (default): newest first
        return (bMeta.date ?? 0) - (aMeta.date ?? 0);
      })
    : layouts;

  const filteredLayouts = sortedLayouts
    ? sortedLayouts.filter((l) => {
        const meta = l.layout_meta ?? l;
        const id = meta.uuid ?? l.id;
        if (view === "favorites" && !pinnedIds.has(id)) return false;
        if (!searchQuery.trim()) return true;
        const title = (meta.title ?? "").toLowerCase();
        const tags = Array.isArray(meta.tags) ? meta.tags.join(" ").toLowerCase() : "";
        const q = searchQuery.toLowerCase();
        return title.includes(q) || tags.includes(q);
      })
    : sortedLayouts;

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

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-slate-700/50 pb-0">
          <button
            onClick={() => setView("all")}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer -mb-px ${
              view === "all"
                ? "border-primary text-primary"
                : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            <span className="material-symbols-outlined text-base">grid_view</span>
            All
          </button>
          <button
            onClick={() => setView("favorites")}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer -mb-px ${
              view === "favorites"
                ? "border-amber-400 text-amber-400"
                : "border-transparent text-slate-500 hover:text-amber-400"
            }`}
          >
            <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: view === "favorites" ? "'FILL' 1" : "'FILL' 0" }}>push_pin</span>
            Favorites
            {pinnedIds.size > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold leading-none ${
                view === "favorites" ? "bg-amber-400/20 text-amber-300" : "bg-slate-700 text-slate-400"
              }`}>
                {pinnedIds.size}
              </span>
            )}
          </button>
        </div>

        {/* Search */}
        <div className="relative flex items-center">
          <span className="material-symbols-outlined text-slate-500 text-base absolute left-3 pointer-events-none">
            search
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name or tag…"
            className="w-full glass-panel rounded-lg pl-9 pr-9 py-2.5 text-sm text-slate-100 placeholder-slate-500 bg-transparent border border-slate-700/50 focus:border-primary/40 focus:outline-none focus:ring-0 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
              aria-label="Clear search"
            >
              <span className="material-symbols-outlined text-base">close</span>
            </button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="glass-panel rounded-lg px-4 py-3 text-red-400 text-sm flex items-center gap-2">
            <span className="material-symbols-outlined text-base">error</span>
            {error}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !sortedLayouts && (
          <div className="flex flex-col gap-3">
            <div className="h-3 w-32 bg-slate-700/50 rounded animate-pulse" />
            {[...Array(4)].map((_, i) => (
              <div key={i} className="glass-panel rounded-xl p-4 flex items-center gap-4 animate-pulse">
                <div className="w-10 h-10 rounded-lg bg-slate-700/50" />
                <div className="flex-1 flex flex-col gap-2">
                  <div className="h-4 w-48 bg-slate-700/50 rounded" />
                  <div className="h-3 w-24 bg-slate-700/30 rounded" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Layouts grid */}
        {sortedLayouts && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-slate-400 text-xs uppercase tracking-widest font-medium">
                {searchQuery.trim()
                  ? `${filteredLayouts.length} of ${sortedLayouts.length} layout${sortedLayouts.length !== 1 ? "s" : ""} found`
                  : `${sortedLayouts.length} layout${sortedLayouts.length !== 1 ? "s" : ""} found`}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setSortBy("date")}
                  className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
                    sortBy === "date"
                      ? "border-primary/40 text-primary bg-primary/5"
                      : "border-slate-700/50 text-slate-500 hover:text-slate-300 hover:border-slate-600"
                  }`}
                >
                  <span className="material-symbols-outlined text-sm">schedule</span>
                  Date
                </button>
                <button
                  onClick={() => setSortBy("name")}
                  className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
                    sortBy === "name"
                      ? "border-primary/40 text-primary bg-primary/5"
                      : "border-slate-700/50 text-slate-500 hover:text-slate-300 hover:border-slate-600"
                  }`}
                >
                  <span className="material-symbols-outlined text-sm">sort_by_alpha</span>
                  Name
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {filteredLayouts.map((l) => {
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

                const isPinned = pinnedIds.has(id);
                return (
                  <LayoutCard
                    key={id}
                    id={id}
                    name={name}
                    tags={tags}
                    rel={rel}
                    full={full}
                    isActive={isActive}
                    isPinned={isPinned}
                    onSelect={() => onSelectLayout(id)}
                    onTogglePin={(e) => togglePin(id, e)}
                    onSetActive={() => onSetActive(id, name)}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && sortedLayouts && filteredLayouts.length === 0 && (
          <div className="glass-panel rounded-xl p-10 flex flex-col items-center gap-3 text-slate-400">
            <span className="material-symbols-outlined text-4xl">keyboard_hide</span>
            <p className="text-sm">
              {view === "favorites" && !searchQuery.trim()
                ? "No pinned layouts yet — pin a layout to add it here"
                : searchQuery.trim()
                ? "No layouts match your search"
                : "No layouts found"}
            </p>
            {view === "favorites" && !searchQuery.trim() && (
              <button
                onClick={() => setView("all")}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-600/40 text-slate-400 hover:text-primary hover:border-primary/30 transition-colors cursor-pointer"
              >
                Browse all layouts
              </button>
            )}
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
