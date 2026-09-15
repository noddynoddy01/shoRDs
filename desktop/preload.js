/**
 * shoRDs Desktop Application — Preload IPC Bridge
 * Exposes secure native desktop utilities (file system, window controls, dialogs, clipboard)
 * to the React Native Web & Desktop interface.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shoRDsDesktop', {
  isDesktop: true,
  platform: process.platform,

  // Window Controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  // Native File Dialogs & PDF Ingestion
  openPdfDialog: () => ipcRenderer.invoke('dialog-open-pdf'),
  saveFileDialog: (defaultName, content, fileType) => ipcRenderer.invoke('dialog-save-file', { defaultName, content, fileType }),

  // Desktop File Export (BibTeX, RIS, Markdown, PDF)
  exportToDownloads: (fileName, data) => ipcRenderer.invoke('export-downloads', { fileName, data }),

  // Desktop Notifications
  showNotification: (title, body) => ipcRenderer.send('desktop-notification', { title, body }),

  // System Clipboard
  copyToClipboard: (text) => ipcRenderer.send('clipboard-copy', text),

  // Global Shortcut Events Listener
  onShortcut: (callback) => {
    const handler = (event, shortcut) => callback(shortcut);
    ipcRenderer.on('shortcut-pressed', handler);
    return () => ipcRenderer.removeListener('shortcut-pressed', handler);
  }
});
