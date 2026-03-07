use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    path::BaseDirectory,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};

struct AppState {
    id_token: Mutex<Option<String>>,
    access_token: Mutex<Option<String>>,
    user_id: Mutex<Option<String>>,
}

#[tauri::command]
async fn get_layouts(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let token = state.id_token.lock().unwrap().clone().ok_or("No token")?;
    let user_id = state.user_id.lock().unwrap().clone().ok_or("No user_id")?;

    let client = reqwest::Client::new();

    // 1. Fetch list of layout IDs
    let list_url = format!(
        "https://my.moergo.com/api/glove80/layouts/v1/users/{}",
        user_id
    );
    let list_resp = client
        .get(&list_url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if list_resp.status() == 401 {
        return Err("TOKEN_EXPIRED".into());
    }
    let list: serde_json::Value = list_resp
        .json()
        .await
        .map_err(|e| e.to_string())?;

    // 2. Extract IDs — items are strings like "uuid:compiled" or objects with "id"/"uuid"
    let extract_ids = |arr: &Vec<serde_json::Value>| -> Vec<String> {
        arr.iter()
            .filter_map(|v| {
                if let Some(s) = v.as_str() {
                    // "uuid:compiled" or "uuid:draft" — take the part before ':'
                    Some(s.split(':').next().unwrap_or(s).to_string())
                } else {
                    v["id"].as_str().or(v["uuid"].as_str()).map(String::from)
                }
            })
            .collect()
    };

    let ids: Vec<String> = if let Some(arr) = list.as_array() {
        extract_ids(arr)
    } else if let Some(arr) = list["layouts"].as_array() {
        extract_ids(arr)
    } else {
        return Ok(list);
    };

    // Return raw list for debugging if we couldn't extract any IDs
    if ids.is_empty() {
        return Ok(list);
    }

    // 3. Fetch meta for all layouts concurrently
    let meta_futures: Vec<_> = ids.iter().map(|id| {
        let client = client.clone();
        let token = token.clone();
        let url = format!("https://my.moergo.com/api/glove80/layouts/v1/{}/meta", id);
        async move {
            let res = client
                .get(&url)
                .header("Authorization", format!("Bearer {}", token))
                .send()
                .await;
            match res {
                Err(e) => Err(e.to_string()),
                Ok(r) => r.json::<serde_json::Value>().await.map_err(|e| e.to_string()),
            }
        }
    }).collect();

    let metas = futures::future::join_all(meta_futures).await;

    let result: Vec<serde_json::Value> = ids.iter().zip(metas.iter()).map(|(id, meta)| {
        match meta {
            Ok(obj) => {
                let mut obj = obj.clone();
                if obj.get("id").is_none() {
                    obj["id"] = serde_json::json!(id);
                }
                obj
            }
            Err(e) => serde_json::json!({ "id": id, "_error": e }),
        }
    }).collect();

    Ok(serde_json::json!(result))
}

#[tauri::command]
async fn get_layout_meta(
    layout_id: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let token = state.id_token.lock().unwrap().clone().ok_or("No token")?;

    let client = reqwest::Client::new();
    let url = format!(
        "https://my.moergo.com/api/glove80/layouts/v1/{}/meta",
        layout_id
    );
    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if response.status() == 401 {
        return Err("TOKEN_EXPIRED".into());
    }

    let json = response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;
    Ok(json)
}

#[tauri::command]
async fn get_layout_config(
    layout_id: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let token = state.id_token.lock().unwrap().clone().ok_or("No token")?;

    let client = reqwest::Client::new();
    let url = format!(
        "https://my.moergo.com/api/glove80/layouts/v1/{}/config",
        layout_id
    );
    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if response.status() == 401 {
        return Err("TOKEN_EXPIRED".into());
    }

    let json = response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;
    Ok(json)
}

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .resolve("", BaseDirectory::AppData)
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn active_layout_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app_data_dir(app)?.join("active_layout.json"))
}

fn session_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app_data_dir(app)?.join("session.json"))
}

fn load_session(app: &AppHandle, state: &AppState) {
    let Ok(path) = session_path(app) else { return };
    let Ok(contents) = std::fs::read_to_string(&path) else { return };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&contents) else { return };
    if let Some(t) = json["id_token"].as_str() {
        *state.id_token.lock().unwrap() = Some(t.to_string());
    }
    if let Some(t) = json["access_token"].as_str() {
        *state.access_token.lock().unwrap() = Some(t.to_string());
    }
    if let Some(u) = json["user_id"].as_str() {
        *state.user_id.lock().unwrap() = Some(u.to_string());
    }
}

#[tauri::command]
async fn get_active_layout(app: AppHandle) -> Result<serde_json::Value, String> {
    let path = active_layout_path(&app)?;
    match std::fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).map_err(|e| e.to_string()),
        Err(_) => Ok(serde_json::json!(null)),
    }
}

