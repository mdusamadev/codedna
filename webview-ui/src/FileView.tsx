import React, { useEffect, useState } from 'react';
import type { FileBreakdownEntry, LineProvenance, HostToWebviewMessage } from './types';

interface FileViewProps {
  files: FileBreakdownEntry[] | null;
  postMessage: (msg: unknown) => void;
}

const CLASS_COLORS: Record<string, string> = {
  human: '#4ADE80',
  ai_generated: '#60A5FA',
  ai_modified: '#FBBF24',
  ambiguous: '#9CA3AF',
};

const CLASS_LABELS: Record<string, string> = {
  human: 'Human',
  ai_generated: 'AI Generated',
  ai_modified: 'AI Modified',
  ambiguous: 'Ambiguous',
};

function LineProvenanceList({
  lines,
}: {
  lines: LineProvenance[];
}): React.JSX.Element {
  if (lines.length === 0) {
    return <p className="no-lines-msg">No line-level data available for this file.</p>;
  }

  // Group consecutive lines with the same classification
  interface LineGroup {
    start: number;
    end: number;
    classification: string;
  }

  const groups: LineGroup[] = [];
  for (const lp of lines) {
    const last = groups[groups.length - 1];
    if (last && last.classification === lp.classification && lp.lineNumber === last.end + 1) {
      last.end = lp.lineNumber;
    } else {
      groups.push({
        start: lp.lineNumber,
        end: lp.lineNumber,
        classification: lp.classification,
      });
    }
  }

  return (
    <div className="line-groups">
      {groups.map((g, i) => (
        <div key={i} className="line-group">
          <span
            className="line-group__dot"
            style={{ backgroundColor: CLASS_COLORS[g.classification] ?? '#9CA3AF' }}
          />
          <span className="line-group__range">
            {g.start === g.end ? `Line ${g.start}` : `Lines ${g.start}–${g.end}`}
          </span>
          <span
            className="line-group__label"
            style={{ color: CLASS_COLORS[g.classification] ?? '#9CA3AF' }}
          >
            {CLASS_LABELS[g.classification] ?? g.classification}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function FileView({ files, postMessage }: FileViewProps): React.JSX.Element {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileLines, setFileLines] = useState<LineProvenance[] | null>(null);

  useEffect(() => {
    const handler = (event: MessageEvent): void => {
      const msg = event.data as HostToWebviewMessage;
      if (msg.type === 'update-file') {
        setFileLines(msg.data);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const handleFileClick = (filePath: string): void => {
    setSelectedFile(filePath);
    setFileLines(null);
    postMessage({ type: 'request-file', filePath });
  };

  if (!files || files.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">&#128193;</div>
        <p className="empty-state__text">No files tracked yet.</p>
      </div>
    );
  }

  const sorted = [...files].sort((a, b) => b.aiPercent - a.aiPercent);

  return (
    <div className="file-view">
      <section className="section">
        <h2 className="section-title">Tracked Files</h2>
        <p className="section-meta">
          {sorted.length} file{sorted.length !== 1 ? 's' : ''} today &middot; sorted by AI% (char-weighted)
        </p>
        <div className="file-list">
          {sorted.map((f) => (
            <button
              key={f.filePath}
              className={`file-list__item${selectedFile === f.filePath ? ' file-list__item--selected' : ''}`}
              onClick={() => handleFileClick(f.filePath)}
            >
              <div className="file-list__path" title={f.filePath}>
                {f.filePath.length > 50 ? `...${f.filePath.slice(-47)}` : f.filePath}
              </div>
              <div className="file-list__stats">
                <span style={{ color: '#4ADE80' }}>H: {f.humanPercent}%</span>
                <span style={{ color: '#60A5FA' }}>AI: {f.aiPercent}%</span>
                <span className="file-list__lines">
                  {f.totalChars.toLocaleString()} chars &middot; {f.totalLines} line edits
                </span>
              </div>
              <div className="file-list__bar">
                <div
                  className="file-list__bar-fill file-list__bar-fill--human"
                  style={{ width: `${f.humanPercent}%` }}
                />
                <div
                  className="file-list__bar-fill file-list__bar-fill--ai"
                  style={{ width: `${f.aiPercent}%` }}
                />
              </div>
            </button>
          ))}
        </div>
      </section>

      {selectedFile && (
        <section className="section">
          <h2 className="section-title">Line Provenance</h2>
          <p className="section-meta file-detail__path">{selectedFile}</p>
          {fileLines === null ? (
            <p className="loading-msg">Loading...</p>
          ) : (
            <LineProvenanceList lines={fileLines} />
          )}
        </section>
      )}
    </div>
  );
}
