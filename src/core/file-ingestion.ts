import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { resolveTrackablePath, isExcludedPath } from '../utils/paths';
import type { RawEditEvent } from '../utils/types';

/** Build one edit event representing an entire file body (e.g. AI created the file on disk). */
export function buildWholeFileEditEvent(
  filePath: string,
  text: string,
  language: string,
  isFromDisk: boolean,
): RawEditEvent | null {
  if (text.length === 0) {
    return null;
  }

  const lineCount = text.split('\n').length;
  const linesAdded = Math.max(0, lineCount - 1);

  return {
    timestamp: Date.now(),
    filePath,
    lineStart: 0,
    lineEnd: Math.max(0, lineCount - 1),
    charsAdded: text.length,
    charsRemoved: 0,
    linesAdded,
    language,
    isFromDisk,
  };
}

/**
 * Ingests files that appeared on disk or opened with content but never fired
 * onDidChangeTextDocument (common when AI creates a new file).
 */
export class FileIngestion implements vscode.Disposable {
  private readonly logger = Logger.getInstance();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly pendingIngest = new Set<string>();

  constructor(
    private readonly onIngest: (event: RawEditEvent) => void,
    private readonly hasExistingEvents: (filePath: string) => boolean,
    private readonly extraExcludePatterns: readonly string[] = [],
  ) {
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        void this.tryIngestDocument(doc.uri, false);
      }),
    );
  }

  /** Called when the file watcher sees a create/change on disk. */
  handleExternalPath(relativePath: string): void {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;

    const uri = vscode.Uri.joinPath(folder.uri, relativePath);
    void this.tryIngestDocument(uri, true);
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.pendingIngest.clear();
  }

  private async tryIngestDocument(uri: vscode.Uri, fromDisk: boolean): Promise<void> {
    const filePath = resolveTrackablePath(uri);
    if (!filePath || isExcludedPath(filePath, this.extraExcludePatterns)) {
      return;
    }

    if (this.hasExistingEvents(filePath) || this.pendingIngest.has(filePath)) {
      return;
    }

    this.pendingIngest.add(filePath);
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const text = doc.getText();
      const raw = buildWholeFileEditEvent(filePath, text, doc.languageId, fromDisk);
      if (raw) {
        this.onIngest(raw);
        this.logger.debug(`Ingested ${fromDisk ? 'disk' : 'open'} file: ${filePath}`);
      }
    } catch (err) {
      this.logger.warn(`Failed to ingest file: ${filePath}`, err);
    } finally {
      this.pendingIngest.delete(filePath);
    }
  }
}
