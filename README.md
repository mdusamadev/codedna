# CodeDNA

**See the DNA of your codebase — which lines are human-written and which are AI-assisted.**

CodeDNA tracks every edit in real time and classifies it as **Human**, **AI-Generated**, **AI-Modified**, or **Ambiguous**. All data stays on your machine — zero telemetry, zero cloud.

## Features

- **Real-time status bar** — Live H/AI ratio as you type
- **Gutter decorations** — Color-coded line provenance (green=human, blue=AI, amber=modified)
- **Analytics dashboard** — Today view, trends over time, per-file breakdown
- **AI tool detection** — Automatically detects Claude Code, Cursor agent, Aider
- **Private by default** — All data stored locally in SQLite, never transmitted

## Quick Start

1. Install CodeDNA from the VS Code Marketplace
2. Start coding — the status bar shows your live ratio immediately
3. Run **CodeDNA: Open Dashboard** to see full analytics

## Classification Logic

| Event | Classification | Confidence |
|-------|---------------|------------|
| Keystroke within 200ms + small edit | Human | 95% |
| Multi-line insertion without keystroke | AI-Generated | 90% |
| Known AI process active + no keystroke | AI-Generated | 85% |
| Human edit on AI-generated line | AI-Modified | 80% |
| Everything else | Ambiguous | 50% |

## Privacy

- **Zero source code storage** — Only metadata is tracked (timestamps, line counts, classifications)
- **Zero network requests** — No telemetry, no cloud sync
- **Local SQLite** — All data stored in VS Code's extension storage directory
- **You own your data** — Export or reset at any time

## Commands

| Command | Description |
|---------|-------------|
| `CodeDNA: Open Dashboard` | Open the analytics dashboard |
| `CodeDNA: Toggle Line Provenance` | Show/hide gutter decorations |
| `CodeDNA: Export Data as JSON` | Export all tracking data |
| `CodeDNA: Reset All Data` | Delete all tracking data |
| `CodeDNA: Show Diagnostics` | Display extension diagnostics |
| `CodeDNA: Send Feedback` | Share feedback with the team |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `codedna.enabled` | `true` | Master toggle |
| `codedna.statusBar.visible` | `true` | Show status bar indicator |
| `codedna.statusBar.mode` | `session` | `session` or `daily` stats |
| `codedna.gutter.enabled` | `false` | Show gutter decorations by default |
| `codedna.classification.keystrokeWindowMs` | `200` | Keystroke correlation window (ms) |
| `codedna.classification.batchThreshold` | `3` | Min lines for AI batch detection |
| `codedna.retention.days` | `90` | Days to retain data |

## Works With

- VS Code 1.85+
- Cursor
- Claude Code
- GitHub Copilot (detection via process name)
- Aider

## License

MIT — see [LICENSE](LICENSE)
