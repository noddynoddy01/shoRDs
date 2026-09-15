/**
 * shoRDs Desktop Application — Main Process
 * High-performance native desktop container for Windows, macOS, and Linux laptops/desktops.
 * Integrates an embedded local HTTP server for Expo/React Native Web (port 8081)
 * and starts the shoRDs backend gateway (port 4000) so the app works instantly out-of-the-box.
 */

const { app, BrowserWindow, ipcMain, dialog, globalShortcut, Notification, clipboard, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

let mainWindow = null;
let staticServer = null;
let backendServer = null;

const FRONTEND_PORT = 8081;
const BACKEND_PORT = 4000;
const DIST_DIR = path.join(__dirname, '..', 'dist');

// MIME types for static assets
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf'
};

/**
 * 1. Embedded Static File Server for React Native / Expo Web SPA (Port 8081)
 */
function startStaticServer() {
  return new Promise((resolve) => {
    staticServer = http.createServer((req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

      let reqUrl = req.url.split('?')[0];
      if (reqUrl === '/') reqUrl = '/index.html';

      let filePath = path.join(DIST_DIR, reqUrl);

      // Check if file exists
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
      } else {
        // SPA Fallback: serve index.html for all client-side routes (/feed, /discover, /review, etc.)
        const indexHtmlPath = path.join(DIST_DIR, 'index.html');
        if (fs.existsSync(indexHtmlPath)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          fs.createReadStream(indexHtmlPath).pipe(res);
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('shoRDs Desktop: dist/index.html not found. Please run npm run desktop:build.');
        }
      }
    });

    staticServer.on('error', (err) => {
      console.log(`[Static Server] Port ${FRONTEND_PORT} warning:`, err.message);
      resolve();
    });

    staticServer.listen(FRONTEND_PORT, '127.0.0.1', () => {
      console.log(`[shoRDs Desktop] Frontend UI Server running on http://127.0.0.1:${FRONTEND_PORT}`);
      resolve();
    });
  });
}

/**
 * 2. Embedded Backend Gateway Server (Port 4000)
 */
function startBackendServer() {
  return new Promise((resolve) => {
    try {
      // Test if port 4000 is already running
      const testReq = http.request({ host: '127.0.0.1', port: BACKEND_PORT, path: '/health', timeout: 500 }, (res) => {
        console.log('[shoRDs Desktop] Backend is already running on port', BACKEND_PORT);
        resolve();
      });
      testReq.on('error', () => {
        // Start embedded backend
        try {
          const backendPath = path.join(__dirname, '..', 'backend', 'start_local_server.js');
          if (fs.existsSync(backendPath)) {
            require(backendPath);
            console.log('[shoRDs Desktop] Backend Gateway initialized on port', BACKEND_PORT);
          }
        } catch (e) {
          console.log('[shoRDs Desktop] Backend auto-start notice:', e.message);
        }
        resolve();
      });
      testReq.end();
    } catch (e) {
      resolve();
    }
  });
}

/**
 * 3. Create Main Electron Window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#0B1020',
    title: 'shoRDs — Research Operating System',
    icon: path.join(__dirname, '..', 'assets', 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: false // Enables seamless local socket & API communication
    },
    frame: true,
    show: false
  });

  // Load the application from local embedded server
  mainWindow.loadURL(`http://127.0.0.1:${FRONTEND_PORT}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.on('did-fail-load', () => {
    console.log('[shoRDs Desktop] Retrying connection to frontend server...');
    setTimeout(() => {
      mainWindow?.loadURL(`http://127.0.0.1:${FRONTEND_PORT}`);
    }, 1000);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  setupMenu();
  registerShortcuts();
}

function setupMenu() {
  const template = [
    {
      label: 'shoRDs',
      submenu: [
        { label: 'About shoRDs', role: 'about' },
        { type: 'separator' },
        { label: 'Quit shoRDs', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
      ]
    },
    {
      label: 'Research',
      submenu: [
        {
          label: 'Search Papers & Concepts',
          accelerator: 'CmdOrCtrl+F',
          click: () => mainWindow?.webContents.send('shortcut-pressed', 'SEARCH')
        },
        {
          label: 'New Literature Review Note',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('shortcut-pressed', 'NEW_NOTE')
        },
        {
          label: 'Ask Research Copilot',
          accelerator: 'CmdOrCtrl+K',
          click: () => mainWindow?.webContents.send('shortcut-pressed', 'COPILOT')
        },
        { type: 'separator' },
        {
          label: 'Export BibTeX / RIS Citations',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => mainWindow?.webContents.send('shortcut-pressed', 'EXPORT')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'close' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function registerShortcuts() {
  try {
    globalShortcut.register('CommandOrControl+Shift+Space', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        mainWindow.webContents.send('shortcut-pressed', 'COPILOT_PALETTE');
      }
    });
  } catch (err) {
    console.error('Failed to register global shortcut:', err);
  }
}

// IPC Handlers
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.on('window-close', () => mainWindow?.close());
ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() || false);

// Native File Open Dialog for PDF Papers
ipcMain.handle('dialog-open-pdf', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Academic Research Paper (PDF)',
    filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
    properties: ['openFile']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
    const fileName = path.basename(filePath);
    const stats = fs.statSync(filePath);
    return {
      filePath,
      fileName,
      sizeBytes: stats.size
    };
  }
  return null;
});

// Native Save File Dialog (BibTeX, RIS, Markdown)
ipcMain.handle('dialog-save-file', async (event, { defaultName, content, fileType }) => {
  if (!mainWindow) return { success: false };
  const filters = [];
  if (fileType === 'bibtex') filters.push({ name: 'BibTeX File', extensions: ['bib'] });
  else if (fileType === 'ris') filters.push({ name: 'Research Information Systems', extensions: ['ris'] });
  else if (fileType === 'markdown') filters.push({ name: 'Markdown Document', extensions: ['md'] });
  else filters.push({ name: 'Text File', extensions: ['txt'] });

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Research Citations / Synthesis',
    defaultPath: defaultName || 'citations.bib',
    filters
  });

  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, content, 'utf-8');
    return { success: true, filePath: result.filePath };
  }
  return { success: false };
});

// Direct Export to Downloads Folder
ipcMain.handle('export-downloads', async (event, { fileName, data }) => {
  try {
    const downloadsDir = app.getPath('downloads');
    const targetPath = path.join(downloadsDir, fileName);
    fs.writeFileSync(targetPath, data, 'utf-8');
    return { success: true, targetPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Desktop Notifications
ipcMain.on('desktop-notification', (event, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({
      title: title || 'shoRDs Research OS',
      body: body || '',
      icon: path.join(__dirname, '..', 'assets', 'logo.png')
    }).show();
  }
});

// System Clipboard
ipcMain.on('clipboard-copy', (event, text) => {
  if (typeof text === 'string') {
    clipboard.writeText(text);
  }
});

// Boot sequence: 1) start servers -> 2) create Electron window
app.whenReady().then(async () => {
  await startBackendServer();
  await startStaticServer();
  createWindow();
});

app.on('window-all-closed', () => {
  if (staticServer) staticServer.close();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (staticServer) staticServer.close();
});
