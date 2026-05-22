/**
 * Pure text-analysis utilities for classifying edit content.
 * No VS Code API, no source-code storage — only boolean/numeric metadata.
 *
 * Used by EventListener to compute two metadata fields per edit:
 *
 *  nonEmptyLineOffsets  — line offsets (0 = lineStart) that have at least one
 *                         non-whitespace character.  Empty / whitespace-only lines
 *                         are intentionally excluded so the classifier will not mark
 *                         them as ai_generated and cause false ai_modified labels.
 *
 *  meaningfulCharsAdded — count of non-whitespace characters on lines that are not
 *                         comment-only or bracket-only.  Used by the status bar
 *                         and dashboard to reflect actual code contribution rather
 *                         than formatting noise (blank lines, closing braces, etc.).
 */

export interface TextMetrics {
  /** 0-based offsets relative to lineStart for lines with non-whitespace content. */
  readonly nonEmptyLineOffsets: readonly number[];
  /**
   * Non-whitespace characters on lines that have real code.
   * Excludes: whitespace-only lines, comment-only lines, bracket-only lines.
   */
  readonly meaningfulCharsAdded: number;
}

/** Languages that use # as a line-comment prefix. */
const HASH_COMMENT_LANGS = new Set([
  'python', 'ruby', 'shellscript', 'shell', 'bash', 'zsh',
  'yaml', 'toml', 'ini', 'r', 'perl', 'powershell',
]);

/**
 * Returns true when a trimmed line is purely a comment token.
 * We check against line-comment prefixes only — block-comment bodies (`*`)
 * are intentionally included so they don't inflate ratios.
 */
function isCommentLine(trimmed: string, language: string): boolean {
  if (trimmed.startsWith('//')) return true;
  // Block-comment opener/closer and continuation lines
  if (trimmed.startsWith('/*') || trimmed.startsWith('*')) return true;
  if (HASH_COMMENT_LANGS.has(language) && trimmed.startsWith('#')) return true;
  return false;
}

/**
 * Returns true when a trimmed line contains only structural bracket characters.
 * e.g. "}", "{ }", "})", "};", "});"
 * We also allow a single semicolon to catch "};".
 */
function isBracketOnlyLine(trimmed: string): boolean {
  return /^[{}()[\];,]+$/.test(trimmed);
}

/**
 * Analyse the raw inserted text of a single content change and return:
 *  - which line offsets have non-whitespace content (for provenance tracking)
 *  - how many "meaningful" characters were added (for ratio calculations)
 *
 * For single-character inserts (most keystrokes) the function short-circuits
 * so the common path stays cheap.
 */
export function analyzeInsertedText(text: string, language: string): TextMetrics {
  if (!text) {
    return { nonEmptyLineOffsets: [], meaningfulCharsAdded: 0 };
  }

  const lines = text.split('\n');

  // Fast path: single line (the overwhelming majority of keystrokes).
  if (lines.length === 1) {
    const line = lines[0]!;
    const trimmed = line.trim();
    if (!trimmed) {
      return { nonEmptyLineOffsets: [], meaningfulCharsAdded: 0 };
    }
    // For single-char / single-line edits don't apply comment/bracket filtering
    // because the caller has no surrounding context.
    return {
      nonEmptyLineOffsets: [0],
      meaningfulCharsAdded: line.replace(/\s/g, '').length,
    };
  }

  // Multi-line path: analyse each line independently.
  const nonEmptyLineOffsets: number[] = [];
  let meaningfulCharsAdded = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (!trimmed) {
      // Blank / whitespace-only — no provenance, no meaningful chars.
      continue;
    }

    // The line has content → track it for provenance purposes.
    nonEmptyLineOffsets.push(i);

    // But don't count it toward the meaningful-code ratio if it is
    // a pure comment or a structural bracket line.
    if (isCommentLine(trimmed, language) || isBracketOnlyLine(trimmed)) {
      continue;
    }

    meaningfulCharsAdded += line.replace(/\s/g, '').length;
  }

  return { nonEmptyLineOffsets, meaningfulCharsAdded };
}
