# Contributing to CodeDNA

Thank you for your interest in contributing. This document covers how to set up the development environment, the conventions used in this project, and how to submit changes.

---

## Development Environment Setup

**Prerequisites:** Node.js 20+, pnpm (or npm), VS Code 1.85+.

```bash
# 1. Clone the repository
git clone https://github.com/codedna/codedna.git
cd codedna

# 2. Install dependencies (extension host)
npm install

# 3. Install dashboard UI dependencies
cd webview-ui && npm install && cd ..

# 4. Build the extension
npm run build

# 5. Build the dashboard
npm run build:webview
```

To develop with live recompilation, open two terminals:

```bash
# Terminal 1 — watch the extension source
npm run watch

# Terminal 2 — watch the dashboard UI
cd webview-ui && npm run dev
```

Then press `F5` in VS Code to launch the Extension Development Host.

---

## Running Tests

```bash
# Unit tests (fast, no VS Code host required)
npm test

# Watch mode
npm run test:watch

# Integration tests (requires a full VS Code host)
npm run test:integration
```

All tests must pass before opening a pull request. The CI pipeline runs `npm run lint`, `npm test`, and `npm run build` on every push and PR against `main`.

---

## Branch Naming

| Type | Prefix | Example |
|------|--------|---------|
| New feature | `feat/` | `feat/weekly-summary-notification` |
| Bug fix | `fix/` | `fix/lru-eviction-off-by-one` |
| Refactor | `refactor/` | `refactor/write-buffer-async` |
| Tests | `test/` | `test/classifier-batch-cases` |
| Documentation | `docs/` | `docs/contributing-guide` |

---

## Commit Message Format

This project uses [Conventional Commits](https://www.conventionalcommits.org/).

```
<type>(<optional scope>): <short summary>

[optional body]

[optional footer]
```

**Types:** `feat`, `fix`, `test`, `docs`, `refactor`, `perf`, `chore`.

Examples:

```
feat(classifier): add paste detection heuristic
fix(write-buffer): prevent double-flush on deactivation
test(classifier): add batch insertion edge cases
docs: update CONTRIBUTING setup steps
```

---

## Architecture Overview

Before making changes, read [CLAUDE.md](CLAUDE.md) for the full architecture reference. Key points:

- **Zero source code storage** — never store actual code content in the database, only metadata.
- **Zero network requests** — no telemetry, no cloud calls.
- **< 50ms classification latency** — the `classify()` method must not block typing.
- **Cursor compatibility** — test in both VS Code and Cursor before submitting.

The classification decision tree, database schema, write buffer rules, and gutter color palette are all defined in CLAUDE.md and must be kept in sync with the implementation.

---

## Pull Request Checklist

- [ ] `npm run lint` passes with no errors
- [ ] `npm test` passes
- [ ] `npm run build` succeeds
- [ ] New behaviour is covered by tests
- [ ] CLAUDE.md architecture constraints are not violated
- [ ] CHANGELOG.md updated if the change is user-visible
