import { describe, it, expect } from 'vitest';
import {
  formatProvenanceTimestamp,
  formatProvenanceTimestampShort,
  provenanceDisplay,
  provenanceShortLabel,
} from '../../src/utils/provenance-label';

describe('provenance-label', () => {
  const now = new Date('2026-05-22T18:00:00').getTime();

  it('maps classifications to short labels', () => {
    expect(provenanceShortLabel('human')).toBe('by you');
    expect(provenanceShortLabel('ai_generated')).toBe('by AI');
    expect(provenanceShortLabel('ai_modified')).toBe('you · AI');
  });

  it('formats recent timestamps for gutter and hover', () => {
    expect(formatProvenanceTimestampShort(now - 30_000, now)).toBe('now');
    expect(formatProvenanceTimestampShort(now - 5 * 60_000, now)).toBe('5m');
    expect(formatProvenanceTimestamp(now - 5 * 60_000, now)).toBe('5 minutes ago');
  });

  it('builds gutter text with label and time', () => {
    const d = provenanceDisplay('ai_generated', now - 120_000, now);
    expect(d.gutterText).toBe('by AI · 2m');
    expect(d.hoverTitle).toContain('AI');
  });
});
