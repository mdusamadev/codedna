import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { Settings } from '../config/settings';
import { TRACKABLE_SCHEMES } from '../utils/constants';
import { resolveTrackablePath, isExcludedPath } from '../utils/paths';
import type { RawEditEvent } from '../utils/types';
import { normalizeLineSpan } from '../utils/edit-span';

/**
 * Captures all text document changes and keyboard activity in the editor.
 * Emits RawEditEvents for the classifier to process.
 */
export class EventListener implements vscode.Disposable {
  private readonly logger = Logger.getInstance();
  private readonly settings: Settings;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly onEditEmitter = new vscode.EventEmitter<RawEditEvent>();
  private readonly keystrokeTimestamps: number[] = [];
  private readonly maxKeystrokeBuffer = 50;

  /** Fires when a trackable edit occurs */
  readonly onEdit = this.onEditEmitter.event;

  constructor(settings: Settings) {
    this.settings = settings;
    this.registerListeners();
  }

  /** Get the timestamp of the most recent keystroke */
  getLastKeystrokeTimestamp(): number {
    return this.keystrokeTimestamps[this.keystrokeTimestamps.length - 1] ?? 0;
  }

  dispose(): void {
    this.onEditEmitter.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private registerListeners(): void {
    // ── Printable character input ─────────────────────────────────────────────
    const typeCommand = vscode.commands.registerCommand('type', (args: { text: string }) => {
      this.recordKeystroke();
      return vscode.commands.executeCommand('default:type', args);
    });
    this.disposables.push(typeCommand);

    // ── Non-type user interactions that should reset the keystroke window ──────
    //
    // Without these, the following common patterns mis-classify edits as AI:
    //
    //  • Format-on-save (Cmd+S): Cmd+S doesn't go through 'type', so the formatter
    //    output arrives > 800ms after the last typed char → AI false-positive.
    //    Recording a keystroke at willSave ensures the formatter batch is correlated.
    //
    //  • Autocomplete acceptance (Tab / Enter): accepting a suggestion inserts
    //    code without the 'type' command firing.  Selection-change events capture
    //    the Tab/Enter in a way that is safe to attribute to the user.
    //
    //  • Backspace / Delete: cursor-navigation keystrokes that the 'type' command
    //    never sees, but they clearly signal the user is actively editing.
    //
    //  TextEditorSelectionChangeKind.Keyboard = 1  (arrow keys, Tab, Enter, BS…)
    //  TextEditorSelectionChangeKind.Mouse    = 2  (click / drag)
    //  TextEditorSelectionChangeKind.Command  = 3  (programmatic — language server,
    //                                              AI agent, macros: skip these)
    const selectionListener = vscode.window.onDidChangeTextEditorSelection((event) => {
      const isUserDriven =
        event.kind === vscode.TextEditorSelectionChangeKind.Keyboard ||
        event.kind === vscode.TextEditorSelectionChangeKind.Mouse;
      if (isUserDriven && TRACKABLE_SCHEMES.has(event.textEditor.document.uri.scheme)) {
        this.recordKeystroke();
      }
    });
    this.disposables.push(selectionListener);

    // Capture the moment the user triggers a save (before format-on-save fires).
    const willSaveListener = vscode.workspace.onWillSaveTextDocument((event) => {
      if (TRACKABLE_SCHEMES.has(event.document.uri.scheme)) {
        this.recordKeystroke();
      }
    });
    this.disposables.push(willSaveListener);

    // ── Document change events ────────────────────────────────────────────────
    const docChangeListener = vscode.workspace.onDidChangeTextDocument((event) => {
      this.handleDocumentChange(event);
    });
    this.disposables.push(docChangeListener);

    this.logger.info('Event listener registered (type + selection + willSave)');
  }

  private recordKeystroke(): void {
    // Date.now() matches the event timestamp base used in handleDocumentChange
    this.keystrokeTimestamps.push(Date.now());
    if (this.keystrokeTimestamps.length > this.maxKeystrokeBuffer) {
      this.keystrokeTimestamps.shift();
    }
  }

  private handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    // Skip non-trackable schemes
    if (!TRACKABLE_SCHEMES.has(event.document.uri.scheme)) {
      return;
    }

    // Skip if extension is disabled
    if (!this.settings.enabled) {
      return;
    }

    const filePath = resolveTrackablePath(event.document.uri);
    if (!filePath || isExcludedPath(filePath, this.settings.excludePaths)) {
      return;
    }

    // Process each content change
    for (const change of event.contentChanges) {
      const linesAdded = change.text.split('\n').length - 1;
      const lineStart = change.range.start.line;
      const lineEnd = normalizeLineSpan({
        lineStart,
        lineEnd: change.range.end.line,
        linesAdded,
      }).lineEnd;
      const rawEvent: RawEditEvent = {
        timestamp: Date.now(), // epoch ms — consistent with DB queries and keystroke tracking
        filePath,
        lineStart,
        lineEnd,
        charsAdded: change.text.length,
        charsRemoved: change.rangeLength,
        linesAdded,
        language: event.document.languageId,
        isFromDisk: false, // Will be set by file-watcher for external changes
      };

      this.onEditEmitter.fire(rawEvent);
    }
  }

}
