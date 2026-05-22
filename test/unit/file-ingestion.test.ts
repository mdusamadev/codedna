import { describe, it, expect } from 'vitest';
import { buildWholeFileEditEvent } from '../../src/core/file-ingestion';

describe('file-ingestion', () => {
  it('buildWholeFileEditEvent spans all lines in a new file', () => {
    const text = 'const a = 1;\nconst b = 2;\n';
    const event = buildWholeFileEditEvent('test1.jsx', text, 'javascriptreact', true);

    expect(event).not.toBeNull();
    expect(event!.isFromDisk).toBe(true);
    expect(event!.lineStart).toBe(0);
    expect(event!.lineEnd).toBe(2);
    expect(event!.charsAdded).toBe(text.length);
    expect(event!.linesAdded).toBe(2);
  });
});
