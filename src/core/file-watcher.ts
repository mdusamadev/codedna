import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { Settings } from '../config/settings';

/**
 * Watches for file changes that originate from outside the editor.
 * This is critical for detecting Claude Code writes, which modify files
 * directly on disk via the terminal.
 */
export class FileWatcher implements vscode.Disposable {
  private readonly logger = Logger.getInstance();
  private readonly settings: Settings;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly onExternalChangeEmitter = new vscode.EventEmitter<string>();

  /** Fires with the file path when an external change is detected */
  readonly onExternalChange = this.onExternalChangeEmitter.event;

  constructor(settings: Settings) {
    this.settings = settings;
    this.registerWatcher();
  }

  dispose(): void {
    this.onExternalChangeEmitter.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private registerWatcher(): void {
    // Watch all files in the workspace
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');

    watcher.onDidChange((uri) => {
      this.handleChange(uri);
    });

    watcher.onDidCreate((uri) => {
      this.handleChange(uri);
    });

    this.disposables.push(watcher);
    this.logger.info('File watcher registered');
  }

  private handleChange(uri: vscode.Uri): void {
    if (!this.settings.enabled) return;

    const relativePath = vscode.workspace.asRelativePath(uri, false);
    this.onExternalChangeEmitter.fire(relativePath);
  }
}
