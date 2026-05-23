import { describe, it, expect } from 'vitest';
import { mergeContentChanges } from '../../src/utils/merge-document-changes';

describe('mergeContentChanges', () => {
  it('merges delete-prefix + insert-template into one change', () => {
    const merged = mergeContentChanges(
      [
        {
          range: { start: { line: 10, character: 0 }, end: { line: 10, character: 3 } },
          rangeLength: 3,
          text: '',
        },
        {
          range: { start: { line: 10, character: 0 }, end: { line: 10, character: 0 } },
          rangeLength: 0,
          text: 'class Foo extends StatelessWidget {\n  $0\n}\n',
        },
      ],
      'dart',
    );

    expect(merged).not.toBeNull();
    expect(merged!.charsRemoved).toBe(3);
    expect(merged!.charsAdded).toBeGreaterThan(20);
    expect(merged!.hasSnippetPlaceholders).toBe(true);
  });
});
