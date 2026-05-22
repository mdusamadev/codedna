import * as vscode from 'vscode';
import { Logger } from './utils/logger';
import { COMMANDS, EXTENSION_NAME } from './utils/constants';
import type { RawEditEvent, SourceHint } from './utils/types';
import { Settings } from './config/settings';
import { SessionManager } from './core/session-manager';
import { EventListener } from './core/event-listener';
import { FileIngestion } from './core/file-ingestion';
import { FileWatcher } from './core/file-watcher';
import { ProcessMonitor } from './core/process-monitor';
import { Classifier } from './core/classifier';
import { StatusBar } from './ui/status-bar';
import { GutterDecorations } from './ui/gutter-decorations';
import { WebviewProvider } from './ui/webview-provider';
import { Database } from './storage/database';
import { WriteBuffer } from './storage/write-buffer';
import { RetentionManager } from './storage/retention';
import { CommitHook } from './git/commit-hook';

/**
 * Extension activation entry point.
 * Wires all components together and sets up the event pipeline:
 * EventListener → Classifier → WriteBuffer + StatusBar
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const logger = Logger.getInstance();

  try {
    logger.info(`${EXTENSION_NAME} activating...`);

    // ── Core services ──
    const settings = new Settings();
    const session = new SessionManager();
    const processMonitor = new ProcessMonitor();
    const eventListener = new EventListener(settings);

    // ── Storage ──
    const db = new Database();
    const storagePath = context.globalStorageUri.fsPath;
    await db.initialize(storagePath);

    if (db.inMemoryMode) {
      void vscode.window.showWarningMessage(
        'CodeDNA: Database failed to load. Edit events will not be persisted this session.',
      );
    }

    const writeBuffer = new WriteBuffer(db);
    const retention = new RetentionManager(db, settings);
    retention.start();

    // ── Classification ──
    const classifier = new Classifier(settings, {
      getLastKeystrokeTimestamp: (): number => eventListener.getLastKeystrokeTimestamp(),
      isAIProcessActive: (): boolean => processMonitor.isAIProcessActive(),
      getActiveAIProcess: (): SourceHint => processMonitor.getActiveAIProcess(),
      sessionId: session.sessionId,
    });

    // ── UI ──
    const statusBar = new StatusBar(settings);
    const gutter = new GutterDecorations(
      (fp) => classifier.getFileProvenance(fp),
      settings.gutterEnabled,
      (fp) => db.getFileProvenance(fp),
    );
    const webview = new WebviewProvider(db, writeBuffer);

    // ── Git hook ──
    const commitHook = new CommitHook();

    const processEdit = (rawEvent: RawEditEvent): void => {
      try {
        const classified = classifier.classify(rawEvent);
        if (classified) {
          writeBuffer.push(classified);
          statusBar.recordEvent(classified);
          gutter.notifyFileUpdated(classified.filePath);
        }
      } catch (pipelineErr) {
        logger.error('Classification pipeline error', pipelineErr);
      }
    };

    // ── Event pipeline (live edits) ──
    eventListener.onEdit(processEdit);

    // ── AI / disk-created files (no onDidChangeTextDocument for initial content) ──
    const fileWatcher = new FileWatcher(settings);
    const fileIngestion = new FileIngestion(
      processEdit,
      (fp) => db.hasEventsForFile(fp),
      settings.excludePaths,
    );
    fileWatcher.onExternalChange((relativePath) => {
      fileIngestion.handleExternalPath(relativePath);
    });

    // ── Commands ──
    context.subscriptions.push(
      vscode.commands.registerCommand(COMMANDS.OPEN_DASHBOARD, () => {
        webview.openDashboard(context.extensionUri);
      }),

      vscode.commands.registerCommand(COMMANDS.TOGGLE_GUTTER, () => {
        writeBuffer.flush();
        gutter.toggle();
      }),

      vscode.commands.registerCommand(COMMANDS.EXPORT_DATA, async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const firstFolder = workspaceFolders?.[0];
        if (!firstFolder) {
          void vscode.window.showWarningMessage('CodeDNA: No workspace folder open — cannot export.');
          return;
        }
        try {
          writeBuffer.flush(); // ensure latest events are persisted
          const summary = db.getTodaySummary();
          const trends = db.getTrends(
            new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10),
            new Date().toISOString().slice(0, 10),
          );
          const exportData = {
            exportedAt: new Date().toISOString(),
            version: '0.1.0',
            todaySummary: summary,
            trends,
            eventCount: db.getEventCount(),
          };
          const date = new Date().toISOString().slice(0, 10);
          const fileName = `codedna-export-${date}.json`;
          const exportPath = vscode.Uri.joinPath(firstFolder.uri, fileName);
          const content = Buffer.from(JSON.stringify(exportData, null, 2));
          await vscode.workspace.fs.writeFile(exportPath, content);
          const action = await vscode.window.showInformationMessage(
            `CodeDNA: Data exported to ${fileName}`,
            'Open File',
          );
          if (action === 'Open File') {
            void vscode.workspace.openTextDocument(exportPath).then((doc) =>
              vscode.window.showTextDocument(doc),
            );
          }
          logger.info(`Data exported to: ${exportPath.fsPath}`);
        } catch (exportErr) {
          logger.error('Export failed', exportErr);
          void vscode.window.showErrorMessage('CodeDNA: Export failed — see output channel for details.');
        }
      }),

      vscode.commands.registerCommand(COMMANDS.RESET_DATA, async () => {
        const confirm = await vscode.window.showWarningMessage(
          'CodeDNA: This will permanently delete all tracking data. This cannot be undone.',
          { modal: true },
          'Delete All Data',
        );
        if (confirm === 'Delete All Data') {
          db.resetAllData();
          statusBar.reset();
          classifier.clearLineMap();
          logger.info('All data reset by user');
          void vscode.window.showInformationMessage('CodeDNA: All data has been cleared.');
        }
      }),

      vscode.commands.registerCommand(COMMANDS.SHOW_DIAGNOSTICS, () => {
        logger.show();
        const eventCount = db.getEventCount();
        void vscode.window.showInformationMessage(
          `CodeDNA Diagnostics\n` +
            `Session: ${session.sessionId}\n` +
            `Duration: ${Math.round(session.durationMs / 1000)}s\n` +
            `Buffer: ${writeBuffer.getBufferSize()} events pending\n` +
            `Total Events: ${eventCount}\n` +
            `AI Process: ${processMonitor.isAIProcessActive() ? processMonitor.getActiveAIProcess() : 'none'}`,
        );
      }),

      vscode.commands.registerCommand(COMMANDS.INSTALL_GIT_HOOK, () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const firstFolder = workspaceFolders?.[0];
        if (!firstFolder) {
          void vscode.window.showWarningMessage('CodeDNA: No workspace folder open.');
          return;
        }
        commitHook.install(firstFolder.uri.fsPath);
      }),

      vscode.commands.registerCommand(COMMANDS.UNINSTALL_GIT_HOOK, () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const firstFolder = workspaceFolders?.[0];
        if (!firstFolder) {
          void vscode.window.showWarningMessage('CodeDNA: No workspace folder open.');
          return;
        }
        commitHook.uninstall(firstFolder.uri.fsPath);
      }),

      vscode.commands.registerCommand(COMMANDS.SEND_FEEDBACK, async () => {
        const rating = await vscode.window.showQuickPick(
          ['⭐ 1 — Not useful', '⭐⭐ 2 — Needs work', '⭐⭐⭐ 3 — Decent', '⭐⭐⭐⭐ 4 — Good', '⭐⭐⭐⭐⭐ 5 — Love it'],
          { placeHolder: 'How would you rate CodeDNA?', title: 'CodeDNA Feedback' },
        );
        if (!rating) return;

        const feedback = await vscode.window.showInputBox({
          prompt: 'Any specific feedback? (optional)',
          placeHolder: 'What could be improved?',
        });

        // Store locally in global state
        const existing = context.globalState.get<Array<{ rating: string; feedback: string; date: string }>>(
          'codedna.feedback',
          [],
        );
        await context.globalState.update('codedna.feedback', [
          ...existing,
          { rating, feedback: feedback ?? '', date: new Date().toISOString() },
        ]);

        void vscode.window.showInformationMessage('Thanks for your feedback! It helps us improve CodeDNA.');
      }),
    );

    // Paint gutter for already-open files using persisted edit history
    if (settings.gutterEnabled && !db.inMemoryMode) {
      writeBuffer.flush();
      gutter.refreshVisibleEditors();
    }

    // ── Register disposables ──
    context.subscriptions.push(
      eventListener,
      fileWatcher,
      fileIngestion,
      processMonitor,
      statusBar,
      gutter,
      webview,
      { dispose: () => writeBuffer.dispose() },
      { dispose: () => retention.dispose() },
      { dispose: () => db.close() },
      { dispose: () => logger.dispose() },
    );

    // ── First-time welcome ──
    const hasShownWelcome = context.globalState.get<boolean>('codedna.welcomeShown', false);
    if (!hasShownWelcome) {
      const action = await vscode.window.showInformationMessage(
        '🧬 CodeDNA is now tracking your coding patterns. All data stays on your machine.',
        'Open Dashboard',
        'Got It',
      );
      if (action === 'Open Dashboard') {
        webview.openDashboard(context.extensionUri);
      }
      await context.globalState.update('codedna.welcomeShown', true);
    }

    // ── Weekly summary (opt-in) ──
    if (settings.weeklySummary) {
      const lastSummary = context.globalState.get<number>('codedna.lastWeeklySummary', 0);
      const oneWeek = 7 * 24 * 60 * 60 * 1000;
      if (Date.now() - lastSummary > oneWeek) {
        const summary = db.getTodaySummary();
        if (summary.totalLines > 0) {
          const msg = `CodeDNA Weekly: ${summary.humanPercent}% human, ${summary.aiPercent}% AI-assisted, ${summary.aiReviewRate}% AI review rate.`;
          const action = await vscode.window.showInformationMessage(msg, 'View Dashboard');
          if (action === 'View Dashboard') webview.openDashboard(context.extensionUri);
          await context.globalState.update('codedna.lastWeeklySummary', Date.now());
        }
      }
    }

    logger.info(`${EXTENSION_NAME} activated successfully (session: ${session.sessionId})`);
  } catch (err) {
    logger.error('Failed to activate CodeDNA', err);
    const action = await vscode.window.showErrorMessage(
      `CodeDNA failed to activate: ${err instanceof Error ? err.message : 'Unknown error'}`,
      'Show Output',
      'Report Issue',
    );
    if (action === 'Show Output') logger.show();
    if (action === 'Report Issue') {
      void vscode.env.openExternal(vscode.Uri.parse('https://github.com/codedna/codedna/issues'));
    }
  }
}

/** Extension deactivation */
export function deactivate(): void {
  // All cleanup handled via context.subscriptions disposables
  const logger = Logger.getInstance();
  logger.info(`${EXTENSION_NAME} deactivated`);
}
