/**
 * shoRDs Desktop Integration Service
 * Provides bidirectional communication between React Native Web UI and native Electron desktop features.
 */

declare global {
  interface Window {
    shoRDsDesktop?: {
      isDesktop: boolean;
      platform: string;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      isMaximized: () => Promise<boolean>;
      openPdfDialog: () => Promise<{ filePath: string; fileName: string; sizeBytes: number } | null>;
      saveFileDialog: (defaultName: string, content: string, fileType: string) => Promise<{ success: boolean; filePath?: string }>;
      exportToDownloads: (fileName: string, data: string) => Promise<{ success: boolean; targetPath?: string; error?: string }>;
      showNotification: (title: string, body: string) => void;
      copyToClipboard: (text: string) => void;
      onShortcut: (callback: (shortcut: string) => void) => () => void;
    };
  }
}

export class DesktopService {
  static isDesktopApp(): boolean {
    return typeof window !== 'undefined' && Boolean(window.shoRDsDesktop?.isDesktop);
  }

  static getPlatform(): string {
    return typeof window !== 'undefined' && window.shoRDsDesktop?.platform ? window.shoRDsDesktop.platform : 'web';
  }

  static async openLocalPdf(): Promise<{ filePath: string; fileName: string; sizeBytes: number } | null> {
    if (DesktopService.isDesktopApp()) {
      return window.shoRDsDesktop!.openPdfDialog();
    }
    return null;
  }

  static async exportCitationFile(defaultName: string, content: string, format: 'bibtex' | 'ris' | 'markdown'): Promise<boolean> {
    if (DesktopService.isDesktopApp()) {
      const res = await window.shoRDsDesktop!.saveFileDialog(defaultName, content, format);
      return res.success;
    } else {
      // Browser Web fallback: Blob download
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = defaultName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        return true;
      }
      return false;
    }
  }

  static async exportToDownloads(fileName: string, data: string): Promise<boolean> {
    if (DesktopService.isDesktopApp()) {
      const res = await window.shoRDsDesktop!.exportToDownloads(fileName, data);
      return res.success;
    }
    return false;
  }

  static notify(title: string, body: string): void {
    if (DesktopService.isDesktopApp()) {
      window.shoRDsDesktop!.showNotification(title, body);
    } else if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  }

  static registerShortcutListener(onShortcut: (shortcut: string) => void): () => void {
    if (DesktopService.isDesktopApp() && window.shoRDsDesktop?.onShortcut) {
      return window.shoRDsDesktop.onShortcut(onShortcut);
    }
    return () => {};
  }
}