#[tauri::command]
async fn set_active_layout(
    layout_id: String,
    title: String,
    config: serde_json::Value,
    app: AppHandle,
) -> Result<(), String> {
    let path = active_layout_path(&app)?;
    let data = serde_json::json!({ "id": layout_id, "title": title, "config": config });
    std::fs::write(&path, serde_json::to_string(&data).unwrap())
        .map_err(|e| e.to_string())?;
    let _ = app.emit("active-layout-changed", ());
    Ok(())
}

#[tauri::command]
async fn get_active_layout_config(app: AppHandle) -> Result<serde_json::Value, String> {
    let active: serde_json::Value = get_active_layout(app).await?;
    if active.is_null() {
        return Err("No active layout set".into());
    }
    if active.get("config").is_some() {
        Ok(active["config"].clone())
    } else {
        Err("No cached config".into())
    }
}

#[tauri::command]
async fn check_auth(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.id_token.lock().unwrap().is_some())
}

#[tauri::command]
async fn logout(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    *state.id_token.lock().unwrap() = None;
    *state.access_token.lock().unwrap() = None;
    *state.user_id.lock().unwrap() = None;
    if let Ok(path) = session_path(&app) {
        let _ = std::fs::remove_file(&path);
    }
    Ok(())
}

#[tauri::command]
async fn toggle_widget(app: AppHandle) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    if let Some(win) = app.get_webview_window("widget") {
        if win.is_visible().unwrap_or(false) {
            win.hide().map_err(|e| e.to_string())?;
        } else {
            win.show().map_err(|e| e.to_string())?;
            win.set_focus().map_err(|e| e.to_string())?;
        }
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, "widget", WebviewUrl::default())
        .title("Glove80 Widget")
        .inner_size(720.0, 340.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn open_login(app: AppHandle) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    // Script that polls localStorage for Cognito tokens
    // user_id is extracted from the idToken's `sub` claim (same as Cognito GetUser response)
    let script = r#"
        // Clear any existing tokens so the user must log in fresh
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key && (key.endsWith('.idToken') || key.endsWith('.accessToken'))) {
                localStorage.removeItem(key);
            }
        }

        const _glove80Poll = setInterval(() => {
            let idToken = null;
            let accessToken = null;

            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.endsWith('.idToken')) {
                    idToken = localStorage.getItem(key);
                }
                if (key && key.endsWith('.accessToken')) {
                    accessToken = localStorage.getItem(key);
                }
            }

            if (idToken) {
                clearInterval(_glove80Poll);
                try {
                    const payload = JSON.parse(atob(idToken.split('.')[1]));
                    window.__TAURI_INTERNALS__.invoke('store_token', {
                        idToken,
                        accessToken: accessToken || '',
                        userId: payload.sub || '',
                    });
                } catch(e) {
                    window.__TAURI_INTERNALS__.invoke('store_token', {
                        idToken,
                        accessToken: accessToken || '',
                        userId: '',
                    });
                }
            }
        }, 500);
    "#;

    WebviewWindowBuilder::new(
        &app,
        "login",
        WebviewUrl::External("https://my.moergo.com/glove80/".parse().unwrap()),
    )
    .title("Glove80 - Login")
    .inner_size(1000.0, 700.0)
    .initialization_script(script)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn store_token(
    id_token: String,
    access_token: String,
    user_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    *state.id_token.lock().unwrap() = Some(id_token.clone());
    *state.access_token.lock().unwrap() = Some(access_token.clone());
    *state.user_id.lock().unwrap() = Some(user_id.clone());

    // Persist session to disk
    if let Ok(path) = session_path(&app) {
        let data = serde_json::json!({
            "id_token": id_token,
            "access_token": access_token,
            "user_id": user_id,
        });
        let _ = std::fs::write(&path, serde_json::to_string(&data).unwrap());
    }

    // Close login window
    if let Some(win) = app.get_webview_window("login") {
        win.close().map_err(|e| e.to_string())?;
    }

    // Notify main window that auth is ready
    app.emit("auth-ready", ()).map_err(|e: tauri::Error| e.to_string())?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            id_token: Mutex::new(None),
            access_token: Mutex::new(None),
            user_id: Mutex::new(None),
        })
        .setup(|app| {
            // Ocultar del Dock en macOS (solo icono en barra de menú)
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Restaurar sesión guardada
            let state = app.state::<AppState>();
            load_session(app.handle(), &state);

            let show = MenuItem::with_id(app, "show", "Mostrar ventana", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("Glove80")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        let app = tray.app_handle().clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = toggle_widget(app).await;
                        });
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![check_auth, logout, get_layouts, get_layout_meta, get_layout_config, get_active_layout, set_active_layout, get_active_layout_config, toggle_widget, open_login, store_token])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
