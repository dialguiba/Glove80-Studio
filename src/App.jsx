import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";
import LoginView from "./LoginView";
import DashboardView from "./DashboardView";
import LayoutConfigView from "./LayoutConfigView";

function App() {
  const [authed, setAuthed] = useState(null); // null = checking
  const [sessionExpired, setSessionExpired] = useState(false);
  const [layouts, setLayouts] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const [selectedLayoutId, setSelectedLayoutId] = useState(null);
  const [layoutConfig, setLayoutConfig] = useState(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState(null);

  const [activeLayout, setActiveLayout] = useState(null);

  useEffect(() => {
    invoke("get_active_layout").then((data) => {
      if (data) setActiveLayout(data);
    });
    invoke("check_auth").then((ok) => {
      setAuthed(ok);
      if (ok) fetchLayouts();
    });
  }, []);

  useEffect(() => {
    const unlisten = listen("auth-ready", () => {
      setAuthed(true);
      fetchLayouts();
    });
    return () => unlisten.then((f) => f());
  }, []);

  async function handleTokenExpired() {
    await invoke("logout");
    setAuthed(false);
    setSessionExpired(true);
    setLayouts(null);
    setError(null);
    handleBack();
  }

  async function fetchLayouts() {
    setLoading(true);
    setError(null);
    setLayouts(null);
    try {
      const data = await invoke("get_layouts");
      setLayouts(data);
    } catch (e) {
      if (String(e).includes("TOKEN_EXPIRED")) {
        await handleTokenExpired();
      } else {
        setError(String(e));
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectLayout(id) {
    setSelectedLayoutId(id);
    setLayoutConfig(null);
    setConfigError(null);
    setConfigLoading(true);
    try {
      const data = await invoke("get_layout_config", { layoutId: id });
      setLayoutConfig(data);
    } catch (e) {
      if (String(e).includes("TOKEN_EXPIRED")) {
        await handleTokenExpired();
      } else {
        setConfigError(String(e));
      }
    } finally {
      setConfigLoading(false);
    }
  }

  function handleBack() {
    setSelectedLayoutId(null);
    setLayoutConfig(null);
    setConfigError(null);
  }

  async function handleSetActive(id, title, config) {
    let cfg = config;
    if (!cfg) {
      cfg = await invoke("get_layout_config", { layoutId: id });
    }
    await invoke("set_active_layout", { layoutId: id, title, config: cfg });
    setActiveLayout({ id, title });
  }

  async function handleLogout() {
    await invoke("logout");
    setAuthed(false);
    setLayouts(null);
    setError(null);
    handleBack();
  }

  if (authed === null) return null; // verificando sesión
  if (!authed) return <LoginView sessionExpired={sessionExpired} />;

  if (selectedLayoutId) {
    return (
      <LayoutConfigView
        config={layoutConfig}
        loading={configLoading}
        error={configError}
        onBack={handleBack}
        isActive={activeLayout?.id === selectedLayoutId}
        onSetActive={() => {
          const title = layoutConfig?.layout_meta?.title ?? "Untitled";
          handleSetActive(selectedLayoutId, title, layoutConfig);
        }}
      />
    );
  }

  return (
    <DashboardView
      layouts={Array.isArray(layouts) ? layouts : null}
      loading={loading}
      error={error}
      onRefresh={fetchLayouts}
      onLogout={handleLogout}
      onSelectLayout={handleSelectLayout}
      activeLayoutId={activeLayout?.id}
      onSetActive={handleSetActive}
    />
  );
}

export default App;
