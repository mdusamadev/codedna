import React, { useEffect, useState } from 'react';
import TodayView from './TodayView';
import TrendsView from './TrendsView';
import FileView from './FileView';
import type {
  TodaySummary,
  TrendEntry,
  FileBreakdownEntry,
  HostToWebviewMessage,
} from './types';
import './styles.css';

declare function acquireVsCodeApi(): {
  postMessage: (msg: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

/** Must be called once per webview — not inside useRef (Strict Mode remounts re-run ref init). */
const vscodeApi = acquireVsCodeApi();

type Tab = 'today' | 'trends' | 'files';

interface AppState {
  activeTab: Tab;
  todayData: TodaySummary | null;
  trendsData: TrendEntry[] | null;
  filesData: FileBreakdownEntry[] | null;
  trendsRange: '7d' | '30d' | '90d';
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'trends', label: 'Trends' },
  { id: 'files', label: 'Files' },
];

export default function App(): React.JSX.Element {
  const [state, setState] = useState<AppState>({
    activeTab: 'today',
    todayData: null,
    trendsData: null,
    filesData: null,
    trendsRange: '7d',
  });

  const postMessage = (msg: unknown): void => {
    vscodeApi.postMessage(msg);
  };

  // Request data for a given tab
  const requestTabData = (tab: Tab, range: '7d' | '30d' | '90d' = '7d'): void => {
    if (tab === 'today') {
      postMessage({ type: 'request-today' });
    } else if (tab === 'trends') {
      postMessage({ type: 'request-trends', range });
    } else if (tab === 'files') {
      postMessage({ type: 'request-files-list' });
    }
  };

  // Listen for messages from the extension host
  useEffect(() => {
    const handler = (event: MessageEvent): void => {
      const msg = event.data as HostToWebviewMessage;
      switch (msg.type) {
        case 'update-today':
          setState((prev) => ({ ...prev, todayData: msg.data }));
          break;
        case 'update-trends':
          setState((prev) => ({ ...prev, trendsData: msg.data }));
          break;
        case 'update-files-list':
          setState((prev) => ({ ...prev, filesData: msg.data }));
          break;
        case 'update-file':
          // Handled by FileView internally via message events
          break;
        case 'error':
          console.error('CodeDNA host error:', msg.message);
          break;
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Request initial data on mount
  useEffect(() => {
    requestTabData('today');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTabChange = (tab: Tab): void => {
    setState((prev) => ({ ...prev, activeTab: tab }));
    requestTabData(tab, state.trendsRange);
  };

  const handleRangeChange = (range: string): void => {
    const r = range as '7d' | '30d' | '90d';
    setState((prev) => ({ ...prev, trendsRange: r }));
    postMessage({ type: 'request-trends', range: r });
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          <span className="app-icon">&#129516;</span>
          <span>CodeDNA</span>
        </div>
        <nav className="tab-bar" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={state.activeTab === t.id}
              className={`tab-button${state.activeTab === t.id ? ' tab-button--active' : ''}`}
              onClick={() => handleTabChange(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="app-content">
        {state.activeTab === 'today' && <TodayView data={state.todayData} />}
        {state.activeTab === 'trends' && (
          <TrendsView
            data={state.trendsData}
            range={state.trendsRange}
            onRangeChange={handleRangeChange}
          />
        )}
        {state.activeTab === 'files' && (
          <FileView files={state.filesData} postMessage={postMessage} />
        )}
      </main>
    </div>
  );
}
