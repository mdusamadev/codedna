/**
 * Detect VS Code snippet tab-stop placeholders in inserted text.
 * Used only for classification metadata — text is never stored.
 */

/** Matches $1, $0, ${1:Label}, ${2:name} */
const SNIPPET_PLACEHOLDER_PATTERN = /\$(?:\d+|\{\d+[^}]*\})/;

/**
 * Returns true when inserted text contains VS Code snippet tab-stop markers.
 */
export function detectSnippetPlaceholders(text: string): boolean {
  return SNIPPET_PLACEHOLDER_PATTERN.test(text);
}
