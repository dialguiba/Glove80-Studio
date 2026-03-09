import { useState, useEffect, useRef, useLayoutEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import ZMK_KEY_LABELS from "./zmkKeyLabels";

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

// Resolve a ZMK key name to a human-readable label.
// Returns string or { primary, shifted } for dual-legend keys.
function humanLabel(name) {
  if (!name) return name;
  const lookup = (n) => {
    const v = ZMK_KEY_LABELS[n];
    if (!v) return null;
    if (Array.isArray(v)) return { primary: v[0], shifted: v[1] };
    return v;
  };
  return lookup(name) ?? lookup(stripModifiers(name)) ?? name;
}

function parseKey(key, layerNames = []) {
  if (!key || typeof key !== "object") return { label: String(key) };
  const val = key.value ?? "";
  const params = key.params ?? [];
  if (val === "&trans") return { special: "▽" };
  if (val === "&none") return { special: "∅" };
  if (val === "&kp") {
    const resolved = params.length === 1 ? humanLabel(String(params[0].value ?? "")) : null;
    if (resolved && typeof resolved === "object" && resolved.primary) {
      return { label: resolved.primary, shifted: resolved.shifted };
    }
    const paramStr = params.map((p) => {
      const r = humanLabel(String(p.value ?? ""));
      return (typeof r === "object") ? r.primary : r;
    }).filter(Boolean).join(" ");
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
  const paramStr = params.map((p) => {
    const r = humanLabel(String(p.value ?? ""));
    return (typeof r === "object") ? r.primary : r;
  }).filter(Boolean).join(" ");
  return { label: paramStr ? `${base} ${paramStr}` : base };
}

// Generate a human-readable tooltip for a key based on its ZMK behavior
function getKeyTooltip(key, layerNames = []) {
  if (!key || typeof key !== "object") return null;
  const val = key.value ?? "";
  const params = key.params ?? [];
  const p = (i) => String(params[i]?.value ?? "");

  const layerLabel = (idx) => {
    const n = parseInt(idx);
    return !isNaN(n) && layerNames[n] ? `"${layerNames[n]}" (${n})` : idx;
  };

  switch (val) {
    case "&kp":    return `Key Press: ${p(0)}`;
    case "&trans": return "Transparent — passes through to the next active layer";
    case "&none":  return "No Operation — blocks any key press";
    case "&mt":    return `Mod-Tap — hold: ${p(0)}, tap: ${p(1)}`;
    case "&lt":    return `Layer-Tap — hold: layer ${layerLabel(p(0))}, tap: ${p(1)}`;
    case "&mo":    return `Momentary Layer — active while held: ${layerLabel(p(0))}`;
    case "&tog":   return `Toggle Layer — enables/disables: ${layerLabel(p(0))}`;
    case "&to":    return `To Layer — switch to ${layerLabel(p(0))}, disable all others`;
    case "&sl":    return `Sticky Layer — activates ${layerLabel(p(0))} until next key`;
    case "&sk":    return `Sticky Key — stays pressed until next key: ${p(0)}`;
    case "&kt":    return `Key Toggle — toggles hold of: ${p(0)}`;
    case "&gresc": return "Grave Escape — Escape normally, backtick (`) with Shift or GUI";
    case "&caps_word": return "Caps Word — like Caps Lock but auto-disables on non-word keys";
    case "&key_repeat": return "Key Repeat — resends last pressed key";
    case "&sys_reset":  return "System Reset — reboots the keyboard firmware";
    case "&bootloader": return "Bootloader — enter bootloader/DFU mode for flashing";
    case "&soft_off":   return "Soft Off — turn the keyboard off";
    case "&studio_unlock": return "Studio Unlock — unlock device for ZMK Studio configuration";
    case "&mkp": return `Mouse Button Press: ${p(0)}`;
    case "&mmv": return `Mouse Move: ${p(0)}`;
    case "&msc": return `Mouse Scroll: ${p(0)}`;
    case "&bt": {
      const cmd = p(0);
      if (cmd === "BT_SEL") return `Bluetooth — select profile ${p(1)}`;
      if (cmd === "BT_PRV") return "Bluetooth — previous profile";
      if (cmd === "BT_NXT") return "Bluetooth — next profile";
      if (cmd === "BT_CLR") return "Bluetooth — clear current profile bond";
      if (cmd === "BT_DISC") return `Bluetooth — disconnect profile ${p(1)}`;
      return `Bluetooth: ${params.map((x) => x.value).join(" ")}`;
    }
    case "&out": {
      const cmd = p(0);
      if (cmd === "OUT_USB") return "Output — switch to USB";
      if (cmd === "OUT_BLE") return "Output — switch to Bluetooth";
      if (cmd === "OUT_TOG") return "Output — toggle USB/Bluetooth";
      return `Output: ${p(0)}`;
    }
    case "&rgb_ug": return `RGB Underglow: ${params.map((x) => x.value).join(" ")}`;
    case "&bl":     return `Backlight: ${p(0)}`;
    case "&ext_power": return `External Power: ${p(0)}`;
    default: {
      // Named custom behaviors (e.g. &magic, &lower, &bt_0)
      const base = val.replace(/^&/, "");
      const paramStr = params.map((x) => String(x.value ?? "")).filter(Boolean).join(" ");
      // If it matches a layer name, describe as layer switch
      const matchedLayer = layerNames.findIndex((n) => n.toLowerCase() === base.toLowerCase());
      if (matchedLayer >= 0) return `Layer behavior — "${layerNames[matchedLayer]}"`;
      return paramStr ? `${base}: ${paramStr}` : base;
    }
  }
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

function findKeyPositionsWidget(layer, query, layerNames) {
  if (!query || !query.trim()) return new Set();
  const q = query.trim().toLowerCase();
  const positions = new Set();
  layer.forEach((key, i) => {
    if (!key || typeof key !== "object") return;
    const parsed = parseKey(key, layerNames);
    const primary = (parsed.special ?? parsed.label ?? "").toLowerCase();
    const shifted = (parsed.shifted ?? "").toLowerCase();
    if (primary === q || shifted === q) positions.add(i);
  });
  return positions;
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
  const [keySearch, setKeySearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const searchInputRef = useRef(null);
  const [hoveredTooltip, setHoveredTooltip] = useState(null); // { text, x, y }

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

  // Key search hits
  const searchHitsPerLayer = useMemo(() => {
    if (!keySearch.trim()) return [];
    return layers.map((layer) => findKeyPositionsWidget(layer, keySearch, layerNames));
  }, [keySearch, layers, layerNames]);

  const highlightedPositions = keySearch.trim() ? (searchHitsPerLayer[activeLayer] ?? new Set()) : new Set();

  // Total hits across all layers
  const totalSearchHits = searchHitsPerLayer.reduce((sum, s) => sum + (s?.size ?? 0), 0);

  // Auto-navigate to first layer with hits
  useEffect(() => {
    if (!keySearch.trim()) return;
    const firstHit = searchHitsPerLayer.findIndex((s) => s && s.size > 0);
    if (firstHit >= 0 && firstHit !== userLayer) {
      setUserLayer(firstHit);
      setAutoLayer(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keySearch]);

  // Focus search input when shown
  useEffect(() => {
    if (showSearch && searchInputRef.current) searchInputRef.current.focus();
  }, [showSearch]);

  // Navigate to next layer with search results
  function goNextSearchLayer() {
    if (!keySearch.trim()) return;
    const start = (activeLayer + 1) % layers.length;
    for (let offset = 0; offset < layers.length; offset++) {
      const idx = (start + offset) % layers.length;
      if (searchHitsPerLayer[idx]?.size > 0) {
        setUserLayer(idx);
        setAutoLayer(null);
        break;
      }
    }
  }

  return (
    <div
      onMouseDown={handleMouseDown}
      className="w-screen h-screen bg-background-dark text-slate-100 flex flex-col overflow-hidden select-none"
      style={{ cursor: dragging ? "grabbing" : "default" }}
    >
      {/* Titlebar */}
      <div className="flex flex-col shrink-0">
        <div className="flex items-center justify-between px-3 py-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="material-symbols-outlined text-primary text-sm">keyboard_alt</span>
            <span className="text-xs font-medium text-slate-300 truncate">{title ?? "No active layout"}</span>
          </div>
          <div className="flex items-center gap-1">
            {layerNames.map((name, i) => {
              const hitCount = searchHitsPerLayer[i]?.size ?? 0;
              return (
                <button
                  key={i}
                  tabIndex={-1}
                  onClick={() => { setUserLayer(i); setAutoLayer(null); }}
                  className={`text-[10px] px-1.5 py-0.5 rounded transition-colors cursor-pointer relative ${
                    activeLayer === i
                      ? "bg-primary/20 text-primary"
                      : hitCount > 0
                      ? "text-amber-300 bg-amber-500/10"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {name}
                  {hitCount > 0 && (
                    <span className="absolute -top-1 -right-1 text-[8px] w-3.5 h-3.5 flex items-center justify-center rounded-full bg-amber-500 text-black font-bold leading-none">
                      {hitCount > 9 ? "9+" : hitCount}
                    </span>
                  )}
                </button>
              );
            })}
            <button
              tabIndex={-1}
              onClick={() => { setShowSearch((v) => !v); if (showSearch) setKeySearch(""); }}
              className={`ml-1 transition-colors cursor-pointer ${showSearch ? "text-amber-400" : "text-slate-500 hover:text-slate-300"}`}
              title="Find key"
            >
              <span className="material-symbols-outlined text-sm">manage_search</span>
            </button>
            <button
              tabIndex={-1}
              onClick={() => { invoke("show_main_window"); appWindow.hide(); }}
              className="ml-1 text-slate-500 hover:text-primary transition-colors cursor-pointer"
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
        {showSearch && (
          <div className="px-3 pb-1.5 flex items-center gap-1.5" onMouseDown={(e) => e.stopPropagation()}>
            <div className="relative flex-1 flex items-center">
              <span className="material-symbols-outlined text-slate-500 text-xs absolute left-2 pointer-events-none">search</span>
              <input
                ref={searchInputRef}
                type="text"
                value={keySearch}
                onChange={(e) => setKeySearch(e.target.value)}
                placeholder="Find key…"
                className="w-full rounded pl-7 pr-6 py-0.5 text-xs text-slate-100 placeholder-slate-600 bg-slate-800/60 border border-slate-700/50 focus:border-amber-400/50 focus:outline-none transition-colors"
              />
              {keySearch && (
                <button
                  tabIndex={-1}
                  onClick={() => setKeySearch("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 cursor-pointer flex items-center"
                >
                  <span className="material-symbols-outlined" style={{fontSize: "10px"}}>close</span>
                </button>
              )}
            </div>
            {keySearch.trim() && totalSearchHits > 0 && (
              <button
                tabIndex={-1}
                onClick={goNextSearchLayer}
                className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 cursor-pointer shrink-0 transition-colors"
                title="Next layer with results"
              >
                next ›
              </button>
            )}
            {keySearch.trim() && (
              <span className="text-[10px] text-slate-500 shrink-0">
                {totalSearchHits > 0 ? `${totalSearchHits} found` : "no matches"}
              </span>
            )}
          </div>
        )}
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
              const { special, label, shifted, type } = parsed;
              const tooltip = key ? getKeyTooltip(key, layerNames) : null;
              const isEmpty = special === "∅";
              const isTransparent = special === "▽";
              const isLayer = type === "layer";
              const isPressed = pressedPositions.has(i);
              const isHighlighted = !isPressed && highlightedPositions.has(i);

              return (
                <div
                  key={i}
                  className={`absolute rounded-sm border select-none flex items-center justify-center transition-all duration-75
                    ${!isPressed && !isHighlighted && isEmpty ? "border-slate-700/15 bg-transparent text-slate-700" : ""}
                    ${!isPressed && !isHighlighted && isTransparent ? "border-slate-700/20 bg-slate-800/15 text-slate-600" : ""}
                    ${!isPressed && !isHighlighted && isLayer ? "border-emerald-500/30 bg-emerald-900/20 text-emerald-300" : ""}
                    ${!isPressed && !isHighlighted && !isEmpty && !isTransparent && !isLayer ? "border-slate-600/40 bg-slate-800/50 text-slate-200" : ""}
                    ${isPressed ? "!border-primary !bg-primary/25 !text-white ring-1 ring-primary/60 brightness-125" : ""}
                    ${isHighlighted ? "!border-amber-400/80 !bg-amber-500/20 !text-amber-100 ring-1 ring-amber-400/50" : ""}
                  `}
                  style={{ left: pos[0], top: pos[1], width: 65, height: 65 }}
                  onMouseEnter={tooltip ? (e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHoveredTooltip({ text: tooltip, x: rect.left + rect.width / 2, y: rect.top });
                  } : undefined}
                  onMouseLeave={tooltip ? () => setHoveredTooltip(null) : undefined}
                >
                  {shifted ? (
                    <span className="flex flex-col items-center leading-none px-0.5 gap-1">
                      <span className="text-slate-400" style={{ fontSize: 13 }}>{shifted}</span>
                      <span style={{ fontSize: 16 }}>{label}</span>
                    </span>
                  ) : (
                    <span className="leading-tight break-all px-0.5 text-center" style={{ fontSize: 14 }}>
                      {special ?? label}
                    </span>
                  )}
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

      {/* Key tooltip overlay */}
      {hoveredTooltip && (
        <div
          className="fixed z-50 pointer-events-none px-2 py-1 rounded text-[11px] text-slate-100 bg-slate-900/95 border border-slate-600/60 shadow-lg max-w-[220px] text-center leading-tight"
          style={{
            left: hoveredTooltip.x,
            top: hoveredTooltip.y - 8,
            transform: "translate(-50%, -100%)",
          }}
        >
          {hoveredTooltip.text}
        </div>
      )}
    </div>
  );
}
