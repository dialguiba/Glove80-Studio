import { useState, useEffect, useRef, useLayoutEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

const KEY_POSITIONS = [
  [0,35],[70,35],[140,0],[210,0],[280,0],
  [910,0],[980,0],[1050,0],[1120,35],[1190,35],
  [0,105],[70,105],[140,70],[210,70],[280,70],[350,70],
  [840,70],[910,70],[980,70],[1050,70],[1120,105],[1190,105],
  [0,175],[70,175],[140,140],[210,140],[280,140],[350,140],
  [840,140],[910,140],[980,140],[1050,140],[1120,175],[1190,175],
  [0,245],[70,245],[140,210],[210,210],[280,210],[350,210],
  [840,210],[910,210],[980,210],[1050,210],[1120,245],[1190,245],
  [0,315],[70,315],[140,280],[210,280],[280,280],[350,280],
  [0,385],[70,385],[140,350],[210,350],[280,350],
  [840,280],[910,280],[980,280],[1050,280],[1120,315],[1190,315],
  [910,350],[980,350],[1050,350],[1120,385],[1190,385],
  [385,370],[455,400],[525,425],
  [385,440],[455,470],[525,495],
  [625,495],[695,470],[765,440],
  [625,425],[695,400],[765,370],
];

const CANVAS_W = 1255;
const CANVAS_H = 565;

function parseKey(key) {
  if (!key || typeof key !== "object") return { label: String(key) };
  const val = key.value ?? "";
  const params = key.params ?? [];
  if (val === "&trans") return { special: "▽" };
  if (val === "&none") return { special: "∅" };
  if (val === "&kp") {
    const paramStr = params.map((p) => String(p.value ?? "")).filter(Boolean).join(" ");
    return { label: paramStr || val.replace(/^&/, "") };
  }
  if (val === "&mo" || val === "&sl" || val === "&lt" || val === "&tog") {
    const paramVal = params.map((p) => String(p.value ?? "")).filter(Boolean).join(" ");
    return { label: paramVal, type: "layer" };
  }
  const paramStr = params.map((p) => String(p.value ?? "")).filter(Boolean).join(" ");
  const base = val.replace(/^&/, "");
  return { label: paramStr ? `${base} ${paramStr}` : base };
}

export default function WidgetView() {
  const [config, setConfig] = useState(null);
  const [activeLayer, setActiveLayer] = useState(0);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const containerRef = useRef(null);
  const [scale, setScale] = useState(1);

  const loadConfig = useCallback(() => {
    invoke("get_active_layout_config")
      .then((data) => { setConfig(data); setError(null); })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    loadConfig();
    const unlisten = listen("active-layout-changed", loadConfig);
    return () => { unlisten.then((f) => f()); };
  }, [loadConfig]);

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / CANVAS_W);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const appWindow = getCurrentWebviewWindow();

  function handleMouseDown(e) {
    if (e.target.closest("button")) return;
    setDragging(true);
    dragOffset.current = { x: e.clientX, y: e.clientY };
    appWindow.startDragging();
  }

  const layers = config?.config?.layers ?? [];
  const layerNames = config?.config?.layer_names ?? [];
  const currentLayer = layers[activeLayer] ?? [];
  const title = config?.layout_meta?.title;

  return (
    <div
      onMouseDown={handleMouseDown}
      className="w-screen h-screen bg-background-dark text-slate-100 flex flex-col overflow-hidden select-none"
      style={{ cursor: dragging ? "grabbing" : "default" }}
    >
      {/* Titlebar */}
      <div className="flex items-center justify-between px-3 py-1.5 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-primary text-sm">keyboard_alt</span>
          <span className="text-xs font-medium text-slate-300 truncate">{title ?? "No active layout"}</span>
        </div>
        <div className="flex items-center gap-1">
          {layerNames.map((name, i) => (
            <button
              key={i}
              onClick={() => setActiveLayer(i)}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
                activeLayer === i
                  ? "bg-primary/20 text-primary"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {name}
            </button>
          ))}
          <button
            onClick={() => appWindow.hide()}
            className="ml-2 text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      </div>

      {/* Keyboard */}
      <div ref={containerRef} className="flex-1 px-2 pb-2 overflow-hidden">
        {error && (
          <div className="flex items-center justify-center h-full text-slate-500 text-xs gap-1.5">
            <span className="material-symbols-outlined text-sm">error</span>
            {error}
          </div>
        )}
        {!error && currentLayer.length > 0 && (
          <div
            className="relative origin-top-left"
            style={{ width: CANVAS_W, height: CANVAS_H, transform: `scale(${scale})` }}
          >
            {KEY_POSITIONS.map((pos, i) => {
              const key = currentLayer[i];
              const parsed = key ? parseKey(key) : { label: "" };
              const { special, label, type } = parsed;
              const isEmpty = special === "∅";
              const isTransparent = special === "▽";
              const isLayer = type === "layer";

              return (
                <div
                  key={i}
                  className={`absolute rounded-sm border select-none flex items-center justify-center
                    ${isEmpty ? "border-slate-700/15 bg-transparent text-slate-700" : ""}
                    ${isTransparent ? "border-slate-700/20 bg-slate-800/15 text-slate-600" : ""}
                    ${isLayer ? "border-emerald-500/30 bg-emerald-900/20 text-emerald-300" : ""}
                    ${!isEmpty && !isTransparent && !isLayer ? "border-slate-600/40 bg-slate-800/50 text-slate-200" : ""}
                  `}
                  style={{ left: pos[0], top: pos[1], width: 65, height: 65 }}
                >
                  <span className="leading-tight break-all px-0.5 text-center" style={{ fontSize: 10 }}>
                    {special ?? label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {!error && currentLayer.length === 0 && !config && (
          <div className="flex items-center justify-center h-full text-slate-500 text-xs">
            Loading...
          </div>
        )}
      </div>
    </div>
  );
}
