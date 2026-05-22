/** Today view summary */
export interface TodaySummary {
  sessionDuration: number;
  activeMinutes: number;
  totalLines: number;
  humanLines: number;
  aiLines: number;
  aiModifiedLines: number;
  ambiguousLines: number;
  totalChars: number;
  humanChars: number;
  aiChars: number;
  ambiguousChars: number;
  humanPercent: number;
  aiPercent: number;
  ambiguousPercent: number;
  aiReviewRate: number;
  mostProductiveHour: number | null;
  fileBreakdown: FileBreakdownEntry[];
}

/** Per-file breakdown entry */
export interface FileBreakdownEntry {
  filePath: string;
  humanPercent: number;
  aiPercent: number;
  totalLines: number;
  humanChars: number;
  aiChars: number;
  totalChars: number;
}

/** Trend data point */
export interface TrendEntry {
  date: string;
  humanLines: number;
  aiLines: number;
  aiModifiedLines: number;
  ambiguousLines: number;
  humanChars: number;
  aiChars: number;
  ambiguousChars: number;
  aiReviewRate: number;
  totalChars: number;
  activeMinutes: number;
}

/** Line-level provenance */
export interface LineProvenance {
  filePath: string;
  lineNumber: number;
  classification: 'human' | 'ai_generated' | 'ai_modified' | 'ambiguous';
  confidence: number;
  lastUpdated: number;
}

/** Messages from extension host to webview */
export type HostToWebviewMessage =
  | { type: 'update-today'; data: TodaySummary }
  | { type: 'update-trends'; data: TrendEntry[] }
  | { type: 'update-file'; data: LineProvenance[] }
  | { type: 'update-files-list'; data: FileBreakdownEntry[] }
  | { type: 'error'; message: string };

/** Messages from webview to extension host */
export type WebviewToHostMessage =
  | { type: 'request-today' }
  | { type: 'request-trends'; range: '7d' | '30d' | '90d' }
  | { type: 'request-file'; filePath: string }
  | { type: 'request-files-list' }
  | { type: 'open-file'; filePath: string };
