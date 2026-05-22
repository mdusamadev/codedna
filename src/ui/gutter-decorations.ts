import * as vscode from 'vscode';
import { COLORS } from '../utils/constants';
import { Logger } from '../utils/logger';
import { formatProvenanceTimestamp, provenanceDisplay } from '../utils/provenance-label';
import type { Classification, LineProvenance } from '../utils/types';

/** Per-line provenance stored for gutter rendering. */
interface LineEntry {
  readonly classification: Classification;
  readonly lastUpdated: number;
}

/**
 * Callback signature that matches Classifier.getFileProvenance().
 */
type ProvenanceFn = (filePath: string) => ReadonlyMap<number, LineEntry>;

/** Loads persisted per-line provenance (e.g. from SQLite edit history). */
type PersistedProvenanceFn = (filePath: string) => readonly LineProvenance[];

/**
 * Live gutter decorations showing per-line AI provenance with labels and timestamps.
 */
export class GutterDecorations implements vscode.Disposable {
  private enabled: boolean;
  private readonly logger = Logger.getInstance();

  private readonly humanDecoration: vscode.TextEditorDecorationType;
  private readonly aiDecoration: vscode.TextEditorDecorationType;
  private readonly aiModifiedDecoration: vscode.TextEditorDecorationType;
  private readonly ambiguousDecoration: vscode.TextEditorDecorationType;

  private readonly disposables: vscode.Disposable[] = [];
  private updateDebounce: ReturnType<typeof setTimeout> | null = null;

  readonly lineMap = new Map<string, Map<number, LineEntry>>();

  private readonly getProvenance: ProvenanceFn | null;
  private readonly loadPersistedProvenance: PersistedProvenanceFn | null;

