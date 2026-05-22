import { describe, it, expect, beforeEach } from 'vitest';
import { Classifier } from '../../src/core/classifier';
import { Settings } from '../../src/config/settings';
import sampleEdits from '../fixtures/sample-edits.json';
import type { RawEditEvent, SourceHint } from '../../src/utils/types';

describe('Classifier', () => {
  let classifier: Classifier;
  let lastKeystrokeTs: number;
  let aiActive: boolean;
  let aiProcess: SourceHint;

  beforeEach(() => {
    lastKeystrokeTs = 0;
    aiActive = false;
    aiProcess = 'unknown';

    const settings = new Settings();
    classifier = new Classifier(settings, {
      getLastKeystrokeTimestamp: () => lastKeystrokeTs,
      isAIProcessActive: () => aiActive,
      getActiveAIProcess: () => aiProcess,
      sessionId: 'test-session',
    });
  });

  // Run all fixture-based tests
  for (const fixture of sampleEdits) {
    const f = fixture as {
      id: string;
      description: string;
      input: RawEditEvent;
      context: { lastKeystrokeTimestamp: number; aiProcessActive: boolean; aiProcessName: SourceHint };
      expected: { classification: string; minConfidence: number; sourceHint?: string } | null;
    };

    it(`${f.id}: ${f.description}`, () => {
      lastKeystrokeTs = f.context.lastKeystrokeTimestamp;
      aiActive = f.context.aiProcessActive;
      aiProcess = f.context.aiProcessName;

      const result = classifier.classify(f.input);

      if (f.expected === null) {
        expect(result).toBeNull();
      } else {
        expect(result).not.toBeNull();
        expect(result!.classification).toBe(f.expected.classification);
        expect(result!.confidence).toBeGreaterThanOrEqual(f.expected.minConfidence);
        if (f.expected.sourceHint) {
          expect(result!.sourceHint).toBe(f.expected.sourceHint);
        }
      }
    });
  }

  // Additional programmatic tests
  it('TC-C08: Human edits an AI-generated line → ai_modified', () => {
    // First: AI generates line 15
    lastKeystrokeTs = 0;
    aiActive = false;
    const aiEvent: RawEditEvent = {
      timestamp: 1000,
      filePath: 'src/test.ts',
      lineStart: 15,
      lineEnd: 15,
      charsAdded: 100,
      charsRemoved: 0,
      linesAdded: 5,
      language: 'typescript',
      isFromDisk: false,
    };
    const aiResult = classifier.classify(aiEvent);
    expect(aiResult?.classification).toBe('ai_generated');

    // Then: Human edits line 15
    lastKeystrokeTs = 1950;
    const humanEvent: RawEditEvent = {
      timestamp: 2000,
      filePath: 'src/test.ts',
      lineStart: 15,
      lineEnd: 15,
      charsAdded: 3,
      charsRemoved: 0,
      linesAdded: 0,
      language: 'typescript',
      isFromDisk: false,
    };
    classifier.classify(humanEvent);

    // Check line provenance was updated
    const lineClass = classifier.getLineClassification('src/test.ts', 15);
    expect(lineClass?.classification).toBe('ai_modified');
  });

  it('TC-C14: Deletion only → human', () => {
    lastKeystrokeTs = 900;
    const event: RawEditEvent = {
      timestamp: 1000,
      filePath: 'src/test.ts',
      lineStart: 5,
      lineEnd: 5,
      charsAdded: 0,
      charsRemoved: 50,
      linesAdded: 0,
      language: 'typescript',
      isFromDisk: false,
    };
    // Deletion-only with no chars added — currently returns null (empty event)
    // This is correct behavior: the classifier skips events with 0 added + 0 removed isn't this case
    // Actually chars_removed=50, so it won't be null. Let's check:
    const result = classifier.classify(event);
    // charsAdded=0 AND charsRemoved=0 → null. But here charsRemoved=50, charsAdded=0.
    // The check is: if (charsAdded === 0 && charsRemoved === 0) return null
    // So this should NOT be null. It should classify.
    expect(result).not.toBeNull();
  });

  it('getFileProvenance returns all tracked lines for a file', () => {
    lastKeystrokeTs = 800;
    for (let i = 0; i < 5; i++) {
      classifier.classify({
        timestamp: 1000 + i,
        filePath: 'src/multi.ts',
        lineStart: i,
        lineEnd: i,
        charsAdded: 2,
        charsRemoved: 0,
        linesAdded: 0,
        language: 'typescript',
        isFromDisk: false,
      });
    }

    const provenance = classifier.getFileProvenance('src/multi.ts');
    expect(provenance.size).toBeGreaterThanOrEqual(5);
  });

  // ── Additional programmatic tests ─────────────────────────────────────────

  it('TC-C09: Human edits an already ai_modified line → stays ai_modified (confidence 0.80)', () => {
    // Step 1: AI generates content on line 5 (batch insert, no keystroke)
    lastKeystrokeTs = 0;
    aiActive = false;
    const aiEvent: RawEditEvent = {
      timestamp: 3000, // 3000ms since last keystroke (0) → outside format window (800ms)
      filePath: 'src/c09.ts',
      lineStart: 5,
      lineEnd: 5,
      charsAdded: 80,
      charsRemoved: 0,
      linesAdded: 5,
      language: 'typescript',
      isFromDisk: false,
    };
    const aiResult = classifier.classify(aiEvent);
    expect(aiResult?.classification).toBe('ai_generated');

    // Step 2: Human edits line 5 → becomes ai_modified
    lastKeystrokeTs = 1950 + 3000;
    const humanEvent1: RawEditEvent = {
      timestamp: 2000 + 3000,
      filePath: 'src/c09.ts',
      lineStart: 5,
      lineEnd: 5,
      charsAdded: 2,
      charsRemoved: 0,
      linesAdded: 0,
      language: 'typescript',
      isFromDisk: false,
    };
    classifier.classify(humanEvent1);
    const afterFirstEdit = classifier.getLineClassification('src/c09.ts', 5);
    expect(afterFirstEdit?.classification).toBe('ai_modified');

    // Step 3: Human edits line 5 again → line stays ai_modified (spec: preserve ai_modified)
    lastKeystrokeTs = 2950 + 3000;
    const humanEvent2: RawEditEvent = {
      timestamp: 3000 + 3000,
      filePath: 'src/c09.ts',
      lineStart: 5,
      lineEnd: 5,
      charsAdded: 1,
      charsRemoved: 0,
      linesAdded: 0,
      language: 'typescript',
      isFromDisk: false,
    };
    classifier.classify(humanEvent2);

    const lineClass = classifier.getLineClassification('src/c09.ts', 5);
    // Classifier now preserves ai_modified: human edit on ai_modified → stays ai_modified
    expect(lineClass?.classification).toBe('ai_modified');
    expect(lineClass?.confidence).toBeCloseTo(0.8, 1);
  });

  it('TC-C16: Keystroke at exactly keystrokeWindowMs boundary (200ms) → human', () => {
    // timeSinceKeystroke = timestamp - lastKeystrokeTs = 1200 - 1000 = 200
    // hasKeystrokeCorrelation = 200 <= 200 → true
    lastKeystrokeTs = 1000;
    const event: RawEditEvent = {
      timestamp: 1200,
      filePath: 'src/c16.ts',
      lineStart: 1,
      lineEnd: 1,
      charsAdded: 1,
      charsRemoved: 0,
      linesAdded: 0,
      language: 'typescript',
      isFromDisk: false,
    };
    const result = classifier.classify(event);
    expect(result).not.toBeNull();
    expect(result!.classification).toBe('human');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('TC-C17: Keystroke just outside window (201ms) → ambiguous', () => {
    // timeSinceKeystroke = 1201 - 1000 = 201 > 200 → no keystroke correlation
    // charsAdded=1 < 5 (small edit), linesAdded=0 < batchThreshold=3 (not batch)
    // aiActive=false → fallback ambiguous
    lastKeystrokeTs = 1000;
    aiActive = false;
    const event: RawEditEvent = {
      timestamp: 1201,
      filePath: 'src/c17.ts',
      lineStart: 1,
      lineEnd: 1,
      charsAdded: 1,
      charsRemoved: 0,
      linesAdded: 0,
      language: 'typescript',
      isFromDisk: false,
    };
    const result = classifier.classify(event);
    expect(result).not.toBeNull();
    expect(result!.classification).toBe('ambiguous');
  });

  it('TC-C18: Auto-formatting event — batch within format window (500ms) → ambiguous (0.40)', () => {
    // User pressed Shift+Alt+F (format), the formatter ran 500ms later producing a batch change.
    // 500ms is outside the keystroke window (200ms) but inside the format-detection window (800ms).
    // The classifier treats this as a possible auto-format → ambiguous (AUTO_FORMAT=0.40).
    lastKeystrokeTs = 1000;
    aiActive = false;
    const event: RawEditEvent = {
      timestamp: 1500, // 500ms after last keystroke (within 800ms format window)
      filePath: 'src/c18.ts',
      lineStart: 1,
      lineEnd: 1,
      charsAdded: 100,
      charsRemoved: 0,
      linesAdded: 20,
      language: 'typescript',
      isFromDisk: false,
    };
    const result = classifier.classify(event);
    expect(result).not.toBeNull();
    expect(result!.classification).toBe('ambiguous');
    expect(result!.confidence).toBeCloseTo(0.4, 1);
  });

  it('TC-C10: Rapid typing burst — 5 events each 1 char within 100ms → all human', () => {
    // All 5 events have keystroke correlation (within 200ms) and charsAdded=1 (≤5)
    aiActive = false;
    const results = [];
    for (let i = 0; i < 5; i++) {
      lastKeystrokeTs = 1000 + i * 20; // keystrokes every 20ms
      const event: RawEditEvent = {
        timestamp: 1010 + i * 20, // 10ms after each keystroke
        filePath: 'src/c10.ts',
        lineStart: i,
        lineEnd: i,
        charsAdded: 1,
        charsRemoved: 0,
        linesAdded: 0,
        language: 'typescript',
        isFromDisk: false,
      };
      results.push(classifier.classify(event));
    }
    for (const r of results) {
      expect(r?.classification).toBe('human');
      expect(r?.confidence).toBeCloseTo(0.95, 2);
    }
  });

  it('TC-C20: Empty event (charsAdded=0, charsRemoved=0) → null (same as TC-C15)', () => {
    // Duplicate of TC-C15 for spec completeness.
    lastKeystrokeTs = 900;
    const event: RawEditEvent = {
      timestamp: 1000,
      filePath: 'src/c20.ts',
      lineStart: 1,
      lineEnd: 1,
      charsAdded: 0,
      charsRemoved: 0,
      linesAdded: 0,
      language: 'typescript',
      isFromDisk: false,
    };
    expect(classifier.classify(event)).toBeNull();
  });

  it('Deletion-only event (charsAdded=0, charsRemoved=50, keystroke 100ms ago) → human', () => {
    // charsAdded=0 AND charsRemoved=50 → skip check (charsAdded===0 && charsRemoved===0) = false
    // So it does NOT return null.
    // hasKeystrokeCorrelation: 1000 - 900 = 100 <= 200 → true
    // isSmallEdit: charsAdded=0 < 5 → true
    // → human (confidence HUMAN_KEYSTROKE=0.95)
    lastKeystrokeTs = 900;
    aiActive = false;
    const event: RawEditEvent = {
      timestamp: 1000,
      filePath: 'src/deletion.ts',
      lineStart: 10,
      lineEnd: 10,
      charsAdded: 0,
      charsRemoved: 50,
      linesAdded: 0,
      language: 'typescript',
      isFromDisk: false,
    };
    const result = classifier.classify(event);
    expect(result).not.toBeNull();
    expect(result!.classification).toBe('human');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('TC-C02: 5-char word typed with keystroke within 200ms → human (threshold is ≤5)', () => {
    // The classifier uses charsAdded <= 5 so exactly 5 chars satisfies isSmallEdit.
    lastKeystrokeTs = 900;
    aiActive = false;
    const event: RawEditEvent = {
      timestamp: 1000,
      filePath: 'src/c02.ts',
      lineStart: 3,
      lineEnd: 3,
      charsAdded: 5,
      charsRemoved: 0,
      linesAdded: 0,
      language: 'typescript',
      isFromDisk: false,
    };
    const result = classifier.classify(event);
    expect(result).not.toBeNull();
    // hasKeystrokeCorrelation = (1000-900=100) <= 200 → true
    // isSmallEdit = 5 <= 5 → true
    // Step 1: human (0.95)
    expect(result!.classification).toBe('human');
    expect(result!.confidence).toBeCloseTo(0.95, 2);
  });

  it('TC-C12: Disk change with AI process active → ai_generated (confidence 0.85)', () => {
    // isFromDisk=true, aiProcessActive=true, no keystroke
    lastKeystrokeTs = 0;
    aiActive = true;
    aiProcess = 'claude';
    const event: RawEditEvent = {
      timestamp: 1000,
      filePath: 'src/c12.ts',
      lineStart: 1,
      lineEnd: 1,
      charsAdded: 30,
      charsRemoved: 0,
      linesAdded: 0,
      language: 'typescript',
      isFromDisk: true,
    };
    const result = classifier.classify(event);
    expect(result).not.toBeNull();
    // No keystroke, AI process active → step 3: ai_generated (0.85)
    expect(result!.classification).toBe('ai_generated');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result!.sourceHint).toBe('claude');
  });

  it('TC-C13: Disk change with no AI process active → ambiguous', () => {
    // isFromDisk=true, aiProcessActive=false, no keystroke, small edit
    lastKeystrokeTs = 0;
    aiActive = false;
    const event: RawEditEvent = {
      timestamp: 1000,
      filePath: 'src/c13.ts',
      lineStart: 5,
      lineEnd: 5,
      charsAdded: 4,
      charsRemoved: 0,
      linesAdded: 0,
      language: 'typescript',
      isFromDisk: true,
    };
    const result = classifier.classify(event);
    expect(result).not.toBeNull();
    // No keystroke, no AI process, not batch → fallback: ambiguous
    expect(result!.classification).toBe('ambiguous');
    expect(result!.confidence).toBe(0.5);
  });

  it('TC-C19: Snippet expansion (large insert with tab keystroke) → ambiguous (0.60, copy-paste branch)', () => {
    // Tab key fires before the expansion → hasKeystrokeCorrelation=true (50ms)
    // charsAdded=150 > 20, step 4 fires → ambiguous (COPY_PASTE=0.60)
    // NOTE: Spec says 0.55 (SNIPPET confidence) but copy-paste and snippet are
    // indistinguishable without actual text content. Step 4 gives 0.60 for both.
    lastKeystrokeTs = 950;
    aiActive = false;
    const event: RawEditEvent = {
      timestamp: 1000,
      filePath: 'src/c19.ts',
      lineStart: 10,
      lineEnd: 14,
      charsAdded: 150,
      charsRemoved: 3,
      linesAdded: 4,
      language: 'typescript',
      isFromDisk: false,
    };
    const result = classifier.classify(event);
    expect(result).not.toBeNull();
    expect(result!.classification).toBe('ambiguous');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.55); // spec floor; actual is 0.60
  });

  it('TC-C21: isFromDisk whole-file ingest with AI active → ai_generated', () => {
    aiActive = true;
    aiProcess = 'cursor';
    const result = classifier.classify({
      timestamp: Date.now(),
      filePath: 'test1.jsx',
      lineStart: 0,
      lineEnd: 5,
      charsAdded: 120,
      charsRemoved: 0,
      linesAdded: 5,
      language: 'javascriptreact',
      isFromDisk: true,
    });
    expect(result?.classification).toBe('ai_generated');
    expect(result?.sourceHint).toBe('cursor');
  });

  // ── Problem 1: empty-line provenance fix ──────────────────────────────────

  it('TC-EMPTY01: blank lines in an AI block are NOT marked ai_generated in lineMap', () => {
    lastKeystrokeTs = 0;
    aiActive = false;
    // AI inserts 6 lines (offsets 0-5).  Offsets 1 and 4 are blank.
    const aiEvent: RawEditEvent = {
      timestamp: 3000,
      filePath: 'src/empty.ts',
      lineStart: 10,
      lineEnd: 15,
      charsAdded: 80,
      charsRemoved: 0,
      linesAdded: 5,
      language: 'typescript',
      isFromDisk: false,
      nonEmptyLineOffsets: [0, 2, 3, 5], // offsets 1 and 4 are blank
    };
    classifier.classify(aiEvent);

    // Non-empty lines should be ai_generated
    expect(classifier.getLineClassification('src/empty.ts', 10)?.classification).toBe('ai_generated'); // offset 0
    expect(classifier.getLineClassification('src/empty.ts', 12)?.classification).toBe('ai_generated'); // offset 2
    expect(classifier.getLineClassification('src/empty.ts', 13)?.classification).toBe('ai_generated'); // offset 3
    expect(classifier.getLineClassification('src/empty.ts', 15)?.classification).toBe('ai_generated'); // offset 5

    // Blank lines (offsets 1 and 4) must be UNTRACKED
    expect(classifier.getLineClassification('src/empty.ts', 11)).toBeNull(); // offset 1 blank
    expect(classifier.getLineClassification('src/empty.ts', 14)).toBeNull(); // offset 4 blank
  });

  it('TC-EMPTY02: human writes on an untracked (blank) line → classified as human, not ai_modified', () => {
    lastKeystrokeTs = 0;
    aiActive = false;

    // AI inserts 3 lines; offset 1 is blank (untracked)
    classifier.classify({
      timestamp: 3000,
      filePath: 'src/empty2.ts',
      lineStart: 5,
      lineEnd: 7,
      charsAdded: 60,
      charsRemoved: 0,
      linesAdded: 2,
      language: 'typescript',
      isFromDisk: false,
      nonEmptyLineOffsets: [0, 2], // offset 1 (line 6) is blank
    });

    expect(classifier.getLineClassification('src/empty2.ts', 6)).toBeNull(); // line 6 untracked

    // Human writes on the blank line
    lastKeystrokeTs = 4950;
    classifier.classify({
      timestamp: 5000,
      filePath: 'src/empty2.ts',
      lineStart: 6,
      lineEnd: 6,
      charsAdded: 4,
      charsRemoved: 0,
      linesAdded: 0,
      language: 'typescript',
      isFromDisk: false,
      nonEmptyLineOffsets: [0],
    });

    // Was untracked → now human (NOT ai_modified)
    expect(classifier.getLineClassification('src/empty2.ts', 6)?.classification).toBe('human');
  });

  it('TC-EMPTY03: absent nonEmptyLineOffsets → backward compat, all lines tracked', () => {
    lastKeystrokeTs = 0;
    aiActive = false;

    // No nonEmptyLineOffsets field (legacy event).
    // linesAdded=3 so isBatchInsert fires and we get ai_generated (not ambiguous).
    classifier.classify({
      timestamp: 3000,
      filePath: 'src/legacy.ts',
      lineStart: 0,
      lineEnd: 3,
      charsAdded: 60,
      charsRemoved: 0,
      linesAdded: 3,
      language: 'typescript',
      isFromDisk: false,
      // nonEmptyLineOffsets intentionally absent → backward compat: treat all lines as content
    });

    // All lines 0–3 should be tracked as ai_generated (old behaviour)
    expect(classifier.getLineClassification('src/legacy.ts', 0)?.classification).toBe('ai_generated');
    expect(classifier.getLineClassification('src/legacy.ts', 1)?.classification).toBe('ai_generated');
    expect(classifier.getLineClassification('src/legacy.ts', 2)?.classification).toBe('ai_generated');
    expect(classifier.getLineClassification('src/legacy.ts', 3)?.classification).toBe('ai_generated');
  });
});
