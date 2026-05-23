/** Extension-wide constants */

export const EXTENSION_ID = 'codedna';
export const EXTENSION_NAME = 'CodeDNA';
export const OUTPUT_CHANNEL_NAME = 'CodeDNA';

/** Commands */
export const COMMANDS = {
  OPEN_DASHBOARD: `${EXTENSION_ID}.openDashboard`,
  TOGGLE_GUTTER: `${EXTENSION_ID}.toggleGutter`,
  EXPORT_DATA: `${EXTENSION_ID}.exportData`,
  RESET_DATA: `${EXTENSION_ID}.resetData`,
  SHOW_DIAGNOSTICS: `${EXTENSION_ID}.showDiagnostics`,
  INSTALL_GIT_HOOK: `${EXTENSION_ID}.installGitHook`,
  UNINSTALL_GIT_HOOK: `${EXTENSION_ID}.uninstallGitHook`,
  SEND_FEEDBACK: `${EXTENSION_ID}.sendFeedback`,
} as const;

/** Settings keys */
export const SETTINGS = {
  ENABLED: `${EXTENSION_ID}.enabled`,
  STATUS_BAR_VISIBLE: `${EXTENSION_ID}.statusBar.visible`,
  STATUS_BAR_MODE: `${EXTENSION_ID}.statusBar.mode`,
  GUTTER_ENABLED: `${EXTENSION_ID}.gutter.enabled`,
  GIT_COMMIT_SUMMARY: `${EXTENSION_ID}.git.commitSummary`,
  RETENTION_DAYS: `${EXTENSION_ID}.retention.days`,
  KEYSTROKE_WINDOW_MS: `${EXTENSION_ID}.classification.keystrokeWindowMs`,
  COMPLETION_WINDOW_MS: `${EXTENSION_ID}.classification.completionWindowMs`,
  BATCH_THRESHOLD: `${EXTENSION_ID}.classification.batchThreshold`,
  EXCLUDE_PATHS: `${EXTENSION_ID}.excludePaths`,
  WEEKLY_SUMMARY: `${EXTENSION_ID}.weeklySummary`,
} as const;

/** Classification defaults */
export const DEFAULTS = {
  KEYSTROKE_WINDOW_MS: 200,
  BATCH_THRESHOLD: 3,
  RETENTION_DAYS: 90,
  WRITE_BUFFER_MAX_SIZE: 50,
  WRITE_BUFFER_FLUSH_INTERVAL_MS: 2000,
  STATUS_BAR_UPDATE_INTERVAL_MS: 3000,
  PROCESS_CHECK_INTERVAL_MS: 2000,
  LINE_MAP_TTL_MS: 5 * 60 * 1000, // 5 minutes
  LINE_MAP_MAX_FILES: 50,
  /** Batch inserts within this window after a keystroke are likely auto-format, not AI. */
  FORMAT_DETECTION_WINDOW_MS: 800,
  /** Max age (ms) of a completion event to still influence classification. */
  COMPLETION_WINDOW_MS: 300,
  /**
   * Max chars removed when treating a batch insert as IDE prefix completion
   * (e.g. "stf" → StatefulWidget) without a recent keystroke on Enter accept.
   */
  MAX_PREFIX_REPLACEMENT_CHARS: 40,
  /**
   * After typing a prefix (e.g. "stf"), user may pause before Enter on the suggest widget.
   * Batch inserts within this window of the last keystroke are treated as IDE completion.
   */
  IDE_COMPLETION_TYPING_WINDOW_MS: 10_000,
} as const;

/** Confidence scores */
export const CONFIDENCE = {
  /** Snippet/intellisense accept intercepted via acceptSelectedSuggestion command */
  SNIPPET_COMPLETION: 0.97,
  /** AI ghost text accept intercepted via editor.action.inlineSuggest.commit */
  AI_INLINE_COMPLETION: 0.93,
  HUMAN_KEYSTROKE: 0.95,
  AI_BATCH_INSERT: 0.90,
  AI_PROCESS_ACTIVE: 0.85,
  AI_MODIFIED: 0.80,
  COPY_PASTE: 0.60,
  SNIPPET: 0.55,
  AMBIGUOUS: 0.50,
  AUTO_FORMAT: 0.40,
} as const;

/** Gutter decoration colors */
export const COLORS = {
  HUMAN: '#4ADE80',
  HUMAN_BG: 'rgba(74, 222, 128, 0.2)',
  AI_GENERATED: '#60A5FA',
  AI_GENERATED_BG: 'rgba(96, 165, 250, 0.2)',
  AI_MODIFIED: '#FBBF24',
  AI_MODIFIED_BG: 'rgba(251, 191, 36, 0.2)',
  AMBIGUOUS: '#9CA3AF',
  AMBIGUOUS_BG: 'rgba(156, 163, 175, 0.1)',
} as const;

/** Known AI process names to detect */
export const AI_PROCESSES = ['claude', 'cursor-agent', 'aider'] as const;

/** File schemes to track */
export const TRACKABLE_SCHEMES = new Set(['file', 'untitled']);

/** Default exclude patterns */
export const DEFAULT_EXCLUDES = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/*.lock',
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
];
