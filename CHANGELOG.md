# Changelog

## [0.1.0] — 2026-05-22

### Added
- Real-time edit classification (human / AI-generated / AI-modified / ambiguous)
- Status bar indicator with live H/AI ratio
- Keystroke correlation engine (200ms window)
- Batch insertion detection (3+ line threshold)
- Claude Code, Cursor agent, and Aider process detection
- Analytics dashboard with Today view, Trends, and Per-File breakdown
- Gutter decorations (color-coded line provenance)
- SQLite-backed persistence with WAL mode
- Automatic data pruning (configurable retention period)
- Export and Reset commands
- Git commit hook integration (opt-in)
- Weekly summary notifications (opt-in)

## [0.1.3] - 2026-05-23

### Fixed
- IDE snippets and intellisense (Emmet, auto-imports) now correctly classified as human
- Keystroke tracking gracefully falls back when 'type' command is unavailable

### Improved
- Accurate distinction between IDE snippets and AI inline completions
- Better error handling during extension startup