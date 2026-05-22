import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { Database } from '../storage/database';
import { WriteBuffer } from '../storage/write-buffer';
import type { WebviewToHostMessage } from '../utils/types';

function generateNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

/**
 * Manages the CodeDNA dashboard webview panel.
 *
 * HTML loading strategy:
 *   Read the Vite-built dist/webview/index.html directly, then:
 *   1. Replace leading-slash asset paths (src="/main.js", href="/index.css") with
 *      proper vscode-resource URIs via webview.asWebviewUri().
 *   2. Inject a nonce onto every <script> element.
 *   3. Prepend a Content-Security-Policy <meta> into <head>.
 *
 * This keeps the webview HTML in sync with whatever Vite outputs and avoids the
 * blank-page bug caused by loading an ES-module script without type="module".
 */
export class WebviewProvider implements vscode.Disposable {
  private readonly logger = Logger.getInstance();
  private panel: vscode.WebviewPanel | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private readonly db: Database;
  private readonly writeBuffer: WriteBuffer;

  constructor(db: Database, writeBuffer: WriteBuffer) {
    this.db = db;
    this.writeBuffer = writeBuffer;
  }

  openDashboard(extensionUri: vscode.Uri): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    const distPath = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');

    this.panel = vscode.window.createWebviewPanel(
      'codednaDashboard',
      'CodeDNA Dashboard',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [distPath],
      },
    );

    this.panel.webview.html = this.getWebviewContent(this.panel.webview, extensionUri);

    // Handle requests from the React app.
    // The React app sends { type: 'request-today' } on mount — do NOT call
    // sendTodayData() here because the webview process hasn't loaded yet.
    this.panel.webview.onDidReceiveMessage((msg: WebviewToHostMessage) => {
      this.handleWebviewMessage(msg);
    });

    this.panel.onDidDispose(() => {
      this.stopRefreshTimer();
      this.panel = null;
    });

    // Push fresh Today data every 3 s while the panel is visible
    this.startRefreshTimer();

    this.logger.info('Dashboard opened');
  }

  dispose(): void {
    this.stopRefreshTimer();
    this.panel?.dispose();
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private handleWebviewMessage(msg: WebviewToHostMessage): void {
    switch (msg.type) {
      case 'request-today':
        this.sendTodayData();
        break;

      case 'request-trends': {
        const rangeDays = msg.range === '7d' ? 7 : msg.range === '30d' ? 30 : 90;
        const end = new Date();
        const start = new Date(Date.now() - rangeDays * 86_400_000);
        const fmt = (d: Date): string => d.toISOString().slice(0, 10);
        this.writeBuffer.flush();
        const data = this.db.getTrends(fmt(start), fmt(end));
        void this.panel?.webview.postMessage({ type: 'update-trends', data });
        break;
      }

      case 'request-files-list':
        this.writeBuffer.flush();
        void this.panel?.webview.postMessage({
          type: 'update-files-list',
          data: this.db.getTodaySummary().fileBreakdown,
        });
        break;

      case 'request-file': {
        const lines = this.db.getFileProvenance(msg.filePath);
        void this.panel?.webview.postMessage({ type: 'update-file', data: lines });
        break;
      }

      case 'open-file':
        void vscode.workspace
          .openTextDocument(vscode.Uri.file(msg.filePath))
          .then((doc) => vscode.window.showTextDocument(doc));
        break;

      default:
        this.logger.warn('WebviewProvider: unknown message type');
        break;
    }
  }

  /** Flush pending events then post today's summary to the webview. */
  private sendTodayData(): void {
    this.writeBuffer.flush();
    const data = this.db.getTodaySummary();
    void this.panel?.webview.postMessage({ type: 'update-today', data });
  }

  private startRefreshTimer(): void {
    this.refreshInterval = setInterval(() => {
      if (this.panel?.visible) {
        this.sendTodayData();
      }
    }, 3000);
  }

  private stopRefreshTimer(): void {
    if (this.refreshInterval !== null) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  /**
   * Build the webview HTML by reading Vite's built index.html and adapting it:
   *  - Asset paths (/main.js, /index.css) → vscode-resource URIs
   *  - <script> tags get a nonce
   *  - A CSP <meta> is prepended to <head>
   */
  private getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const distWebviewPath = path.join(extensionUri.fsPath, 'dist', 'webview');
    const indexHtmlPath = path.join(distWebviewPath, 'index.html');
    const distUri = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');

    if (!fs.existsSync(indexHtmlPath)) {
      return this.buildNotReadyHtml();
    }

    const nonce = generateNonce();
    let html = fs.readFileSync(indexHtmlPath, 'utf-8');

    // 1. Replace absolute-root asset paths with vscode-resource URIs.
    //    Matches: src="/foo.js"  href="/foo.css"  src='/bar.js'
    html = html.replace(
      /(src|href)=['"](\/?[^'"]+\.(js|css|woff2?|png|svg|ico))['"][^>]*/g,
      (match, _attr: string, assetPath: string) => {
        const relative = assetPath.replace(/^\//, '');
        const resourceUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, relative));
        // preserve the attribute name and surrounding quotes; swap only the value
        return match.replace(assetPath, resourceUri.toString());
      },
    );

    // 2. Add nonce to every <script> tag (both module and classic).
    //    Vite emits <script type="module" crossorigin src="..."> — the type="module"
    //    must be preserved; adding a nonce makes the script pass the CSP.
    html = html.replace(/<script\b/g, `<script nonce="${nonce}"`);

    // 3. Inject CSP before any other content in <head>.
    const csp = [
      `default-src 'none'`,
      `script-src 'nonce-${nonce}'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `img-src ${webview.cspSource} data:`,
      `font-src ${webview.cspSource}`,
    ].join('; ');
    html = html.replace(
      '<head>',
      `<head>\n  <meta http-equiv="Content-Security-Policy" content="${csp}"/>`,
    );

    return html;
  }

  /** Shown when dist/webview/index.html has not been built yet. */
  private buildNotReadyHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>CodeDNA</title>
  <style>
    body {
      font-family: var(--vscode-font-family, sans-serif);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      display: flex; align-items: center; justify-content: center;
      height: 100vh; margin: 0; text-align: center;
    }
    .msg { max-width: 380px; }
    h2 { margin-bottom: 0.5em; }
    code {
      display: inline-block; background: var(--vscode-textCodeBlock-background);
      padding: 2px 6px; border-radius: 3px;
    }
  </style>
</head>
<body>
  <div class="msg">
    <h2>🧬 CodeDNA Dashboard</h2>
    <p>The webview bundle hasn't been built yet.</p>
    <p>Run <code>npm run build:webview</code> then reload the window.</p>
  </div>
</body>
</html>`;
  }
}
