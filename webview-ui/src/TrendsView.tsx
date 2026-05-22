import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { TrendEntry } from './types';

interface TrendsViewProps {
  data: TrendEntry[] | null;
  range: '7d' | '30d' | '90d';
  onRangeChange: (r: string) => void;
}

const RANGE_OPTIONS: Array<{ value: '7d' | '30d' | '90d'; label: string }> = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
];

const COLORS = {
  human: '#4ADE80',
  ai: '#60A5FA',
  aiReviewRate: '#FBBF24',
};

interface WeekSummary {
  humanPercent: number;
  aiPercent: number;
  totalChars: number;
}

function computeWeekSummary(entries: TrendEntry[]): WeekSummary {
  const totalHuman = entries.reduce((s, e) => s + e.humanChars, 0);
  const totalAi = entries.reduce((s, e) => s + e.aiChars, 0);
  const totalAmb = entries.reduce((s, e) => s + e.ambiguousChars, 0);
  const total = totalHuman + totalAi + totalAmb;
  return {
    humanPercent: total > 0 ? Math.round((totalHuman / total) * 100) : 0,
    aiPercent: total > 0 ? Math.round((totalAi / total) * 100) : 0,
    totalChars: total,
  };
}

function WeekCard({
  label,
  summary,
}: {
  label: string;
  summary: WeekSummary;
}): React.JSX.Element {
  return (
    <div className="week-card">
      <div className="week-card__label">{label}</div>
      <div className="week-card__stats">
        <span style={{ color: COLORS.human }}>H: {summary.humanPercent}%</span>
        <span style={{ color: COLORS.ai }}>AI: {summary.aiPercent}%</span>
      </div>
      <div className="week-card__meta">{summary.totalChars.toLocaleString()} chars</div>
    </div>
  );
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function TrendsView({
  data,
  range,
  onRangeChange,
}: TrendsViewProps): React.JSX.Element {
  const hasData = data !== null && data.length >= 2;

  const thisWeekSummary =
    data && data.length > 0 ? computeWeekSummary(data.slice(-7)) : null;
  const lastWeekSummary =
    data && data.length > 7 ? computeWeekSummary(data.slice(-14, -7)) : null;

  const chartData =
    data?.map((e) => ({
      date: formatDateShort(e.date),
      Human: e.humanChars,
      AI: e.aiChars,
      'Review Rate': e.aiReviewRate,
    })) ?? [];

  const tooltipStyle = {
    background: 'var(--vscode-editor-background)',
    border: '1px solid var(--vscode-input-border)',
    color: 'var(--vscode-editor-foreground)',
    borderRadius: '4px',
  };

  return (
    <div className="trends-view">
      <section className="section">
        <div className="section-header">
          <h2 className="section-title">Trends</h2>
          <div className="range-selector" role="group" aria-label="Time range">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`range-button${range === opt.value ? ' range-button--active' : ''}`}
                onClick={() => onRangeChange(opt.value)}
                aria-pressed={range === opt.value}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {!hasData ? (
          <div className="empty-state">
            <div className="empty-state__icon">&#128202;</div>
            <p className="empty-state__text">
              Keep coding! Trends appear after 2+ days of data.
            </p>
          </div>
        ) : (
          <>
            <h3 className="chart-title">Human vs AI (characters)</h3>
            <div className="chart-container">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--vscode-input-border)"
                    opacity={0.3}
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: 'var(--vscode-editor-foreground)', fontSize: 11 }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: 'var(--vscode-editor-foreground)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend
                    formatter={(value) => (
                      <span
                        style={{ color: 'var(--vscode-editor-foreground)', fontSize: '12px' }}
                      >
                        {value}
                      </span>
                    )}
                  />
                  <Line
                    type="monotone"
                    dataKey="Human"
                    stroke={COLORS.human}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="AI"
                    stroke={COLORS.ai}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <h3 className="chart-title" style={{ marginTop: '24px' }}>
              AI Review Rate (%)
            </h3>
            <div className="chart-container">
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--vscode-input-border)"
                    opacity={0.3}
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: 'var(--vscode-editor-foreground)', fontSize: 11 }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: 'var(--vscode-editor-foreground)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    domain={[0, 100]}
                    unit="%"
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: number | string) => [`${String(value)}%`, 'Review Rate']}
                  />
                  <Line
                    type="monotone"
                    dataKey="Review Rate"
                    stroke={COLORS.aiReviewRate}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </section>

      {(thisWeekSummary || lastWeekSummary) && (
        <section className="section">
          <h2 className="section-title">Week Comparison</h2>
          <div className="week-cards">
            {thisWeekSummary && (
              <WeekCard label="This Week" summary={thisWeekSummary} />
            )}
            {lastWeekSummary && (
              <WeekCard label="Last Week" summary={lastWeekSummary} />
            )}
          </div>
        </section>
      )}
    </div>
  );
}
