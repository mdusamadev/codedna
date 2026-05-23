# CodeDNA Manual Test Checklist

Run this checklist before every release. Test in both VS Code and Cursor.

---

## Version Information

| Field                  | Value |
|------------------------|-------|
| Extension version      |       |
| VS Code version        |       |
| Cursor version         |       |
| OS / Platform          |       |
| Node.js version        |       |
| Date tested            |       |
| Tested by              |       |

---

## 1. Extension Activation

- [ ] Extension activates without errors on VS Code startup
- [ ] Extension activates without errors on Cursor startup
- [ ] Output channel "CodeDNA" appears in the Output panel
- [ ] Status bar item appears in the bottom bar after activation
- [ ] No error notifications appear on activation

---

## 2. Status Bar

- [ ] Status bar shows `$(pulse) CodeDNA: Waiting for edits...` before any typing
- [ ] Status bar updates within ~3 seconds after typing begins
- [ ] Status bar format matches `✅ H: X% | 🤖 AI: Y% | ❓ Z%`
- [ ] Clicking the status bar item opens the CodeDNA dashboard
- [ ] Status bar tooltip shows breakdown (human chars, AI chars, other chars)
- [ ] Status bar disappears when `codedna.statusBar.visible` is set to `false`
- [ ] Status bar reappears when `codedna.statusBar.visible` is set back to `true`
- [ ] Status bar is hidden when `codedna.enabled` is `false`

---

## 3. Human Edit Classification

- [ ] Typing individual characters is classified as `human` (green gutter decorations)
- [ ] Deleting characters with Backspace/Delete is classified as `human`
- [ ] Small word completions accepted via IntelliSense (≤4 chars) appear as `human`
- [ ] Status bar human percentage increases after manual typing

### IDE snippets and deterministic completions (human)

- [ ] **Flutter/Dart**: type `stl` → Tab → StatelessWidget scaffold → `human` (not AI/ambiguous)
- [ ] **TypeScript**: `for` snippet expansion → `human`
- [ ] **HTML/Emmet**: `div.container` → Tab → expanded markup → `human`
- [ ] **Python**: `def` function scaffold → `human`
- [ ] Auto-import on accept (organize imports / quick fix) → `human`
- [ ] **Copilot ghost text** Tab accept follows `codedna.classification.tabCompletionMode` (default `ai_generated`), not forced human
- [ ] **Cmd+V** multi-line paste without prefix replacement → `ambiguous` (not human)

---

## 4. AI Edit Classification

- [ ] Pasting a block ≥ 3 lines with no active AI process is classified as `ai_generated`
- [ ] AI-generated blocks appear with blue gutter decorations (when gutter is enabled)
- [ ] With `claude` CLI running: multi-line insertions are classified as `ai_generated` with `sourceHint=claude`
- [ ] With `cursor-agent` running: multi-line insertions are classified as `ai_generated` with `sourceHint=cursor`
- [ ] AI percentage in status bar increases after an AI-generated block is inserted

---

## 5. AI-Modified Classification

- [ ] Manually editing a line previously classified as `ai_generated` reclassifies it to `ai_modified`
- [ ] Gutter color for `ai_modified` lines changes to amber/yellow
- [ ] The reclassification happens within ~3 seconds of the edit

---

## 6. Ambiguous Classification

- [ ] Copy-pasting code (Cmd+V / Ctrl+V with large text) is classified as `ambiguous`
- [ ] Ambiguous lines show gray gutter decorations
- [ ] Ambiguous percentage appears in the status bar

---

## 7. Gutter Decorations

- [ ] Gutter decorations are OFF by default (no colored lines on startup)
- [ ] Enabling `codedna.gutter.enabled` turns on gutter decorations
- [ ] Green lines = human, Blue lines = ai_generated, Amber lines = ai_modified, Gray lines = ambiguous
- [ ] Switching between files preserves gutter decoration state
- [ ] Gutter decorations update after reclassification events

---

## 8. Dashboard

- [ ] Dashboard opens via command palette: `CodeDNA: Open Dashboard`
- [ ] Dashboard opens via status bar click
- [ ] "Today" view shows correct session statistics
- [ ] Human %, AI %, and Ambiguous % in the dashboard match the status bar
- [ ] "Trends" view renders without error (chart loads)
- [ ] "Files" view lists tracked files with per-file percentages
- [ ] Dashboard updates when new edits occur (no manual refresh needed)

---

## 9. Process Monitor

- [ ] With no AI process running: `sourceHint` for large inserts is `unknown`
- [ ] Starting `claude` CLI in terminal: process is detected within ~2 seconds
- [ ] Stopping `claude` CLI: process deactivation is detected within ~2 seconds
- [ ] No errors in the Output channel related to process monitoring

---

## 10. Data Persistence

- [ ] Closing and reopening VS Code/Cursor preserves historical data in the dashboard
- [ ] Data is stored locally (no network requests observed in DevTools / proxying tool)
- [ ] Database file is located at VS Code `globalStorageUri` path (not in workspace)

---

## 11. Settings

- [ ] `codedna.enabled`: Setting to `false` stops all event tracking immediately
- [ ] `codedna.classification.keystrokeWindowMs`: Changing the value affects classification timing
- [ ] `codedna.classification.batchThreshold`: Changing the value affects batch-insert detection
- [ ] `codedna.retention.days`: Reducing the value prunes old data on next startup
- [ ] `codedna.excludePaths`: Adding `src/**` stops tracking files under `src/`

---

## 12. Excluded Paths

- [ ] Edits in `node_modules/` are NOT tracked
- [ ] Edits in `.git/` are NOT tracked
- [ ] Edits in `dist/` are NOT tracked
- [ ] Edits in lockfiles (`package-lock.json`, `pnpm-lock.yaml`) are NOT tracked
- [ ] Edits in `src/` ARE tracked by default

---

## 13. Git Commit Hook (optional feature)

- [ ] `CodeDNA: Install Git Hook` command installs the pre-commit hook without errors
- [ ] Making a commit includes a CodeDNA summary in the commit message (when enabled)
- [ ] `CodeDNA: Uninstall Git Hook` removes the hook cleanly

---

## 14. Commands

- [ ] `CodeDNA: Open Dashboard` opens the dashboard panel
- [ ] `CodeDNA: Toggle Gutter Decorations` toggles gutter on/off
- [ ] `CodeDNA: Export Data` exports data without errors
- [ ] `CodeDNA: Reset Data` clears the database after confirmation
- [ ] `CodeDNA: Show Diagnostics` displays extension diagnostic info

---

## 15. Performance

- [ ] Typing at normal speed shows no perceptible lag
- [ ] No "Extension host is not responding" warnings appear during heavy editing
- [ ] Dashboard opens within 500ms
- [ ] Classification latency (visible in Output channel if > 20ms) stays below 20ms in normal use

---

## 16. Cursor-Specific

- [ ] Extension loads in Cursor without "incompatible extension" warnings
- [ ] All status bar, gutter, and dashboard features work identically in Cursor
- [ ] `cursor-agent` process is correctly detected when Cursor AI is generating code
- [ ] No Cursor-only VS Code API usage causes errors (check Output channel)

---

## 17. Error Handling

- [ ] Disabling the extension mid-session and re-enabling it resumes tracking correctly
- [ ] Deleting the database file manually causes the extension to recreate it on next activation
- [ ] Opening a file from a scheme other than `file://` or `untitled://` does not cause errors
- [ ] Opening a workspace with no folders does not crash the extension

---

## Sign-off

| Reviewer | Result | Notes |
|----------|--------|-------|
|          | PASS / FAIL |       |
