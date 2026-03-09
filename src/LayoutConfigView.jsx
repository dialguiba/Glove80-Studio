import { useState, useRef, useLayoutEffect } from "react";

// Glove80 key positions on a 1255×560px canvas.
// Each key is 65×65px, spaced 70px (5px gap).
// Format: [left, top]
// Glove80 key positions (1255×565 canvas, 65×65 keys, 70px spacing).
// Order matches ZMK physical layout: rows 0–3 (left+right), then row 4 left,
// upper thumb (3L+3R interleaved), row 4 right, row 5 left,
// lower thumb (3L+3R interleaved), row 5 right.
const KEY_POSITIONS = [
  // Row 0: ceiling — 5L + 5R (0–9)
  [0,35],[70,35],[140,0],[210,0],[280,0],
  [910,0],[980,0],[1050,0],[1120,35],[1190,35],
  // Row 1: number — 6L + 6R (10–21)
  [0,105],[70,105],[140,70],[210,70],[280,70],[350,70],
  [840,70],[910,70],[980,70],[1050,70],[1120,105],[1190,105],
  // Row 2: top alpha — 6L + 6R (22–33)
  [0,175],[70,175],[140,140],[210,140],[280,140],[350,140],
  [840,140],[910,140],[980,140],[1050,140],[1120,175],[1190,175],
  // Row 3: home — 6L + 6R (34–45)
  [0,245],[70,245],[140,210],[210,210],[280,210],[350,210],
  [840,210],[910,210],[980,210],[1050,210],[1120,245],[1190,245],
  // Row 4 left: bottom — 6 keys (46–51)
  [0,315],[70,315],[140,280],[210,280],[280,280],[350,280],
  // Upper thumb: 3L outer→inner + 3R inner→outer (52–57)
  [385,370],[455,400],[525,425],
  [625,425],[695,400],[765,370],
  // Row 4 right: bottom — 6 keys (58–63)
  [840,280],[910,280],[980,280],[1050,280],[1120,315],[1190,315],
  // Row 5 left: floor — 5 keys (64–68)
  [0,385],[70,385],[140,350],[210,350],[280,350],
  // Lower thumb: 3L outer→inner + 3R inner→outer (69–74)
  [385,440],[455,470],[525,495],
  [625,495],[695,470],[765,440],
  // Row 5 right: floor — 5 keys (75–79)
  [910,350],[980,350],[1050,350],[1120,385],[1190,385],
];

const CANVAS_W = 1255;
const CANVAS_H = 565;

function parseKey(key, layerNames = []) {
  if (!key || typeof key !== "object") return { label: String(key) };
  const val = key.value ?? "";
  const params = key.params ?? [];
  if (val === "&trans") return { special: "▽" };
  if (val === "&none") return { special: "∅" };
  if (val === "Custom") {
    const paramVal = params[0]?.value ?? "";
    return { badge: "Custom", label: paramVal, type: "custom" };
  }
  if (val === "&mo" || val === "&sl" || val === "&lt" || val === "&tog" || val === "&to") {
    const badgeMap = { "&mo": "Mom. Layer", "&sl": "Sticky Layer", "&lt": "Layer Tap", "&tog": "Toggle", "&to": "To Layer" };
    const paramVal = params.map((p) => String(p.value ?? "")).filter(Boolean).join(" ");
    // Resolve layer index to name if possible
    const layerIdx = parseInt(paramVal, 10);
    const resolvedLabel = (!isNaN(layerIdx) && layerNames[layerIdx]) ? layerNames[layerIdx] : paramVal;
    return { badge: badgeMap[val] ?? val.replace(/^&/, ""), label: resolvedLabel, type: "layer" };
  }
  const base = val.replace(/^&/, "");
  // Detect layer-switch behaviors that match a layer name (e.g. &lower, &magic)
  const matchedIdx = layerNames.findIndex((n) => n.toLowerCase() === base.toLowerCase());
  if (matchedIdx >= 0) {
    return { badge: "Layer", label: layerNames[matchedIdx], type: "layer" };
  }
  const paramStr = params.map((p) => String(p.value ?? "")).filter(Boolean).join(" ");
  // For &kp, the behavior name adds no info — just show the keycode
  if (val === "&kp") return { label: paramStr || base };
  return { label: paramStr ? `${base} ${paramStr}` : base };
}

