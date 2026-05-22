import * as path from 'path';
import * as vscode from 'vscode';
import { TRACKABLE_SCHEMES, DEFAULT_EXCLUDES } from './constants';

/** Resolve a stable path key for DB + gutter (workspace-relative when possible). */
export function resolveTrackablePath(uri: vscode.Uri): string | null {
  if (!TRACKABLE_SCHEMES.has(uri.scheme)) {
    return null;
  }

  if (uri.scheme === 'untitled') {
    return uri.toString();
  }

  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (folder) {
    return path.relative(folder.uri.fsPath, uri.fsPath);
  }

  const relative = vscode.workspace.asRelativePath(uri, false);
  if (relative && !relative.startsWith('..')) {
    return relative;
  }

  return uri.fsPath || null;
}

export function isExcludedPath(filePath: string, extraPatterns: readonly string[] = []): boolean {
  const patterns = [...DEFAULT_EXCLUDES, ...extraPatterns];
  for (const pattern of patterns) {
    const regexStr = pattern
      .replace(/\*\*\//g, '<<LEAD>>')
      .replace(/\/\*\*/g, '<<TRAIL>>')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/<<LEAD>>/g, '(?:.+/)?')
      .replace(/<<TRAIL>>/g, '(?:/.+)?');
    const regex = new RegExp(`^${regexStr}$`);
    if (regex.test(filePath)) {
      return true;
    }
  }
  return false;
}
