# Glove80 Tauri

A desktop companion app for managing and visualizing [MoErgo Glove80](https://www.moergo.com/) keyboard layouts.

![Tauri](https://img.shields.io/badge/Tauri-2-blue)
![React](https://img.shields.io/badge/React-19-blue)
![Rust](https://img.shields.io/badge/Rust-Backend-orange)

## Features

- **OAuth Authentication** — Sign in with your MoErgo account to access your layouts
- **Layout Management** — Browse, view, and set active layouts with local caching
- **Keyboard Visualization** — Interactive 80-key layout viewer with multi-layer support and color-coded keys
- **Floating Widget** — Always-accessible mini window for quick layout reference
- **Tray Icon** — Toggle the widget from the system tray

## Tech Stack

| Layer    | Technology                  |
| -------- | --------------------------- |
| Frontend | React 19, Tailwind CSS 4    |
| Backend  | Rust (Tauri 2)              |
| Build    | Vite 7, Bun                 |
| HTTP     | reqwest (Rust)              |

## Prerequisites

- [Bun](https://bun.sh/)
- [Rust toolchain](https://rustup.rs/)
- Platform-specific Tauri dependencies — see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

## Getting Started

```bash
# Install dependencies
bun install

# Run in development mode
bun run tauri:dev

# Build for production
bun run tauri:build
```

## Project Structure

```text
src/                    # React frontend
├── App.jsx             # Main app component (auth & routing)
├── LoginView.jsx       # MoErgo OAuth login
├── DashboardView.jsx   # Layout list dashboard
├── LayoutConfigView.jsx# Keyboard visualization
└── WidgetView.jsx      # Floating widget window

src-tauri/              # Rust backend
├── src/lib.rs          # Tauri commands & API integration
└── tauri.conf.json     # App configuration
```

## TODO

- [ ] Map remaining unmapped keys to human-readable labels
- [ ] Fix key hover descriptions (tooltips) to show accurate information

## License

MIT