  constructor(
    getProvenanceOrEnabled?: ProvenanceFn | boolean,
    initiallyEnabled = false,
    loadPersistedProvenance?: PersistedProvenanceFn,
  ) {
    if (typeof getProvenanceOrEnabled === 'boolean') {
      this.getProvenance = null;
      this.enabled = getProvenanceOrEnabled;
      this.loadPersistedProvenance = loadPersistedProvenance ?? null;
    } else {
      this.getProvenance = getProvenanceOrEnabled ?? null;
      this.enabled = initiallyEnabled;
      this.loadPersistedProvenance = loadPersistedProvenance ?? null;
    }

    const lineDecorationBase = { isWholeLine: true as const };
    this.humanDecoration = vscode.window.createTextEditorDecorationType({
      ...lineDecorationBase,
      backgroundColor: COLORS.HUMAN_BG,
    });
    this.aiDecoration = vscode.window.createTextEditorDecorationType({
      ...lineDecorationBase,
      backgroundColor: COLORS.AI_GENERATED_BG,
    });
    this.aiModifiedDecoration = vscode.window.createTextEditorDecorationType({
      ...lineDecorationBase,
      backgroundColor: COLORS.AI_MODIFIED_BG,
    });
    this.ambiguousDecoration = vscode.window.createTextEditorDecorationType({
      ...lineDecorationBase,
      backgroundColor: COLORS.AMBIGUOUS_BG,
    });

    if (this.getProvenance || this.loadPersistedProvenance) {
      this.disposables.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
          if (editor && this.enabled) {
            this.loadAndApply(editor);
          }
        }),
      );
    }

    this.logger.info(`Gutter decorations initialized (enabled=${this.enabled})`);
  }

  toggle(): void {
    this.enabled = !this.enabled;
    this.logger.info(`Gutter decorations ${this.enabled ? 'enabled' : 'disabled'}`);

    for (const editor of vscode.window.visibleTextEditors) {
      if (this.enabled) {
        this.loadProvenanceForEditor(editor);
        this.applyDecorations(editor);
      } else {
        this.clearDecorations(editor);
      }
    }
  }

  /** Reload provenance from DB + classifier for all visible editors. */
  refreshVisibleEditors(): void {
    if (!this.enabled) return;
    for (const editor of vscode.window.visibleTextEditors) {
      this.loadAndApply(editor);
    }
  }

  setLineClassification(
    filePath: string,
    line: number,
    cls: Classification,
    lastUpdated = Date.now(),
  ): void {
    let fileLines = this.lineMap.get(filePath);
    if (!fileLines) {
      fileLines = new Map<number, LineEntry>();
      this.lineMap.set(filePath, fileLines);
    }
    fileLines.set(line, { classification: cls, lastUpdated });

    if (!this.enabled) return;

    this.scheduleUpdate(filePath);
  }

  notifyFileUpdated(workspaceRelativePath: string): void {
    if (!this.enabled) return;

    if (this.loadPersistedProvenance) {
      this.mergeProvenanceFromRows(
        workspaceRelativePath,
        this.loadPersistedProvenance(workspaceRelativePath),
      );
    }
    if (this.getProvenance) {
      this.mergeProvenance(workspaceRelativePath, this.getProvenance(workspaceRelativePath));
    }
    this.scheduleUpdate(workspaceRelativePath);
  }

  updateEditor(editor: vscode.TextEditor): void {
    if (this.enabled) {
      this.applyDecorations(editor);
    } else {
      this.clearDecorations(editor);
    }
  }

  dispose(): void {
    if (this.updateDebounce !== null) {
      clearTimeout(this.updateDebounce);
      this.updateDebounce = null;
    }
    this.humanDecoration.dispose();
    this.aiDecoration.dispose();
    this.aiModifiedDecoration.dispose();
    this.ambiguousDecoration.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.logger.info('Gutter decorations disposed');
  }

  private loadAndApply(editor: vscode.TextEditor): void {
    this.loadProvenanceForEditor(editor);
    this.applyDecorations(editor);
  }

  /**
   * Merge DB history first, then in-memory classifier state (session wins on overlap).
   */
  private loadProvenanceForEditor(editor: vscode.TextEditor): void {
    const relPath = this.relativePathFor(editor);
    const absPath = editor.document.fileName;

    if (this.loadPersistedProvenance) {
      const rows = this.loadPersistedProvenance(relPath);
      this.mergeProvenanceFromRows(relPath, rows);
      if (absPath !== relPath) {
        this.mergeProvenanceFromRows(absPath, rows);
      }
    }

    if (this.getProvenance) {
      const live = this.getProvenance(relPath);
      this.mergeProvenance(relPath, live);
      if (absPath !== relPath) {
        this.mergeProvenance(absPath, live);
      }
    }
  }

  private mergeProvenanceFromRows(key: string, rows: readonly LineProvenance[]): void {
    if (rows.length === 0) return;
    let fileLines = this.lineMap.get(key);
    if (!fileLines) {
      fileLines = new Map();
      this.lineMap.set(key, fileLines);
    }
    for (const row of rows) {
      fileLines.set(row.lineNumber, {
        classification: row.classification,
        lastUpdated: row.lastUpdated,
      });
    }
  }

  private mergeProvenance(key: string, provenance: ReadonlyMap<number, LineEntry>): void {
    if (provenance.size === 0) return;
    let fileLines = this.lineMap.get(key);
    if (!fileLines) {
      fileLines = new Map();
      this.lineMap.set(key, fileLines);
    }
    for (const [line, info] of provenance) {
      fileLines.set(line, info);
    }
  }

  private scheduleUpdate(filePath: string): void {
    if (this.updateDebounce !== null) {
      clearTimeout(this.updateDebounce);
    }
    this.updateDebounce = setTimeout(() => {
      this.updateDebounce = null;
      for (const editor of vscode.window.visibleTextEditors) {
        const editorPath = editor.document.fileName;
        const relPath = this.relativePathFor(editor);
        if (editorPath === filePath || relPath === filePath) {
          this.applyDecorations(editor);
        }
      }
    }, 300);
  }

  private makeDecorationOption(
    line: number,
    entry: LineEntry,
  ): vscode.DecorationOptions {
    const { gutterText, hoverTitle, color } = provenanceDisplay(
      entry.classification,
      entry.lastUpdated,
    );
    return {
      range: new vscode.Range(line, 0, line, 0),
      hoverMessage: `${hoverTitle}\n\n${formatProvenanceTimestamp(entry.lastUpdated)}`,
      renderOptions: {
        before: {
          contentText: gutterText,
          color,
          margin: '0 12px 0 2px',
          fontStyle: 'italic',
        },
      },
    };
  }

  private applyDecorations(editor: vscode.TextEditor): void {
    const absPath = editor.document.fileName;
    const relPath = this.relativePathFor(editor);
    const fileLines = this.lineMap.get(relPath) ?? this.lineMap.get(absPath);

    const humanRanges: vscode.DecorationOptions[] = [];
    const aiRanges: vscode.DecorationOptions[] = [];
    const aiModifiedRanges: vscode.DecorationOptions[] = [];
    const ambiguousRanges: vscode.DecorationOptions[] = [];

    if (fileLines) {
      for (const [line, entry] of fileLines) {
        if (line >= editor.document.lineCount) continue;
        const option = this.makeDecorationOption(line, entry);
        switch (entry.classification) {
          case 'human':
            humanRanges.push(option);
            break;
          case 'ai_generated':
            aiRanges.push(option);
            break;
          case 'ai_modified':
            aiModifiedRanges.push(option);
            break;
          case 'ambiguous':
            ambiguousRanges.push(option);
            break;
        }
      }
    }

    editor.setDecorations(this.humanDecoration, humanRanges);
    editor.setDecorations(this.aiDecoration, aiRanges);
    editor.setDecorations(this.aiModifiedDecoration, aiModifiedRanges);
    editor.setDecorations(this.ambiguousDecoration, ambiguousRanges);
  }

  private clearDecorations(editor: vscode.TextEditor): void {
    editor.setDecorations(this.humanDecoration, []);
    editor.setDecorations(this.aiDecoration, []);
    editor.setDecorations(this.aiModifiedDecoration, []);
    editor.setDecorations(this.ambiguousDecoration, []);
  }

  private relativePathFor(editor: vscode.TextEditor): string {
    try {
      return vscode.workspace.asRelativePath(editor.document.fileName, false);
    } catch {
      return editor.document.fileName;
    }
  }
}
