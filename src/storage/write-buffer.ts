import { Logger } from '../utils/logger';
import { Database } from './database';
import { DEFAULTS } from '../utils/constants';
import type { ClassifiedEditEvent } from '../utils/types';

/**
 * Buffers classified edit events and flushes them to SQLite in batches.
 * Flush triggers: buffer reaches WRITE_BUFFER_MAX_SIZE OR flush interval fires.
 * On dispose: synchronous final flush before shutdown.
 */
export class WriteBuffer {
  private readonly logger = Logger.getInstance();
  private readonly db: Database;
  private buffer: ClassifiedEditEvent[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private isFlushing = false;

  constructor(db: Database) {
    this.db = db;
    this.startFlushTimer();
  }

  /** Add a classified event to the buffer. Triggers an immediate flush at the size limit. */
  push(event: ClassifiedEditEvent): void {
    this.buffer.push(event);
    if (this.buffer.length >= DEFAULTS.WRITE_BUFFER_MAX_SIZE) {
      this.flush();
    }
  }

  /** Current number of buffered events awaiting flush. */
  getBufferSize(): number {
    return this.buffer.length;
  }

  /** Flush all buffered events to the database. */
  flush(): void {
    if (this.buffer.length === 0 || this.isFlushing) return;

    this.isFlushing = true;
    const events = this.buffer;
    this.buffer = [];

    try {
      this.db.insertEditEvents(events);
      this.logger.debug(`Flushed ${events.length} events to database`);
    } catch (err) {
      this.logger.error('Failed to flush events to database — retaining for next flush', err);
      // Prepend events back so they are retried on the next flush
      this.buffer = [...events, ...this.buffer];
    } finally {
      this.isFlushing = false;
    }
  }

  /** Stop the flush timer and perform a final synchronous flush. */
  dispose(): void {
    if (this.flushInterval !== null) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flush();
  }

  private startFlushTimer(): void {
    this.flushInterval = setInterval(() => {
      this.flush();
    }, DEFAULTS.WRITE_BUFFER_FLUSH_INTERVAL_MS);
  }
}
