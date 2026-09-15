# 💻 shoRDs Desktop Application Guide (Laptop & Desktop Edition)

## 🌟 Overview
shoRDs Desktop brings the **exact same UI, features, workflows, and AI intelligence** from mobile directly to your laptop/desktop computer, enhanced with **laptop-native utilities** (window controls, global keyboard shortcuts, drag-and-drop local PDF ingestion, offline caching, and direct file export).

---

## 🚀 How to Launch the Desktop Application

### Option 1: One-Click Windows Launcher (Fastest)
Double-click:
👉 [`D:\shords\run_desktop.bat`](file:///D:/shords/run_desktop.bat)

### Option 2: Via Terminal Command
Run in your PowerShell or Command Prompt:
```powershell
npm run desktop
```

Or to rebuild from source and launch:
```powershell
npm run desktop:start
```

---

## ⌨️ Desktop Global Keyboard Shortcuts

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| **`Ctrl + F`** / **`Cmd + F`** | **Global Paper Search** | Instantly opens federated arXiv, DOAJ, and concept search |
| **`Ctrl + N`** / **`Cmd + N`** | **New Review Draft** | Creates a new Literature Review Studio note |
| **`Ctrl + K`** / **`Cmd + K`** | **Ask Research Copilot** | Opens the AI Copilot query palette for instant synthesis |
| **`Ctrl + Shift + E`** | **Export Citations** | Opens native file dialog to save BibTeX, RIS, or Markdown |
| **`F11`** | **Fullscreen Mode** | Toggle distraction-free literature study view |
| **`Ctrl + R`** | **Reload App** | Quick reload desktop state |
| **`Ctrl + Shift + Space`** | **Global Action Palette** | Focuses shoRDs window from any laptop application |

---

## 🛠️ Laptop-Specific Native Utilities

### 1. Drag & Drop Local PDF Ingestion
* Drag any scientific paper (`.pdf`) from your desktop file explorer and drop it into shoRDs.
* The local parser extracts metadata, sections, and figures into 4-section ReelCard digests.

### 2. Native Desktop Citation & Draft Exporter
* Save your literature review drafts, BibTeX bibliographies, and RIS files directly into your laptop's **`Documents`** or **`Downloads`** folder via the native Windows save dialog.

### 3. Responsive Multi-Monitor & 4K Display Support
* Minimum desktop window size: `1024 x 700` (auto-maximizes up to 4K widescreen monitors).
* Fluid responsive column scaling for laptop screens (13", 14", 15", 16").

### 4. Background Audio Brief Streaming
* Natural voice audio briefs continue playing seamlessly in the background while you work in other laptop windows.
