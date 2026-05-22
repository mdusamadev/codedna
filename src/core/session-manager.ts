import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { Logger } from '../utils/logger';
import type { Session } from '../utils/types';

/**
 * Manages the editing session lifecycle.
 * A session starts when the extension activates and ends on deactivation.
 * Each session gets a unique ID used to group edit events.
 */
export class SessionManager {
  private readonly logger = Logger.getInstance();
  private currentSession: Session;

  constructor() {
    this.currentSession = this.createSession();
    this.logger.info(`Session started: ${this.currentSession.id}`);
  }

  /** Get the current session */
  get session(): Readonly<Session> {
    return this.currentSession;
  }

  /** Get the current session ID */
  get sessionId(): string {
    return this.currentSession.id;
  }

  /** Get session duration in milliseconds */
  get durationMs(): number {
    return Date.now() - this.currentSession.startedAt;
  }

  /** End the current session and start a new one */
  restart(): void {
    this.logger.info(`Session ended: ${this.currentSession.id} (duration: ${this.durationMs}ms)`);
    this.currentSession = this.createSession();
    this.logger.info(`New session started: ${this.currentSession.id}`);
  }

  private createSession(): Session {
    const workspaceRoot =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? 'no-workspace';

    return {
      id: crypto.randomUUID(),
      startedAt: Date.now(),
      workspaceRoot,
    };
  }
}
