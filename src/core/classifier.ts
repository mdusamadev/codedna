import { Logger } from '../utils/logger';
import { Settings } from '../config/settings';
import { CONFIDENCE, DEFAULTS } from '../utils/constants';
import type {
  RawEditEvent,
  ClassifiedEditEvent,
  Classification,
  CompletionEvent,
  SourceHint,
} from '../utils/types';
import { normalizeLineSpan } from '../utils/edit-span';
import { looksLikeIdeCompletion } from '../utils/ide-completion';

interface LineClassification {
  readonly classification: Classification;
  readonly confidence: number;
  readonly lastUpdated: number;
}

/**
 * Classifies edit events as human, AI-generated, AI-modified, or ambiguous.
 *
 * Decision tree (editor edits):
 * 0. Completion command correlation (snippet / ai_inline)
 * 0b. Snippet tab-stop placeholders in insert
 * 0c. Prefix-triggered IDE completion (keystroke + chars removed + large insert)
 * 0d. Prefix replacement without recent keystroke (Enter on suggest widget)
 * 0e. Large insert soon after typing (paused before Enter; Cursor has no command API)
 * 1. Keystroke correlation + small edit → human
 * 2. Batch insertion without keystroke → ai_generated or auto-format ambiguous
 * 3. AI process active + no keystroke → ai_generated
 * 4. Large insert with keystroke → human (snippet) or ambiguous (paste)
 * 5. Fallback → ambiguous
 */
export class Classifier {
  private readonly logger = Logger.getInstance();
  private readonly settings: Settings;

  /** Per-file, per-line classification state. LRU eviction at max files. */
  private readonly lineMap = new Map<string, Map<number, LineClassification>>();
  private readonly lineMapAccessOrder: string[] = [];

  private getLastKeystrokeTimestamp: () => number;
  private getLastCompletionEvent: () => CompletionEvent;
  private getAIProcessActive: () => boolean;
  private getAIProcessName: () => SourceHint;
  private sessionId: string;

  /** Rolling window of classify() durations (ms). Capped at 1000 entries. */
  private readonly perfSamples: number[] = [];

  constructor(
    settings: Settings,
    deps: {
      getLastKeystrokeTimestamp: () => number;
      getLastCompletionEvent: () => CompletionEvent;
      isAIProcessActive: () => boolean;
      getActiveAIProcess: () => SourceHint;
      sessionId: string;
    },
  ) {
    this.settings = settings;
    this.getLastKeystrokeTimestamp = deps.getLastKeystrokeTimestamp;
    this.getLastCompletionEvent = deps.getLastCompletionEvent;
    this.getAIProcessActive = deps.isAIProcessActive;
    this.getAIProcessName = deps.getActiveAIProcess;
    this.sessionId = deps.sessionId;
  }

  /** Update the session ID (e.g., on session restart) */
  setSessionId(id: string): void {
    this.sessionId = id;
  }

