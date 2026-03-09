import { useState, useEffect, useRef, useLayoutEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

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
  if (val === "&kp") {
    const paramStr = params.map((p) => String(p.value ?? "")).filter(Boolean).join(" ");
    return { label: paramStr || val.replace(/^&/, "") };
  }
  if (val === "&mo" || val === "&sl" || val === "&lt" || val === "&tog" || val === "&to") {
    const firstIdx = parseInt(params[0]?.value);
    const layerName = !isNaN(firstIdx) ? layerNames[firstIdx] : null;
    const paramVal = params.map((p) => String(p.value ?? "")).filter(Boolean).join(" ");
    return { label: layerName ?? paramVal, type: "layer" };
  }
  // Detect layer-switch behaviors that match a layer name (e.g. &lower, &magic)
  const base = val.replace(/^&/, "");
  if (layerNames.some((n) => n.toLowerCase() === base.toLowerCase())) {
    return { label: base, type: "layer" };
  }
  const paramStr = params.map((p) => String(p.value ?? "")).filter(Boolean).join(" ");
  return { label: paramStr ? `${base} ${paramStr}` : base };
}

// Strip ZMK modifier wrappers: LS(X), RS(X), LC(X), RC(X), LA(X), RA(X), LG(X), RG(X)
// Handles nesting: LS(LC(A)) → A
function stripModifiers(name) {
  let s = name;
  while (/^[LR][SACG]\(/.test(s) && s.endsWith(")")) {
    s = s.slice(3, -1);
  }
  return s;
}

// Build a reverse map: keyName -> [position indices] for a given layer.
// Key names are stripped of ZMK modifier wrappers so that LS(N1) matches "N1".
function buildKeyMap(layer) {
  const map = {};
  const addKey = (raw, idx) => {
    if (!raw) return;
    const name = stripModifiers(raw);
    if (!name) return;
    if (!map[name]) map[name] = [];
    map[name].push(idx);
  };
  layer.forEach((key, idx) => {
    if (!key || typeof key !== "object") return;
    const val = key.value ?? "";
    const params = key.params ?? [];
    // &kp KEY
    if (val === "&kp" && params[0]) {
      addKey(String(params[0].value ?? ""), idx);
    }
    // &lt LAYER KEY — tap sends KEY to OS
    else if (val === "&lt" && params[1]) {
      addKey(String(params[1].value ?? ""), idx);
    }
    // &mt MOD KEY — tap sends KEY to OS
    else if (val === "&mt" && params[1]) {
      addKey(String(params[1].value ?? ""), idx);
    }
    // Custom hold-tap behaviors (e.g. &lower, &magic, &ht, etc.) with 2+ params:
    // convention is &behavior HOLD TAP — last param is the tap key
    else if (params.length >= 2 && val.startsWith("&")) {
      addKey(String(params[params.length - 1].value ?? ""), idx);
    }
    // Custom behavior with 1 param that looks like a key name (not a number/layer index)
    else if (params.length === 1 && val.startsWith("&") && val !== "&mo" && val !== "&sl" && val !== "&tog" && val !== "&to") {
      const p = String(params[0].value ?? "");
      if (p && isNaN(Number(p))) {
        addKey(p, idx);
      }
    }
  });
  return map;
}

// Find positions in a layer that activate a specific target layer index
function findLayerActivatorPositions(layer, targetLayerIdx, layerNames) {
  const positions = [];
  layer.forEach((key, idx) => {
    if (!key || typeof key !== "object") return;
    const val = key.value ?? "";
    // Standard layer behaviors: first param is the layer index
    if (["&mo", "&sl", "&lt", "&tog", "&to"].includes(val)) {
      const paramVal = key.params?.[0]?.value;
      if (Number(paramVal) === targetLayerIdx || String(paramVal) === String(targetLayerIdx)) {
        positions.push(idx);
      }
    }
    // Named behaviors like &lower, &magic that match a layer name
    const base = val.replace(/^&/, "").toLowerCase();
    if (base && layerNames[targetLayerIdx]?.toLowerCase() === base) {
      positions.push(idx);
    }
  });
  return positions;
}

// Score how well pressed keys match a layer.
// Uses normalized scoring: match count / total unique keys in the layer.
// Layers with fewer explicit bindings (non-base layers with lots of &trans)
// score proportionally higher per match, making them easier to detect.
// Exclusive matches (keys not on the base layer) get a large bonus.
function scoreLayer(pressedKeys, layerMap, baseMap) {
  let matches = 0;
  let exclusive = 0;
  pressedKeys.forEach((k) => {
    if (layerMap[k]) {
      matches++;
      if (!baseMap[k]) exclusive++;
    }
  });
  if (matches === 0) return 0;
  const keyCount = Object.keys(layerMap).length || 1;
  // Normalized: fraction of layer's keys that are pressed (×1000 for precision)
  // + massive bonus for keys exclusive to this layer
  return Math.round((matches / keyCount) * 1000) + exclusive * 5000;
}

export default function WidgetView() {
  const [config, setConfig] = useState(null);
  const [userLayer, setUserLayer] = useState(0); // manually selected layer
  const [autoLayer, setAutoLayer] = useState(null); // auto-detected layer
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const containerRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [pressedKeys, setPressedKeys] = useState(new Set());

  const activeLayer = autoLayer ?? userLayer;

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

  // Global key event listeners
  useEffect(() => {
    const downUnlisten = listen("key-down", (e) => {
      setPressedKeys((prev) => {
        const next = new Set(prev);
        next.add(e.payload);
        return next;
      });
    });
    const upUnlisten = listen("key-up", (e) => {
      setPressedKeys((prev) => {
        const next = new Set(prev);
        next.delete(e.payload);
        return next;
      });
    });
    return () => {
      downUnlisten.then((f) => f());
      upUnlisten.then((f) => f());
    };
  }, []);

  // Auto-detect active layer based on pressed keys
  const layers = config?.config?.layers ?? [];
  const autoLayerTimeout = useRef(null);
  useEffect(() => {
    if (pressedKeys.size === 0) {
      // Debounce: keep the detected layer briefly so it doesn't flicker
      if (autoLayer !== null) {
        autoLayerTimeout.current = setTimeout(() => setAutoLayer(null), 400);
      }
      return;
    }
    // Keys are pressed — cancel any pending reset
    if (autoLayerTimeout.current) {
      clearTimeout(autoLayerTimeout.current);
      autoLayerTimeout.current = null;
    }
    if (layers.length <= 1) return;

    // Pre-build key maps for all layers
    const maps = layers.map((l) => buildKeyMap(l));
    const baseMap = maps[userLayer] ?? {};

    let bestLayer = userLayer;
    let bestScore = scoreLayer(pressedKeys, baseMap, baseMap);

    layers.forEach((layer, i) => {
      if (i === userLayer) return;
      const s = scoreLayer(pressedKeys, maps[i], baseMap);
      if (s > bestScore) {
        bestScore = s;
        bestLayer = i;
      }
    });

    // Stickiness: if we already auto-detected a layer and the base layer
    // doesn't score strictly higher than it, keep the current auto-layer.
    // This prevents flickering back to base on ambiguous key presses.
    if (bestLayer === userLayer && autoLayer !== null && autoLayer !== userLayer) {
      const currentAutoScore = scoreLayer(pressedKeys, maps[autoLayer] ?? {}, baseMap);
      if (currentAutoScore >= bestScore) {
        return; // keep current autoLayer
      }
    }

    setAutoLayer(bestLayer !== userLayer ? bestLayer : null);
  }, [pressedKeys, layers, userLayer, autoLayer]);

  // Cleanup debounce timeout on unmount
  useEffect(() => () => {
    if (autoLayerTimeout.current) clearTimeout(autoLayerTimeout.current);
  }, []);

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setScale(Math.min(width / CANVAS_W, height / CANVAS_H));
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

  const layerNames = config?.config?.layer_names ?? [];
  const currentLayer = layers[activeLayer] ?? [];
  const title = config?.layout_meta?.title;

  // Build reverse map for current layer to find pressed positions
  const keyMap = useMemo(() => buildKeyMap(currentLayer), [currentLayer]);
  const baseLayer = layers[userLayer] ?? [];
  const pressedPositions = useMemo(() => {
    const positions = new Set();
    // Standard key presses matched via OS keycode
    pressedKeys.forEach((k) => {
      (keyMap[k] || []).forEach((pos) => positions.add(pos));
    });
    // When a layer is auto-activated, highlight the key(s) that switched to it
    if (autoLayer !== null && autoLayer !== userLayer) {
      findLayerActivatorPositions(baseLayer, autoLayer, layerNames)
        .forEach((pos) => positions.add(pos));
    }
    return positions;
  }, [pressedKeys, keyMap, autoLayer, userLayer, baseLayer, layerNames]);

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
              tabIndex={-1}
              onClick={() => { setUserLayer(i); setAutoLayer(null); }}
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
            tabIndex={-1}
            onClick={() => { invoke("show_main_window"); appWindow.hide(); }}
            className="ml-2 text-slate-500 hover:text-primary transition-colors cursor-pointer"
            title="Open app"
          >
            <span className="material-symbols-outlined text-sm">open_in_new</span>
          </button>
          <button
            tabIndex={-1}
            onClick={() => appWindow.hide()}
            className="text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      </div>

      {/* Keyboard */}
      <div ref={containerRef} className="flex-1 px-2 pb-2 overflow-hidden flex items-center justify-center">
        {error && (
          <div className="flex items-center justify-center h-full text-slate-500 text-xs gap-1.5">
            <span className="material-symbols-outlined text-sm">error</span>
            {error}
          </div>
        )}
        {!error && currentLayer.length > 0 && (
          <div style={{ width: CANVAS_W * scale, height: CANVAS_H * scale, position: "relative", flexShrink: 0 }}>
          <div
            className="absolute top-0 left-0 origin-top-left"
            style={{ width: CANVAS_W, height: CANVAS_H, transform: `scale(${scale})` }}
          >
            {KEY_POSITIONS.map((pos, i) => {
              const key = currentLayer[i];
              const parsed = key ? parseKey(key, layerNames) : { label: "" };
              const { special, label, type } = parsed;
              const isEmpty = special === "∅";
              const isTransparent = special === "▽";
              const isLayer = type === "layer";
              const isPressed = pressedPositions.has(i);

              return (
                <div
                  key={i}
                  className={`absolute rounded-sm border select-none flex items-center justify-center transition-all duration-75
                    ${isEmpty ? "border-slate-700/15 bg-transparent text-slate-700" : ""}
                    ${isTransparent ? "border-slate-700/20 bg-slate-800/15 text-slate-600" : ""}
                    ${isLayer && !isPressed ? "border-emerald-500/30 bg-emerald-900/20 text-emerald-300" : ""}
                    ${!isEmpty && !isTransparent && !isLayer ? "border-slate-600/40 bg-slate-800/50 text-slate-200" : ""}
                    ${isPressed ? "!border-primary !bg-primary/25 !text-white ring-1 ring-primary/60 brightness-125" : ""}
                  `}
                  style={{ left: pos[0], top: pos[1], width: 65, height: 65 }}
                >
                  <span className="leading-tight break-all px-0.5 text-center" style={{ fontSize: 14 }}>
                    {special ?? label}
                  </span>
                </div>
              );
            })}
          </div>
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
