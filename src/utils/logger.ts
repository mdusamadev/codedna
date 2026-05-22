import * as vscode from 'vscode';
import { OUTPUT_CHANNEL_NAME } from './constants';

/**
 * Centralized logger for CodeDNA.
 * All output goes to a dedicated VS Code output channel.
 * Never use console.log in production code.
 */
export class Logger {
  private static instance: Logger | null = null;
  private readonly channel: vscode.OutputChannel;

  private constructor() {
    this.channel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  }

  /** Get the singleton logger instance */
  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /** Log informational message */
  info(message: string, ...args: unknown[]): void {
    this.log('INFO', message, ...args);
  }

  /** Log warning message */
  warn(message: string, ...args: unknown[]): void {
    this.log('WARN', message, ...args);
  }

  /** Log error message */
  error(message: string, error?: unknown): void {
    const errorDetail = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error ?? '');
    this.log('ERROR', `${message} ${errorDetail}`.trim());
  }

  /** Log debug message (only when in development) */
  debug(message: string, ...args: unknown[]): void {
    this.log('DEBUG', message, ...args);
  }

  /** Log performance metric */
  perf(label: string, durationMs: number): void {
    this.log('PERF', `${label}: ${durationMs.toFixed(2)}ms`);
    if (durationMs > 20) {
      this.warn(`Slow operation: ${label} took ${durationMs.toFixed(2)}ms`);
    }
  }

  /** Show the output channel to the user */
  show(): void {
    this.channel.show();
  }

  /** Dispose the output channel */
  dispose(): void {
    this.channel.dispose();
    Logger.instance = null;
  }

  private log(level: string, message: string, ...args: unknown[]): void {
    const timestamp = new Date().toISOString();
    const formatted = args.length > 0 ? `${message} ${JSON.stringify(args)}` : message;
    this.channel.appendLine(`[${timestamp}] [${level}] ${formatted}`);
  }
}
