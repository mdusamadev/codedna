import { describe, it, expect } from 'vitest';
import { analyzeInsertedText } from '../../src/utils/text-analysis';

describe('analyzeInsertedText', () => {
  // ── Empty / whitespace input ───────────────────────────────────────────────

  it('empty string → no offsets, 0 meaningful', () => {
    const r = analyzeInsertedText('', 'typescript');
    expect(r.nonEmptyLineOffsets).toEqual([]);
    expect(r.meaningfulCharsAdded).toBe(0);
  });

  it('whitespace-only string → no offsets, 0 meaningful', () => {
    const r = analyzeInsertedText('   \t  ', 'typescript');
    expect(r.nonEmptyLineOffsets).toEqual([]);
    expect(r.meaningfulCharsAdded).toBe(0);
  });

  it('single newline → no offsets, 0 meaningful', () => {
    const r = analyzeInsertedText('\n', 'typescript');
    expect(r.nonEmptyLineOffsets).toEqual([]);
    expect(r.meaningfulCharsAdded).toBe(0);
  });

  // ── Single-line fast path ──────────────────────────────────────────────────

  it('single real-code char → offset [0], meaningful = 1', () => {
    const r = analyzeInsertedText('a', 'typescript');
    expect(r.nonEmptyLineOffsets).toEqual([0]);
    expect(r.meaningfulCharsAdded).toBe(1);
  });

  it('single space → no offsets, 0 meaningful', () => {
    const r = analyzeInsertedText(' ', 'typescript');
    expect(r.nonEmptyLineOffsets).toEqual([]);
    expect(r.meaningfulCharsAdded).toBe(0);
  });

  it('single "{" → offset [0], meaningful = 1 (no bracket-filtering for single-line)', () => {
    // Single-line path: bracket filtering is not applied — the user just typed {
    const r = analyzeInsertedText('{', 'typescript');
    expect(r.nonEmptyLineOffsets).toEqual([0]);
    expect(r.meaningfulCharsAdded).toBe(1);
  });

  it('real code line → offset [0], meaningful = non-whitespace count', () => {
    const r = analyzeInsertedText('const x = 10;', 'typescript');
    expect(r.nonEmptyLineOffsets).toEqual([0]);
    expect(r.meaningfulCharsAdded).toBe('constx=10;'.length); // 10
  });

  // ── Multi-line: nonEmptyLineOffsets ────────────────────────────────────────

  it('multi-line AI block: empty lines are NOT in nonEmptyLineOffsets', () => {
    // Simulates AI inserting:
    // line 0: "function foo() {"    ← has content
    // line 1: ""                    ← EMPTY
    // line 2: "  return 42;"        ← has content
    // line 3: "}"                   ← has content (bracket)
    const text = 'function foo() {\n\n  return 42;\n}';
    const r = analyzeInsertedText(text, 'typescript');
    expect(r.nonEmptyLineOffsets).toEqual([0, 2, 3]);
    expect(r.nonEmptyLineOffsets).not.toContain(1); // empty line excluded
  });

  it('whitespace-only lines are NOT in nonEmptyLineOffsets', () => {
    const text = 'code\n    \nmore code\n\t\t';
    const r = analyzeInsertedText(text, 'typescript');
    expect(r.nonEmptyLineOffsets).toEqual([0, 2]);
  });

  // ── Multi-line: meaningfulCharsAdded ──────────────────────────────────────

  it('bracket-only lines do NOT contribute to meaningfulCharsAdded', () => {
    const text = 'function foo() {\n  return 42;\n}';
    const r = analyzeInsertedText(text, 'typescript');
    expect(r.nonEmptyLineOffsets).toContain(0);  // "function foo() {" has content
    expect(r.nonEmptyLineOffsets).toContain(1);  // "  return 42;" has content
    expect(r.nonEmptyLineOffsets).toContain(2);  // "}" has content
    // "function foo() {" is NOT bracket-only (has letters) → contributes "functionfoo(){" = 14 chars
    // "  return 42;" is code → contributes "return42;" = 9 chars
    // "}" IS bracket-only → excluded from meaningful
    expect(r.meaningfulCharsAdded).toBe(
      'functionfoo(){'.length + 'return42;'.length // 14 + 9 = 23
    );
  });

  it('pure closing brace on own line is excluded from meaningfulCharsAdded', () => {
    const text = '  someCode();\n}';
    const r = analyzeInsertedText(text, 'typescript');
    expect(r.nonEmptyLineOffsets).toEqual([0, 1]); // both lines non-empty
    // "}" is bracket-only → only "  someCode();" contributes
    expect(r.meaningfulCharsAdded).toBe('someCode();'.length); // 11
  });

  it('comment lines do NOT contribute to meaningfulCharsAdded', () => {
    const text = '// This is a comment\nconst x = 1;';
    const r = analyzeInsertedText(text, 'typescript');
    expect(r.nonEmptyLineOffsets).toEqual([0, 1]); // comment line is non-empty for provenance
    expect(r.meaningfulCharsAdded).toBe('constx=1;'.length); // 9, comment excluded
  });

  it('// comment lines in Python do NOT contribute', () => {
    // Python uses # for comments
    const text = '# comment\nx = 1';
    const r = analyzeInsertedText(text, 'python');
    expect(r.nonEmptyLineOffsets).toEqual([0, 1]);
    expect(r.meaningfulCharsAdded).toBe('x=1'.length); // 3
  });

  it('# comment NOT filtered for TypeScript (wrong language)', () => {
    // # is not a TS comment — it gets counted
    const text = '# not a comment\nconst x = 1;';
    const r = analyzeInsertedText(text, 'typescript');
    // Both lines have content
    expect(r.nonEmptyLineOffsets).toEqual([0, 1]);
    // "#not acomment" = 13 non-whitespace + "constx=1;" = 9 → 22
    expect(r.meaningfulCharsAdded).toBe('#notacomment'.length + 'constx=1;'.length);
  });

  it('block comment lines (* prefix) do NOT contribute', () => {
    const text = '/**\n * @param x\n */\nconst y = 2;';
    const r = analyzeInsertedText(text, 'typescript');
    expect(r.meaningfulCharsAdded).toBe('consty=2;'.length); // 9
    // All 4 lines are non-empty (for provenance)
    expect(r.nonEmptyLineOffsets.length).toBe(4);
  });

  it('"}" "});" style bracket-only lines excluded from meaningful', () => {
    const text = 'if (cond) {\n  doSomething();\n}\n});';
    const r = analyzeInsertedText(text, 'typescript');
    // "if (cond) {" → bracket-only? No — it has 'if' and 'cond'
    // "  doSomething();" → meaningful
    // "}" → bracket-only
    // "});" → bracket-only
    expect(r.meaningfulCharsAdded).toBeGreaterThan(0);
    // "if(cond){" = 9, "doSomething();" → "doSomething();" non-ws = 14
    // line0 "if (cond) {" trimmed is "if (cond) {" → has letters, not bracket-only
    // Wait: isBracketOnlyLine checks /^[{}\[\]();,]+$/ — "if (cond) {" has letters → NOT bracket-only
    expect(r.meaningfulCharsAdded).toBe(
      'if(cond){'.length + 'doSomething();'.length // 9 + 14 = 23
    );
  });

  it('all-whitespace multi-line insert → no offsets, 0 meaningful', () => {
    const text = '   \n\n\t\t\n  ';
    const r = analyzeInsertedText(text, 'typescript');
    expect(r.nonEmptyLineOffsets).toEqual([]);
    expect(r.meaningfulCharsAdded).toBe(0);
  });

  // ── The core bug scenario (Problem 1) ─────────────────────────────────────

  it('AI block with blank lines: blank lines absent from nonEmptyLineOffsets', () => {
    // Simulates AI generating:
    // "class Foo {",  // line offset 0 — has content
    // "",             // line offset 1 — BLANK → should NOT be tracked
    // "  method() {", // line offset 2 — has content
    // "    return;",  // line offset 3 — has content
    // "  }",          // line offset 4 — bracket-only but non-empty
    // "",             // line offset 5 — BLANK → should NOT be tracked
    // "}"             // line offset 6 — bracket-only but non-empty
    const text = 'class Foo {\n\n  method() {\n    return;\n  }\n\n}';
    const r = analyzeInsertedText(text, 'typescript');
    expect(r.nonEmptyLineOffsets).toContain(0);
    expect(r.nonEmptyLineOffsets).not.toContain(1); // blank
    expect(r.nonEmptyLineOffsets).toContain(2);
    expect(r.nonEmptyLineOffsets).toContain(3);
    expect(r.nonEmptyLineOffsets).toContain(4);
    expect(r.nonEmptyLineOffsets).not.toContain(5); // blank
    expect(r.nonEmptyLineOffsets).toContain(6);
  });
});
