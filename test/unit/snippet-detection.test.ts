import { describe, it, expect } from 'vitest';
import { detectSnippetPlaceholders } from '../../src/utils/snippet-detection';

describe('detectSnippetPlaceholders', () => {
  it('detects $0 and $1 tab stops', () => {
    expect(detectSnippetPlaceholders('class Foo {\n  $0\n}')).toBe(true);
    expect(detectSnippetPlaceholders('for (let $1 = 0; $1 < n; $1++)')).toBe(true);
  });

  it('detects ${n:label} placeholders', () => {
    expect(detectSnippetPlaceholders('StatelessWidget build(${1:context})')).toBe(true);
  });

  it('returns false for plain code without tab stops', () => {
    expect(detectSnippetPlaceholders('<div class="container"></div>')).toBe(false);
    expect(detectSnippetPlaceholders('import foo from "bar";')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(detectSnippetPlaceholders('')).toBe(false);
  });
});
