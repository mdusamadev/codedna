import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { Settings } from '../config/settings';
import { TRACKABLE_SCHEMES } from '../utils/constants';
import { resolveTrackablePath, isExcludedPath } from '../utils/paths';
import type { RawEditEvent } from '../utils/types';
import { mergeContentChanges } from '../utils/merge-document-changes';

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

  /**
   * Record explicit user intent (e.g. accepting an IntelliSense item via Enter).
   * Used by CompletionTracker when onDidExecuteCommand fires for snippet accepts.
   */
  recordUserInteraction(): void {
    this.recordKeystroke();
  }

  dispose(): void {
    this.onEditEmitter.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private registerListeners(): void {
    // ── Printable character input ─────────────────────────────────────────────
    // The 'type' command may already be registered in Cursor or another extension.
    // Failure here must not prevent activation — selection-change and willSave
    // events below provide sufficient keystroke-timing signal as a fallback.
    try {
      const typeCommand = vscode.commands.registerCommand('type', (args: { text: string }) => {
        this.recordKeystroke();
        return vscode.commands.executeCommand('default:type', args);
      });
      this.disposables.push(typeCommand);
    } catch (err) {
      this.logger.warn(
        `'type' command already registered by host editor — keystroke tracking will rely on ` +
          `selection-change and willSave events instead. Error: ${err}`,
      );
    }

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

    this.logger.info('Event listener registered (selection + willSave; type command attempted separately)');
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

    const merged = mergeContentChanges(event.contentChanges, event.document.languageId);
    if (!merged) {
      return;
    }

    const rawEvent: RawEditEvent = {
      timestamp: Date.now(),
      filePath,
      lineStart: merged.lineStart,
      lineEnd: merged.lineEnd,
      charsAdded: merged.charsAdded,
      charsRemoved: merged.charsRemoved,
      linesAdded: merged.linesAdded,
      language: event.document.languageId,
      isFromDisk: false,
      nonEmptyLineOffsets: merged.nonEmptyLineOffsets,
      meaningfulCharsAdded: merged.meaningfulCharsAdded,
      hasSnippetPlaceholders: merged.hasSnippetPlaceholders,
    };

    this.onEditEmitter.fire(rawEvent);
  }

}
