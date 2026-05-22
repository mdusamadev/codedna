/** Normalize the inclusive line span affected by an edit (multi-line inserts, replacements). */
export function normalizeLineSpan(event: {
  lineStart: number;
  lineEnd: number;
  linesAdded: number;
}): { lineStart: number; lineEnd: number } {
  const endFromNewlines = event.lineStart + event.linesAdded;
  return {
    lineStart: event.lineStart,
    lineEnd: Math.max(event.lineEnd, endFromNewlines),
  };
}

/** Inclusive number of lines touched by an edit. */
export function affectedLineCount(event: {
  lineStart: number;
  lineEnd: number;
  linesAdded: number;
}): number {
  const { lineStart, lineEnd } = normalizeLineSpan(event);
  return Math.max(1, lineEnd - lineStart + 1);
}
