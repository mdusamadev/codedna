import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { TodaySummary } from './types';

interface TodayViewProps {
  data: TodaySummary | null;
}

const PIE_COLORS = {
  human: '#4ADE80',
  ai: '#60A5FA',
  ambiguous: '#9CA3AF',
};

function formatHour(hour: number): string {
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:00 ${suffix}`;
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}): React.JSX.Element {
  return (
    <div className="stat-card" style={{ borderTop: `3px solid ${color}` }}>
      <div className="stat-card__value" style={{ color }}>
        {value}
      </div>
      <div className="stat-card__label">{label}</div>
    </div>
  );
}

export default function TodayView({ data }: TodayViewProps): React.JSX.Element {
  if (!data || data.totalLines === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">&#128187;</div>
        <p className="empty-state__text">Start coding! Stats will appear here.</p>
      </div>
    );
  }

  const pieData = [
    { name: 'Human', value: data.humanChars, color: PIE_COLORS.human },
    { name: 'AI', value: data.aiChars, color: PIE_COLORS.ai },
    { name: 'Ambiguous', value: data.ambiguousChars, color: PIE_COLORS.ambiguous },
  ].filter((d) => d.value > 0);

  const sortedFiles = [...data.fileBreakdown].sort((a, b) => b.aiPercent - a.aiPercent);

  return (
    <div className="today-view">
      <section className="section">
        <div className="section-header">
          <h2 className="section-title">Today&#39;s Session</h2>
          <span className="section-meta">{data.activeMinutes} min active</span>
        </div>

        <div className="stat-cards">
          <StatCard
            label="Human"
            value={`${data.humanPercent}%`}
            color={PIE_COLORS.human}
          />
          <StatCard
            label="AI-Generated"
            value={`${data.aiPercent}%`}
            color={PIE_COLORS.ai}
          />
          <StatCard
            label="AI Review Rate"
            value={`${data.aiReviewRate}%`}
            color="#FBBF24"
          />
        </div>

        <div className="subsection-meta">
          {data.totalChars.toLocaleString()} chars &middot; {data.humanChars.toLocaleString()} human
          &middot; {data.aiChars.toLocaleString()} AI
          {data.ambiguousChars > 0 ? ` · ${data.ambiguousChars.toLocaleString()} other` : ''}
          <span className="subsection-meta__sep"> &middot; </span>
          {data.totalLines} line edits
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Composition</h2>
        <div className="pie-container">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={2}
                dataKey="value"
              >
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: 'var(--vscode-editor-background)',
                  border: '1px solid var(--vscode-input-border)',
                  color: 'var(--vscode-editor-foreground)',
                  borderRadius: '4px',
                }}
                formatter={(value: number, name: string) => [`${value} chars`, name]}
              />
              <Legend
                formatter={(value) => (
                  <span style={{ color: 'var(--vscode-editor-foreground)', fontSize: '12px' }}>
                    {value}
                  </span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </section>

      {data.mostProductiveHour !== null && (
        <section className="section">
          <div className="insight-card">
            <span className="insight-icon">&#9200;</span>
            <span>
              Most productive hour: <strong>{formatHour(data.mostProductiveHour)}</strong>
            </span>
          </div>
        </section>
      )}

      {sortedFiles.length > 0 && (
        <section className="section">
          <h2 className="section-title">File Breakdown</h2>
          <div className="table-wrapper">
            <table className="file-table">
              <thead>
                <tr>
                  <th className="file-table__col-file">File</th>
                  <th className="file-table__col-pct">H%</th>
                  <th className="file-table__col-pct">AI%</th>
                  <th className="file-table__col-lines">Lines</th>
                </tr>
              </thead>
              <tbody>
                {sortedFiles.map((f) => (
                  <tr key={f.filePath} className="file-table__row">
                    <td className="file-table__cell file-table__cell--path" title={f.filePath}>
                      {f.filePath.length > 40 ? `...${f.filePath.slice(-37)}` : f.filePath}
                    </td>
                    <td
                      className="file-table__cell file-table__cell--pct"
                      style={{ color: PIE_COLORS.human }}
                    >
                      {f.humanPercent}%
                    </td>
                    <td
                      className="file-table__cell file-table__cell--pct"
                      style={{ color: PIE_COLORS.ai }}
                    >
                      {f.aiPercent}%
                    </td>
                    <td className="file-table__cell file-table__cell--lines">{f.totalLines}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