function ScaledKeyboard({ layer, layerNames = [] }) {
  const containerRef = useRef(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / CANVAS_W);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full overflow-hidden"
      style={{ height: Math.ceil(CANVAS_H * scale) }}
    >
      <div
        className="relative origin-top-left"
        style={{ width: CANVAS_W, height: CANVAS_H, transform: `scale(${scale})` }}
      >
        {/* Half backgrounds */}
        <div className="absolute rounded-2xl bg-slate-900/40 border border-slate-700/30"
          style={{ left: 0, top: 0, width: 415, height: 460 }} />
        <div className="absolute rounded-2xl bg-slate-900/40 border border-slate-700/30"
          style={{ left: 840, top: 0, width: 415, height: 460 }} />

        {/* Keys */}
        {KEY_POSITIONS.map((pos, i) => {
          const key = layer[i];
          const parsed = key ? parseKey(key, layerNames) : { label: "" };
          const { special, badge, label, type } = parsed;

          const isEmpty = special === "∅";
          const isTransparent = special === "▽";
          const isCustom = type === "custom";
          const isLayer = type === "layer";

          return (
            <div
              key={i}
              className={`
                absolute rounded-md border select-none transition-colors
                ${isEmpty ? "border-slate-700/20 bg-transparent text-slate-700 flex items-center justify-center" : ""}
                ${isTransparent ? "border-slate-700/30 bg-slate-800/20 text-slate-600 flex items-center justify-center" : ""}
                ${isCustom ? "border-amber-500/40 bg-amber-900/30 text-amber-200 flex flex-col justify-between p-1" : ""}
                ${isLayer ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-200 flex flex-col justify-between p-1" : ""}
                ${!isEmpty && !isTransparent && !isCustom && !isLayer ? "border-slate-600/50 bg-slate-800/70 text-slate-200 flex items-center justify-center hover:border-primary/50 hover:bg-slate-700/60" : ""}
              `}
              style={{ left: pos[0], top: pos[1], width: 65, height: 65 }}
            >
              {(isCustom || isLayer) ? (
                <>
                  <span
                    className={`leading-none font-medium ${isCustom ? "text-amber-400/80" : "text-emerald-400/80"}`}
                    style={{ fontSize: 8 }}
                  >
                    {badge}
                  </span>
                  <span className="leading-tight break-all text-center w-full" style={{ fontSize: 10 }}>
                    {label}
                  </span>
                </>
              ) : (
                <span className="leading-tight break-all px-1 text-center" style={{ fontSize: 11 }}>
                  {special ?? label}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function LayoutConfigView({ config, loading, error, onBack, isActive, onSetActive }) {
  const [activeLayer, setActiveLayer] = useState(0);

  const meta = config?.layout_meta;
  const cfg = config?.config;
  const layerNames = cfg?.layer_names ?? [];
  const layers = cfg?.layers ?? [];
  const currentLayer = layers[activeLayer] ?? [];

  return (
    <div className="min-h-screen bg-background-dark text-slate-100 flex flex-col items-center justify-start overflow-hidden">
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-background-dark/80 bg-glow" />
      </div>

      <div className="relative z-10 w-full max-w-5xl px-6 py-10 flex flex-col gap-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-600/40 text-slate-400 hover:text-primary hover:border-primary/30 hover:bg-primary/5 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-base">arrow_back</span>
            Back
          </button>
          {meta && (
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight leading-none truncate">{meta.title}</h1>
                {isActive && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/25 font-medium leading-none shrink-0">
                    Active
                  </span>
                )}
              </div>
              <p className="text-slate-500 text-xs font-mono mt-0.5">{meta.uuid}</p>
            </div>
          )}
          {config && !isActive && (
            <button
              onClick={onSetActive}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-primary/30 text-primary hover:bg-primary/10 transition-colors cursor-pointer shrink-0"
            >
              <span className="material-symbols-outlined text-base">check_circle</span>
              Set as active
            </button>
          )}
        </div>

        {loading && (
          <div className="glass-panel rounded-xl p-10 flex flex-col items-center gap-3 text-slate-400">
            <span className="material-symbols-outlined text-4xl animate-spin">refresh</span>
            <p className="text-sm">Loading config...</p>
          </div>
        )}

        {error && (
          <div className="glass-panel rounded-lg px-4 py-3 text-red-400 text-sm flex items-center gap-2">
            <span className="material-symbols-outlined text-base">error</span>
            {error}
          </div>
        )}

        {config && (
          <>
            {/* Meta info */}
            <div className="glass-panel rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
              {meta?.tags?.map((tag) => (
                <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">{tag}</span>
              ))}
              {meta?.compiled && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">compiled</span>
              )}
              {cfg?.locale && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-400 border border-slate-600/30">{cfg.locale}</span>
              )}
              <span className="text-xs text-slate-500 ml-auto">
                By <span className="text-slate-300">{meta?.creator}</span>
                {meta?.date && (
                  <> · {new Date(meta.date * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</>
                )}
              </span>
            </div>

            {/* Layer selector + keyboard */}
            {layerNames.length > 0 && (
              <div className="flex gap-4 items-start">

                {/* Layer selector */}
                <div className="flex flex-col gap-1 shrink-0">
                  <p className="text-slate-500 text-xs uppercase tracking-widest font-medium mb-1">Layers</p>
                  {layerNames.map((name, i) => (
                    <button
                      key={i}
                      onClick={() => setActiveLayer(i)}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors cursor-pointer ${
                        activeLayer === i
                          ? "bg-primary/20 text-primary border border-primary/40"
                          : "text-slate-400 border border-slate-700/40 hover:border-primary/30 hover:text-primary/80"
                      }`}
                    >
                      <span className="text-xs font-mono w-4 text-center">{i}</span>
                      <span className="truncate max-w-30">{name}</span>
                    </button>
                  ))}
                </div>

                {/* Keyboard */}
                <div className="flex-1 min-w-0 glass-panel rounded-xl p-3">
                  <p className="text-slate-500 text-xs uppercase tracking-widest font-medium mb-3">
                    Layer {activeLayer}: {layerNames[activeLayer]}
                  </p>
                  <ScaledKeyboard layer={currentLayer} layerNames={layerNames} />
                </div>
              </div>
            )}

            {/* Custom behaviors */}
            {cfg?.custom_defined_behaviors?.trim() && (
              <div className="glass-panel rounded-xl px-4 py-4 flex flex-col gap-2">
                <p className="text-slate-400 text-xs uppercase tracking-widest font-medium">Custom behaviors</p>
                <pre className="text-xs text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                  {cfg.custom_defined_behaviors.trim()}
                </pre>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