  /** Classify a raw edit event */
  classify(event: RawEditEvent): ClassifiedEditEvent | null {
    const start = performance.now();

    // Skip empty events
    if (event.charsAdded === 0 && event.charsRemoved === 0) {
      return null;
    }

    const timeSinceKeystroke = event.timestamp - this.getLastKeystrokeTimestamp();
    const hasKeystrokeCorrelation = timeSinceKeystroke <= this.settings.keystrokeWindowMs;
    // TC-C02: threshold is inclusive (≤5) so a 5-char word typed is human
    const isSmallEdit = event.charsAdded <= 5;
    const isBatchInsert = event.linesAdded >= this.settings.batchThreshold;
    const aiProcessActive = this.getAIProcessActive();
    const completion = this.getLastCompletionEvent();
    const completionAgeMs = event.timestamp - completion.timestamp;
    const completionInWindow =
      completion.source !== 'none' && completionAgeMs <= this.settings.completionWindowMs;
    const recentAiInline =
      completion.source === 'ai_inline' && completionAgeMs <= this.settings.completionWindowMs;
    const ideCompletion = looksLikeIdeCompletion(event, this.settings.batchThreshold);

    let classification: Classification;
    let confidence: number;
    let sourceHint: SourceHint = 'unknown';

    // Whole-file ingest (AI created file on disk / opened without change events).
    if (event.isFromDisk) {
      if (aiProcessActive) {
        classification = 'ai_generated';
        confidence = CONFIDENCE.AI_PROCESS_ACTIVE;
        sourceHint = this.getAIProcessName();
      } else if (isBatchInsert || event.charsAdded > 20) {
        classification = 'ai_generated';
        confidence = CONFIDENCE.AI_BATCH_INSERT;
      } else {
        classification = 'ambiguous';
        confidence = CONFIDENCE.AMBIGUOUS;
      }
    }
    // Step 0: Completion source correlation — highest-priority path for editor edits.
    else if (completionInWindow && completion.source === 'snippet') {
      classification = 'human';
      confidence = CONFIDENCE.SNIPPET_COMPLETION;
    } else if (completionInWindow && completion.source === 'ai_inline') {
      classification = this.settings.tabCompletionMode;
      confidence = CONFIDENCE.AI_INLINE_COMPLETION;
      if (classification !== 'human') {
        sourceHint = aiProcessActive ? this.getAIProcessName() : 'copilot';
      }
    }
    // Step 0b: Snippet tab-stop placeholders (Emmet/snippets without command API).
    else if (event.hasSnippetPlaceholders && !recentAiInline) {
      classification = 'human';
      confidence = CONFIDENCE.SNIPPET_COMPLETION;
    }
    // Step 0c: Prefix-triggered IDE completion (e.g. "stl" + Tab replacing typed prefix).
    else if (
      !recentAiInline &&
      hasKeystrokeCorrelation &&
      event.charsRemoved > 0 &&
      (isBatchInsert || event.charsAdded > 20)
    ) {
      classification = 'human';
      confidence = CONFIDENCE.SNIPPET_COMPLETION;
    }
    // Step 0d: Prefix replacement without recent keystroke (Enter on suggest widget often
    // does not emit Keyboard selection-change; user typed "stf" then accepted later).
    else if (!recentAiInline && ideCompletion) {
      classification = 'human';
      confidence = CONFIDENCE.SNIPPET_COMPLETION;
    }
    // Step 0e: Paused IDE accept after typing a prefix (merged edit still looks like completion).
    else if (
      !recentAiInline &&
      ideCompletion &&
      timeSinceKeystroke > this.settings.keystrokeWindowMs &&
      timeSinceKeystroke <= DEFAULTS.IDE_COMPLETION_TYPING_WINDOW_MS
    ) {
      classification = 'human';
      confidence = CONFIDENCE.SNIPPET_COMPLETION;
    }
    // Step 1: Keystroke correlation + small edit → human
    else if (hasKeystrokeCorrelation && isSmallEdit) {
      classification = 'human';
      confidence = CONFIDENCE.HUMAN_KEYSTROKE;
    }
    // Step 2: Batch insertion without keystroke (not IDE completion).
    else if (isBatchInsert && !hasKeystrokeCorrelation) {
      if (!recentAiInline && ideCompletion) {
        classification = 'human';
        confidence = CONFIDENCE.SNIPPET_COMPLETION;
      } else if (timeSinceKeystroke < DEFAULTS.FORMAT_DETECTION_WINDOW_MS) {
        classification = 'ambiguous';
        confidence = CONFIDENCE.AUTO_FORMAT;
      } else {
        classification = 'ai_generated';
        confidence = CONFIDENCE.AI_BATCH_INSERT;
        if (aiProcessActive) {
          sourceHint = this.getAIProcessName();
        }
      }
    }
    // Step 3: AI process active + no keystroke → ai_generated (editor batch from agent, not IDE)
    else if (aiProcessActive && !hasKeystrokeCorrelation && !ideCompletion) {
      classification = 'ai_generated';
      confidence = CONFIDENCE.AI_PROCESS_ACTIVE;
      sourceHint = this.getAIProcessName();
    }
    // Step 4: Large insert with keystroke — prefix replacement (human) vs paste (ambiguous)
    else if (hasKeystrokeCorrelation && event.charsAdded > 20) {
      if (event.charsRemoved > 0) {
        classification = 'human';
        confidence = CONFIDENCE.SNIPPET_COMPLETION;
      } else {
        classification = 'ambiguous';
        confidence = CONFIDENCE.COPY_PASTE;
      }
    }
    // Step 5: Fallback → ambiguous
    else {
      classification = 'ambiguous';
      confidence = CONFIDENCE.AMBIGUOUS;
    }

    const { lineEnd } = normalizeLineSpan(event);

    const contentSet: Set<number> | null =
      event.nonEmptyLineOffsets !== null && event.nonEmptyLineOffsets !== undefined
        ? new Set(event.nonEmptyLineOffsets)
        : null;

    for (let line = event.lineStart; line <= lineEnd; line++) {
      const offset = line - event.lineStart;
      if (contentSet !== null && !contentSet.has(offset)) {
        continue;
      }

      const existingCls = this.getLineClass(event.filePath, line)?.classification;
      if (classification === 'human' && (existingCls === 'ai_generated' || existingCls === 'ai_modified')) {
        this.setLineClass(event.filePath, line, 'ai_modified', CONFIDENCE.AI_MODIFIED);
      } else {
        this.setLineClass(event.filePath, line, classification, confidence);
      }
    }

    const result: ClassifiedEditEvent = {
      ...event,
      lineEnd,
      sessionId: this.sessionId,
      classification,
      confidence,
      sourceHint,
    };

    const elapsed = performance.now() - start;
    if (elapsed > 20) {
      this.logger.perf('classify', elapsed);
    }
    this.perfSamples.push(elapsed);
    if (this.perfSamples.length > 1000) this.perfSamples.shift();

    return result;
  }

