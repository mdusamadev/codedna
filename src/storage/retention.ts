import { Logger } from '../utils/logger';
import { Database } from './database';
import { Settings } from '../config/settings';

/**
 * Auto-prunes old edit events based on the retention setting.
 * Runs immediately on activation and then every 24 hours.
 */
export class RetentionManager {
  private readonly logger = Logger.getInstance();
  private readonly db: Database;
  private readonly settings: Settings;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(db: Database, settings: Settings) {
    this.db = db;
    this.settings = settings;
  }

  /** Start the retention manager — prune immediately and schedule daily. */
  start(): void {
    this.prune();
    this.intervalHandle = setInterval(
      () => this.prune(),
      24 * 60 * 60 * 1000,
    );
    this.logger.info('Retention manager started');
  }

  dispose(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private prune(): void {
    try {
      const deleted = this.db.pruneOldData(this.settings.retentionDays);
      if (deleted > 0) {
        this.logger.info(`Pruned ${deleted} old events (retention: ${this.settings.retentionDays}d)`);
      }
    } catch (err) {
      this.logger.error('Retention pruning failed', err);
    }
  }
}
