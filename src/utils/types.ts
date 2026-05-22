/**
 * Core type definitions for CodeDNA.
 * No source code is ever stored — only metadata about edits.
 */

/** Classification categories for code edits */
export type Classification = 'human' | 'ai_generated' | 'ai_modified' | 'ambiguous';

/** Known AI tool identifiers */
export type SourceHint = 'claude' | 'cursor' | 'copilot' | 'aider' | 'unknown';

/** Raw edit event before classification */
export interface RawEditEvent {
  readonly timestamp: number;
  readonly filePath: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly charsAdded: number;
  readonly charsRemoved: number;
  readonly linesAdded: number;
  readonly language: string;
  readonly isFromDisk: boolean;
  /**
   * 0-based offsets (relative to lineStart) of lines that have non-whitespace
   * content in the inserted text.  Empty / whitespace-only lines are absent so
   * the classifier will leave them untracked rather than marking them ai_generated.
   *
   * If omitted (legacy / test events), all lines in the range are assumed to
   * have content — preserving backward compatibility.
   */
  readonly nonEmptyLineOffsets?: readonly number[];
  /**
   * Characters added that contribute to "real code" — excludes lines that are
   * whitespace-only, comment-only, or bracket-only.  Used for the status bar
   * and dashboard ratio instead of the raw charsAdded count.
   *
   * If omitted, falls back to charsAdded for backward compatibility.
   */
  readonly meaningfulCharsAdded?: number;
}

/** Classified edit event ready for storage */
export interface ClassifiedEditEvent extends RawEditEvent {
  readonly sessionId: string;
  readonly classification: Classification;
  readonly confidence: number;
  readonly sourceHint: SourceHint;
}

/** Line-level provenance data */
export interface LineProvenance {
  readonly filePath: string;
  readonly lineNumber: number;
  readonly classification: Classification;
  readonly confidence: number;
  readonly lastUpdated: number;
}

/** Today view summary */
export interface TodaySummary {
  readonly sessionDuration: number;
  readonly activeMinutes: number;
  readonly totalLines: number;
  readonly humanLines: number;
  readonly aiLines: number;
  readonly aiModifiedLines: number;
  readonly ambiguousLines: number;
  /** Character totals (match status bar ratio math). */
  readonly totalChars: number;
  readonly humanChars: number;
  readonly aiChars: number;
  readonly ambiguousChars: number;
  readonly humanPercent: number;
  readonly aiPercent: number;
  readonly ambiguousPercent: number;
  readonly aiReviewRate: number;
  readonly mostProductiveHour: number | null;
  readonly fileBreakdown: readonly FileBreakdownEntry[];
}

/** Per-file breakdown in the today view */
export interface FileBreakdownEntry {
  readonly filePath: string;
  readonly humanPercent: number;
  readonly aiPercent: number;
  /** Distinct lines edited today. */
  readonly totalLines: number;
  readonly humanChars: number;
  readonly aiChars: number;
  readonly totalChars: number;
}

/** Trend data point */
export interface TrendEntry {
  readonly date: string;
  /** Distinct edit events that day. */
  readonly humanLines: number;
  readonly aiLines: number;
  readonly aiModifiedLines: number;
  readonly ambiguousLines: number;
  readonly humanChars: number;
  readonly aiChars: number;
  readonly ambiguousChars: number;
  readonly aiReviewRate: number;
  readonly totalChars: number;
  readonly activeMinutes: number;
}

/** Language breakdown entry */
export interface LanguageBreakdown {
  readonly language: string;
  readonly humanLines: number;
  readonly aiLines: number;
  readonly aiPercent: number;
}

/** Week comparison data */
export interface WeekComparison {
  readonly thisWeek: { readonly humanPercent: number; readonly aiPercent: number };
  readonly lastWeek: { readonly humanPercent: number; readonly aiPercent: number };
  readonly deltaAiPercent: number;
}

/** Daily summary stored in DB */
export interface DailySummary {
  readonly date: string;
  readonly filePath: string | null;
  readonly humanLines: number;
  readonly aiLines: number;
  readonly aiModifiedLines: number;
  readonly ambiguousLines: number;
  readonly totalChars: number;
  readonly activeMinutes: number;
}

/** Session metadata */
export interface Session {
  readonly id: string;
  readonly startedAt: number;
  readonly workspaceRoot: string;
}

/** Diagnostic info for troubleshooting */
export interface DiagnosticInfo {
  readonly extensionVersion: string;
  readonly databaseSizeMB: number;
  readonly totalEvents: number;
  readonly sessionDuration: number;
  readonly nativeModuleLoaded: boolean;
  readonly detectedAITools: readonly string[];
  readonly lastError: string | null;
}

/** Messages from extension host to webview */
export type HostToWebviewMessage =
  | { readonly type: 'update-today'; readonly data: TodaySummary }
  | { readonly type: 'update-trends'; readonly data: readonly TrendEntry[] }
  | { readonly type: 'update-file'; readonly data: readonly LineProvenance[] }
  | { readonly type: 'update-files-list'; readonly data: readonly FileBreakdownEntry[] }
  | { readonly type: 'error'; readonly message: string };

/** Messages from webview to extension host */
export type WebviewToHostMessage =
  | { readonly type: 'request-today' }
  | { readonly type: 'request-trends'; readonly range: '7d' | '30d' | '90d' }
  | { readonly type: 'request-file'; readonly filePath: string }
  | { readonly type: 'request-files-list' }
  | { readonly type: 'open-file'; readonly filePath: string };
