import { DEFAULTS } from './constants';
import type { RawEditEvent } from './types';

/**
 * True when an edit looks like accepting an IDE snippet / IntelliSense item
 * (prefix replacement, tab stops, or large structured insert replacing a short prefix).
 */
export function looksLikeIdeCompletion(
  event: RawEditEvent,
  batchThreshold: number,
): boolean {
  const largeInsert = event.linesAdded >= batchThreshold || event.charsAdded > 20;
  if (!largeInsert) {
    return false;
  }
  if (event.hasSnippetPlaceholders) {
    return true;
  }
  if (
    event.charsRemoved > 0 &&
    event.charsRemoved <= DEFAULTS.MAX_PREFIX_REPLACEMENT_CHARS
  ) {
    return true;
  }
  return false;
}