  /** Get the current classification for a specific line */
  getLineClassification(filePath: string, line: number): LineClassification | null {
    return this.lineMap.get(filePath)?.get(line) ?? null;
  }

  /** Get all line classifications for a file */
  getFileProvenance(filePath: string): ReadonlyMap<number, LineClassification> {
    return this.lineMap.get(filePath) ?? new Map();
  }

  /** Clear the line map (e.g., on data reset) */
  clearLineMap(): void {
    this.lineMap.clear();
    this.lineMapAccessOrder.length = 0;
  }

  /** Return aggregate performance stats for the output channel. */
  getPerformanceStats(): { avgMs: number; p95Ms: number; maxMs: number; sampleCount: number } {
    if (this.perfSamples.length === 0) {
      return { avgMs: 0, p95Ms: 0, maxMs: 0, sampleCount: 0 };
    }
    const sorted = [...this.perfSamples].sort((a, b) => a - b);
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const p95idx = Math.floor(sorted.length * 0.95);
    return {
      avgMs: parseFloat(avg.toFixed(2)),
      p95Ms: parseFloat((sorted[p95idx] ?? 0).toFixed(2)),
      maxMs: parseFloat((sorted[sorted.length - 1] ?? 0).toFixed(2)),
      sampleCount: sorted.length,
    };
  }

  private getLineClass(filePath: string, line: number): LineClassification | null {
    return this.lineMap.get(filePath)?.get(line) ?? null;
  }

  private setLineClass(
    filePath: string,
    line: number,
    classification: Classification,
    confidence: number,
  ): void {
    let fileLines = this.lineMap.get(filePath);
    if (!fileLines) {
      fileLines = new Map();
      this.lineMap.set(filePath, fileLines);
      this.evictOldFiles();
    }

    fileLines.set(line, {
      classification,
      confidence,
      lastUpdated: Date.now(),
    });

    const idx = this.lineMapAccessOrder.indexOf(filePath);
    if (idx >= 0) {
      this.lineMapAccessOrder.splice(idx, 1);
    }
    this.lineMapAccessOrder.push(filePath);
  }

  private evictOldFiles(): void {
    while (this.lineMap.size > DEFAULTS.LINE_MAP_MAX_FILES) {
      const oldest = this.lineMapAccessOrder.shift();
      if (oldest) {
        this.lineMap.delete(oldest);
        this.logger.debug(`Evicted line map for: ${oldest}`);
      }
    }
  }
}
