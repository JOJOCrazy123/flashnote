# <img src="assets/icon-source.png" alt="FlashNote" height="42" align="top"> FlashNote

> 📖 中文版本：[README](assets/README.zh-CN.md)

A lightweight, cross-platform (macOS & Windows) quick-note desktop app for instantly capturing ideas and todos with a global hotkey — before they slip away.

Built with **Tauri v2 + TypeScript**, no frontend framework. The release bundle is only a few megabytes.

---

## Features

- **⚡ Global hotkey** — Summon/dismiss the flash input from anywhere. Default `Cmd/Ctrl + Shift + A`, fully re-bindable.
- **💡 Ideas vs. Todos** — Tag each note as an *idea* or a *todo*; todos can be checked off.
- **📅 Daily JSON persistence** — Every note is stored locally in `YYYY-MM-DD.json`, one file per day. Human-readable and easy to back up or sync.
- **🔎 Day / Week / Month history** — Slide the mouse to the bottom edge of the window and a history panel slides open; filter by day, week, or month. Move away and it retracts.
- **🎛️ Settings anywhere** — Change the hotkey via the system tray menu or the in-window gear button. Key capture records your combo live; saving takes effect immediately.
- **🪶 Flash input UX** — Frameless, translucent, always-on-top window that auto-hides on blur, so it never gets in your way.

---

## Why FlashNote? — Size Comparison

Most note-taking desktop apps are built on **Electron**, which bundles a full Chromium runtime — so their installers routinely weigh **100–240 MB**. FlashNote is built on **Tauri**, using the OS-native webview instead, so the entire macOS `.dmg` is just **≈ 4.6 MB**.

| App / Project | Stack | Installer / Package size | Where you can see the size |
| ------------- | -------- | ------------------------ | -------------------------- |
| **⚡ FlashNote** | **Tauri** | **≈ 4.6 MB** (macOS `.dmg`) | this repository |
| [Obsidian](https://forum.obsidian.md/t/obsidian-for-windows-1-6-5-installer-increased-in-size-from-79-mb-to-236-mb/84322) | Electron | ≈ 236 MB (Windows installer) | Obsidian forum thread |
| [Logseq](https://github.com/logseq/logseq/releases) | Electron | ≈ 190 MB (macOS arm64 `.dmg`) | GitHub releases |
| [Joplin](https://github.com/laurent22/joplin/releases) | Electron | ≈ 148 MB (macOS arm64 `.dmg`) | GitHub releases |
| [Simplenote](https://sourceforge.net/projects/simplenote-for-electron.mirror/files/) | Electron | ≈ 143 MB (Linux arm64 `.tar.gz`) | SourceForge release mirror |
| [TriliumNext Notes](https://github.com/TriliumNext/Notes/releases) | Electron | ≈ 119 MB (Linux `.deb`) | GitHub releases |

> Sizes above are from the linked official release/download pages (verified, not estimated). Against them, FlashNote's 4.6 MB bundle is roughly **26×–51× smaller** — a genuinely lightweight quick-capture tool.

---

## Quick Start

```bash
# Install frontend dependencies
npm install

# Run in development (hot reload)
npm run tauri:dev

# Build a production bundle
#   macOS -> .app + .dmg (the .app is also auto-installed to /Applications)
#   Windows -> .msi / .exe
# Artifacts are copied to release/<version>/ (git-ignored).
npm run tauri:build
```

---

## Tech Stack

| Layer      | Choice                                            |
| ---------- | ------------------------------------------------- |
| Shell      | [Tauri v2](https://tauri.app/) (Rust)             |
| Frontend   | Vanilla TypeScript + Vite                         |
| Storage    | Per-day JSON files in the OS app-data directory   |
| Hotkey     | `tauri-plugin-global-shortcut`                    |
| Dates      | `chrono` (Rust)                                   |

---

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust toolchain](https://www.rust-lang.org/tools/install) (stable) + Cargo
- Platform build dependencies per the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/)

---

## Usage

1. Launch the app — it lives in the **system tray / menu bar** and stays hidden until called.
2. Press **`Cmd/Ctrl + Shift + A`** to open the flash input.
3. Type your note, toggle **Idea / Todo** at the top, and press **Enter** to save (the window auto-hides).
4. Press the hotkey again, then **slide the mouse to the bottom edge** to reveal history. Filter by **Day / Week / Month**, check off todos, or delete entries.
5. Press **Esc** or click away to dismiss.

### Changing the hotkey

Open **Settings** from either:

- The **tray icon** → right-click → *Settings…*, or
- The **gear ⚙ button** in the top-right of the flash window.

Click the capture box, hold your desired combo (must be **one or more modifiers + one or more main keys**, e.g. `⌘⇧A` or `⇧QW`), then release a main key and click **Save**. The new hotkey is registered instantly.

---

## Data Location

Notes are stored as one JSON file per day inside the OS application-data directory:

| OS      | Path                                                              |
| ------- | ---------------------------------------------------------------- |
| macOS   | `~/Library/Application Support/<app-identifier>/notes/`          |
| Windows | `%APPDATA%\<app-identifier>\notes\`                              |

Each file (`YYYY-MM-DD.json`) is an array of note objects:

```json
[
  {
    "id": "1720000000000-0",
    "text": "Ship the FlashNote MVP",
    "type": "todo",
    "done": false,
    "ts": 1720000000000
  }
]
```

Settings (the hotkey) live in `settings.json` in the app config directory.

---

## Project Structure

```
flashnote/
├── index.html            # Flash input window entry
├── settings.html         # Settings window entry
├── vite.config.ts        # Multi-page Vite config
├── assets/
│   ├── icon-source.png   # Source image used to generate app icons
│   └── README.zh-CN.md   # Chinese documentation
├── src/                  # Frontend (TypeScript)
│   ├── main.ts           # Flash input + history logic
│   ├── styles.css
│   ├── settings.ts       # Settings panel + key capture
│   └── settings.css
├── release/              # Build artifacts, split by version (git-ignored)
│   └── <version>/        # e.g. release/0.2.0/ -> FlashNote.app + .dmg
└── src-tauri/            # Rust backend
    ├── src/lib.rs        # Commands, tray, global shortcut, persistence
    ├── src/main.rs
    ├── capabilities/     # Tauri permission set
    ├── icons/            # Generated app icons
    └── tauri.conf.json
```

---

## License

MIT
