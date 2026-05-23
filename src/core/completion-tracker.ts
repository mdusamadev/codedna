import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import type { CompletionEvent, CompletionSource } from '../utils/types';

/** Minimal shape of the object passed to onDidExecuteCommand callbacks. */
interface CommandExecutionEvent {
  readonly command: string;
  readonly arguments?: readonly unknown[];
}

/** IDE snippet, IntelliSense, Emmet, and quick-fix accept commands → human. */
const SNIPPET_COMMANDS = new Set<string>([
  'acceptSelectedSuggestion',
  'editor.action.acceptSelectedSuggestion',
  'acceptAlternativeSelectedSuggestion',
  'editor.action.acceptAlternativeSelectedSuggestion',
  'editor.action.insertSnippet',
  'editor.emmet.action.expandAbbreviation',
  'editor.action.acceptSelectedQuickFix',
]);

const AI_INLINE_COMMANDS = new Set<string>(['editor.action.inlineSuggest.commit']);

const PASTE_COMMANDS = new Set<string>(['editor.action.clipboardPasteAction']);

function sourceForCommand(command: string): CompletionSource | null {
  if (SNIPPET_COMMANDS.has(command)) {
    return 'snippet';
  }
  if (AI_INLINE_COMMANDS.has(command)) {
    return 'ai_inline';
  }
  if (PASTE_COMMANDS.has(command)) {
    return 'paste';
  }
  return null;
}

/**
 * Intercepts completion-acceptance commands to distinguish IDE snippets /
 * intellisense from AI inline (ghost-text) suggestions at the source level.
 *
 * Commands are monitored via onDidExecuteCommand when the API is available.
 * The last event is stored with its timestamp so the classifier can correlate
 * it against the TextDocumentChangeEvent that fires immediately after.
 */
export interface CompletionTrackerOptions {
  /** Called when the user accepts an IDE snippet/suggestion (refreshes keystroke window). */
  readonly onUserAccept?: () => void;
}

export class CompletionTracker implements vscode.Disposable {
  private readonly logger = Logger.getInstance();
  private readonly onUserAccept?: () => void;
  private lastEvent: CompletionEvent = { source: 'none', timestamp: 0 };
  private readonly disposables: vscode.Disposable[] = [];
  private loggedHeuristicFallback = false;

  constructor(options?: CompletionTrackerOptions) {
    this.onUserAccept = options?.onUserAccept;
    const onExecute = vscode.commands.onDidExecuteCommand as
      | vscode.Event<CommandExecutionEvent>
      | undefined;

    if (typeof onExecute === 'function') {
      const listener: vscode.Disposable = onExecute((event) => {
        const source = sourceForCommand(event.command);
        if (source !== null) {
          this.lastEvent = { source, timestamp: Date.now(), command: event.command };
          if (source === 'snippet') {
            this.onUserAccept?.();
          }
        }
      });
      this.disposables.push(listener);
    } else {
      this.logHeuristicFallbackOnce();
    }
  }

  /** Returns the most recently intercepted completion event. */
  getLastCompletionEvent(): CompletionEvent {
    return this.lastEvent;
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private logHeuristicFallbackOnce(): void {
    if (!this.loggedHeuristicFallback) {
      this.loggedHeuristicFallback = true;
      this.logger.info(
        'onDidExecuteCommand unavailable — IDE snippet detection uses keystroke/heuristic fallbacks only',
      );
    }
  }
}
