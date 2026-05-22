/**
 * Minimal VS Code API mock for unit testing.
 * Import this in vitest.config.ts as an alias for 'vscode'.
 */

export const window = {
  createStatusBarItem: () => ({
    show: () => {},
    hide: () => {},
    dispose: () => {},
    text: '',
    tooltip: '',
    command: '',
    name: '',
  }),
  createOutputChannel: () => ({
    appendLine: () => {},
    show: () => {},
    dispose: () => {},
  }),
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  createWebviewPanel: () => ({
    webview: { html: '' },
    reveal: () => {},
    dispose: () => {},
    onDidDispose: () => ({ dispose: () => {} }),
  }),
  terminals: [],
  onDidOpenTerminal: () => ({ dispose: () => {} }),
  onDidChangeTextEditorSelection: () => ({ dispose: () => {} }),
  /** Returns a mock TextEditorDecorationType */
  createTextEditorDecorationType: (_options: unknown) => ({
    key: 'mock-decoration',
    dispose: () => {},
  }),
  /** Mutable list of visible text editors (override in tests as needed) */
  visibleTextEditors: [] as Array<{
    document: { fileName: string };
    setDecorations: (...args: unknown[]) => void;
  }>,
};

export const workspace = {
  getConfiguration: () => ({
    get: (_key: string, defaultValue: unknown) => defaultValue,
  }),
  onDidChangeConfiguration: () => ({ dispose: () => {} }),
  onDidChangeTextDocument: () => ({ dispose: () => {} }),
  onWillSaveTextDocument: () => ({ dispose: () => {} }),
  workspaceFolders: [{ uri: { fsPath: '/mock/workspace' } }],
  createFileSystemWatcher: () => ({
    onDidChange: () => ({ dispose: () => {} }),
    onDidCreate: () => ({ dispose: () => {} }),
    onDidDelete: () => ({ dispose: () => {} }),
    dispose: () => {},
  }),
  asRelativePath: (uri: { fsPath: string }) =>
    uri.fsPath.replace('/mock/workspace/', ''),
  getWorkspaceFolder: () => ({ uri: { fsPath: '/mock/workspace' } }),
};

export const commands = {
  registerCommand: (_cmd: string, _cb: (...args: unknown[]) => unknown) => ({
    dispose: () => {},
  }),
  executeCommand: async () => undefined,
};

export const EventEmitter = class {
  private listeners: Array<(...args: unknown[]) => void> = [];
  event = (listener: (...args: unknown[]) => void) => {
    this.listeners.push(listener);
    return { dispose: () => {} };
  };
  fire(data: unknown) {
    for (const l of this.listeners) l(data);
  }
  dispose() {
    this.listeners = [];
  }
};

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export enum ViewColumn {
  One = 1,
}

export enum TextEditorSelectionChangeKind {
  Keyboard = 1,
  Mouse = 2,
  Command = 3,
}

export const Uri = {
  file: (path: string) => ({ fsPath: path, scheme: 'file', toString: () => path }),
};

/** Minimal Range implementation for unit tests */
export class Range {
  constructor(
    public readonly startLine: number,
    public readonly startCharacter: number,
    public readonly endLine: number,
    public readonly endCharacter: number,
  ) {}
}
