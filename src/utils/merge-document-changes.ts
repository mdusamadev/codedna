import type * as vscode from 'vscode';
import { normalizeLineSpan } from './edit-span';
import { analyzeInsertedText } from './text-analysis';
import { detectSnippetPlaceholders } from './snippet-detection';

export interface MergedDocumentChange {
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly charsAdded: number;
  readonly charsRemoved: number;
  readonly linesAdded: number;
  readonly nonEmptyLineOffsets: readonly number[];
  readonly meaningfulCharsAdded: number;
  readonly hasSnippetPlaceholders: boolean;
}

/**
 * LSP snippet/completion acceptance often applies multiple content changes in one
 * transaction (delete prefix, insert template). Merge before classification.
 */
export function mergeContentChanges(
  changes: readonly vscode.TextDocumentContentChangeEvent[],
  languageId: string,
): MergedDocumentChange | null {
  if (changes.length === 0) {
    return null;
  }

  if (changes.length === 1) {
    return mergeSingle(changes[0]!, languageId);
  }

  let charsAdded = 0;
  let charsRemoved = 0;
  let minLine = Number.POSITIVE_INFINITY;
  let maxLineEnd = 0;
  let maxLinesAdded = 0;
  let insertedText = '';

  for (const change of changes) {
    charsAdded += change.text.length;
    charsRemoved += change.rangeLength;
    minLine = Math.min(minLine, change.range.start.line);
    const linesAdded = change.text.split('\n').length - 1;
    maxLinesAdded = Math.max(maxLinesAdded, linesAdded);
    const { lineEnd } = normalizeLineSpan({
      lineStart: change.range.start.line,
      lineEnd: change.range.end.line,
      linesAdded,
    });
    maxLineEnd = Math.max(maxLineEnd, lineEnd);
    insertedText += change.text;
  }

  const lineStart = minLine === Number.POSITIVE_INFINITY ? 0 : minLine;
  const lineEnd = normalizeLineSpan({
    lineStart,
    lineEnd: maxLineEnd,
    linesAdded: maxLinesAdded,
  }).lineEnd;

  const { nonEmptyLineOffsets, meaningfulCharsAdded } = analyzeInsertedText(
    insertedText,
    languageId,
  );

  return {
    lineStart,
    lineEnd,
    charsAdded,
    charsRemoved,
    linesAdded: maxLinesAdded,
    nonEmptyLineOffsets,
    meaningfulCharsAdded,
    hasSnippetPlaceholders: detectSnippetPlaceholders(insertedText),
  };
}

function mergeSingle(
  change: vscode.TextDocumentContentChangeEvent,
  languageId: string,
): MergedDocumentChange {
  const linesAdded = change.text.split('\n').length - 1;
  const lineStart = change.range.start.line;
  const lineEnd = normalizeLineSpan({
    lineStart,
    lineEnd: change.range.end.line,
    linesAdded,
  }).lineEnd;
  const { nonEmptyLineOffsets, meaningfulCharsAdded } = analyzeInsertedText(
    change.text,
    languageId,
  );

  return {
    lineStart,
    lineEnd,
    charsAdded: change.text.length,
    charsRemoved: change.rangeLength,
    linesAdded,
    nonEmptyLineOffsets,
    meaningfulCharsAdded,
    hasSnippetPlaceholders: detectSnippetPlaceholders(change.text),
  };
}
