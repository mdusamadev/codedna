import { describe, it, expect } from 'vitest';
import { affectedLineCount, normalizeLineSpan } from '../../src/utils/edit-span';

describe('edit-span', () => {
  it('extends lineEnd for multi-line inserts at one anchor', () => {
    expect(normalizeLineSpan({ lineStart: 2, lineEnd: 2, linesAdded: 2 })).toEqual({
      lineStart: 2,
      lineEnd: 4,
    });
    expect(affectedLineCount({ lineStart: 2, lineEnd: 2, linesAdded: 2 })).toBe(3);
  });

  it('keeps single-line edits as one line', () => {
    expect(affectedLineCount({ lineStart: 10, lineEnd: 10, linesAdded: 0 })).toBe(1);
  });
});
