import type { Classification } from './types';

export interface ProvenanceDisplay {
  readonly gutterText: string;
  readonly hoverTitle: string;
  readonly color: string;
}

/** Short label shown in the editor gutter (before each line). */
export function provenanceShortLabel(classification: Classification): string {
  switch (classification) {
    case 'human':
      return 'by you';
    case 'ai_generated':
      return 'by AI';
    case 'ai_modified':
      return 'you · AI';
    case 'ambiguous':
      return 'unclear';
  }
}

/** Git-blame style timestamp for tooltips and detail views. */
export function formatProvenanceTimestamp(ts: number, now = Date.now()): string {
  const diff = now - ts;
  const date = new Date(ts);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfEventDay = new Date(ts);
  startOfEventDay.setHours(0, 0, 0, 0);

  if (diff < 60_000) {
    return 'just now';
  }
  if (diff < 3600_000) {
    const minutes = Math.floor(diff / 60_000);
    return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  }
  if (startOfEventDay.getTime() === startOfToday.getTime()) {
    return date.toLocaleString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  if (startOfEventDay.getTime() === startOfYesterday.getTime()) {
    return `Yesterday ${date.toLocaleString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })}`;
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Compact relative time for inline gutter (keeps the column narrow). */
export function formatProvenanceTimestampShort(ts: number, now = Date.now()): string {
  const diff = now - ts;
  if (diff < 60_000) {
    return 'now';
  }
  if (diff < 3600_000) {
    return `${Math.floor(diff / 60_000)}m`;
  }
  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)}h`;
  }
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function provenanceDisplay(
  classification: Classification,
  lastUpdated: number,
  now = Date.now(),
): ProvenanceDisplay {
  const label = provenanceShortLabel(classification);
  const when = formatProvenanceTimestampShort(lastUpdated, now);
  const gutterText = `${label} · ${when}`;

  let hoverTitle: string;
  switch (classification) {
    case 'human':
      hoverTitle = '**Written by you**';
      break;
    case 'ai_generated':
      hoverTitle = '**Written by AI**';
      break;
    case 'ai_modified':
      hoverTitle = '**Written by AI, modified by you**';
      break;
    case 'ambiguous':
      hoverTitle = '**Unclear origin**';
      break;
  }

  const color = provenanceColor(classification);
  return { gutterText, hoverTitle, color };
}

export function provenanceColor(classification: Classification): string {
  switch (classification) {
    case 'human':
      return '#4ADE80';
    case 'ai_generated':
      return '#60A5FA';
    case 'ai_modified':
      return '#FBBF24';
    case 'ambiguous':
      return '#9CA3AF';
  }
}
