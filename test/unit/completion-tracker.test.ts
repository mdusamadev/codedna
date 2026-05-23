import { describe, it, expect, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { CompletionTracker } from '../../src/core/completion-tracker';

type CommandListener = (event: { command: string }) => void;

describe('CompletionTracker', () => {
  let tracker: CompletionTracker;
  let commandListener: CommandListener | undefined;

  beforeEach(() => {
    commandListener = undefined;
    (vscode.commands as { onDidExecuteCommand?: unknown }).onDidExecuteCommand = (
      listener: CommandListener,
    ) => {
      commandListener = listener;
      return { dispose: () => {} };
    };
    tracker = new CompletionTracker();
  });

  function fireCommand(command: string): void {
    commandListener?.({ command });
  }

  it('maps acceptSelectedSuggestion to snippet', () => {
    fireCommand('acceptSelectedSuggestion');
    expect(tracker.getLastCompletionEvent().source).toBe('snippet');
    expect(tracker.getLastCompletionEvent().command).toBe('acceptSelectedSuggestion');
  });

  it('maps editor.action.insertSnippet to snippet', () => {
    fireCommand('editor.action.insertSnippet');
    expect(tracker.getLastCompletionEvent().source).toBe('snippet');
  });

  it('maps editor.emmet.action.expandAbbreviation to snippet', () => {
    fireCommand('editor.emmet.action.expandAbbreviation');
    expect(tracker.getLastCompletionEvent().source).toBe('snippet');
  });

  it('maps editor.action.inlineSuggest.commit to ai_inline', () => {
    fireCommand('editor.action.inlineSuggest.commit');
    expect(tracker.getLastCompletionEvent().source).toBe('ai_inline');
  });

  it('maps editor.action.clipboardPasteAction to paste', () => {
    fireCommand('editor.action.clipboardPasteAction');
    expect(tracker.getLastCompletionEvent().source).toBe('paste');
  });

  it('ignores unrelated commands', () => {
    fireCommand('acceptSelectedSuggestion');
    const ts = tracker.getLastCompletionEvent().timestamp;
    fireCommand('workbench.action.files.save');
    expect(tracker.getLastCompletionEvent().source).toBe('snippet');
    expect(tracker.getLastCompletionEvent().timestamp).toBe(ts);
  });

  it('maps editor.action.acceptSelectedSuggestion to snippet', () => {
    fireCommand('editor.action.acceptSelectedSuggestion');
    expect(tracker.getLastCompletionEvent().source).toBe('snippet');
  });

  it('invokes onUserAccept when a snippet command fires', () => {
    let acceptCount = 0;
    let listener: CommandListener | undefined;
    (vscode.commands as { onDidExecuteCommand?: unknown }).onDidExecuteCommand = (
      cb: CommandListener,
    ) => {
      listener = cb;
      return { dispose: () => {} };
    };
    const t = new CompletionTracker({ onUserAccept: () => acceptCount++ });
    listener?.({ command: 'acceptSelectedSuggestion' });
    expect(acceptCount).toBe(1);
    listener?.({ command: 'editor.action.inlineSuggest.commit' });
    expect(acceptCount).toBe(1);
    t.dispose();
  });
});
