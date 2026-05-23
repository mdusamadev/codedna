import { describe, it, expect } from 'vitest';
import { looksLikeIdeCompletion } from '../../src/utils/ide-completion';
import type { RawEditEvent } from '../../src/utils/types';

const base: RawEditEvent = {
  timestamp: 0,
  filePath: 'f.dart',
  lineStart: 0,
  lineEnd: 0,
  charsAdded: 0,
  charsRemoved: 0,
  linesAdded: 0,
  language: 'dart',
  isFromDisk: false,
};

describe('looksLikeIdeCompletion', () => {
  it('true for short prefix replacement + batch insert', () => {
    expect(
      looksLikeIdeCompletion(
        { ...base, charsRemoved: 3, charsAdded: 200, linesAdded: 10 },
        3,
      ),
    ).toBe(true);
  });

  it('false for large selection replace', () => {
    expect(
      looksLikeIdeCompletion(
        { ...base, charsRemoved: 100, charsAdded: 200, linesAdded: 10 },
        3,
      ),
    ).toBe(false);
  });
});
