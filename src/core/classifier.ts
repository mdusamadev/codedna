import { Logger } from '../utils/logger';
import { Settings } from '../config/settings';
import { CONFIDENCE, DEFAULTS } from '../utils/constants';
import type {
  RawEditEvent,
  ClassifiedEditEvent,
  Classification,
  SourceHint,
} from '../utils/types';
import { normalizeLineSpan } from '../utils/edit-span';

interface LineClassification {
  readonly classification: Classification;
  readonly confidence: number;
  readonly lastUpdated: number;
}

/**
 * Classifies edit events as human, AI-generated, AI-modified, or ambiguous.
 *
 * Decision tree:
 * 1. Keystroke correlation (within window + small edit) → human
 * 2. Batch insertion (multi-line, no keystroke) → ai_generated
 * 3. AI process active (no keystroke) → ai_generated
 * 4. Human edits AI line → ai_modified
 * 5. Fallback → ambiguous
 */
export class Classifier {
  private readonly logger = Logger.getInstance();
  private readonly settings: Settings;

  /** Per-file, per-line classification state. LRU eviction at max files. */
  private readonly lineMap = new Map<string, Map<number, LineClassification>>();
  private readonly lineMapAccessOrder: string[] = [];

  private getLastKeystrokeTimestamp: () => number;
  private getAIProcessActive: () => boolean;
  private getAIProcessName: () => SourceHint;
  private sessionId: string;

  /** Rolling window of classify() durations (ms). Capped at 1000 entries. */
  private readonly perfSamples: number[] = [];

  constructor(
    settings: Settings,
    deps: {
      getLastKeystrokeTimestamp: () => number;
      isAIProcessActive: () => boolean;
      getActiveAIProcess: () => SourceHint;
      sessionId: string;
    },
  ) {
    this.settings = settings;
    this.getLastKeystrokeTimestamp = deps.getLastKeystrokeTimestamp;
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
    // Step 1: Keystroke correlation + small edit → human
    else if (hasKeystrokeCorrelation && isSmallEdit) {
      classification = 'human';
      confidence = CONFIDENCE.HUMAN_KEYSTROKE;
    }
    // Step 2: Batch insertion without keystroke.
    // If the keystroke was recent but outside the normal window it may be an
    // auto-format trigger (Shift+Alt+F) rather than AI — classify as ambiguous.
    else if (isBatchInsert && !hasKeystrokeCorrelation) {
      if (timeSinceKeystroke < DEFAULTS.FORMAT_DETECTION_WINDOW_MS) {
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
    // Step 3: AI process active + no keystroke → ai_generated
    else if (aiProcessActive && !hasKeystrokeCorrelation) {
      classification = 'ai_generated';
      confidence = CONFIDENCE.AI_PROCESS_ACTIVE;
      sourceHint = this.getAIProcessName();
    }
    // Step 4: Large paste or snippet with keystroke (Cmd+V / Tab) → ambiguous
    else if (hasKeystrokeCorrelation && event.charsAdded > 20) {
      classification = 'ambiguous';
      confidence = CONFIDENCE.COPY_PASTE;
    }
    // Step 5: Fallback → ambiguous
    else {
      classification = 'ambiguous';
      confidence = CONFIDENCE.AMBIGUOUS;
    }

    const { lineEnd } = normalizeLineSpan(event);

    // Update line provenance map.
    // Human edits on ai_generated OR ai_modified lines promote to / preserve ai_modified.
    for (let line = event.lineStart; line <= lineEnd; line++) {
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

    // Performance tracking
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

    // Update LRU order
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
