import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WriteBuffer } from '../../src/storage/write-buffer';
import { Database } from '../../src/storage/database';
import type { ClassifiedEditEvent } from '../../src/utils/types';

function makeEvent(overrides: Partial<ClassifiedEditEvent> = {}): ClassifiedEditEvent {
  return {
    timestamp: Date.now(),
    sessionId: 'test-session',
    filePath: 'src/index.ts',
    lineStart: 1,
    lineEnd: 1,
    charsAdded: 5,
    charsRemoved: 0,
    linesAdded: 0,
    language: 'typescript',
    isFromDisk: false,
    classification: 'human',
    confidence: 0.95,
    sourceHint: 'unknown',
    ...overrides,
  };
}

describe('WriteBuffer', () => {
  let db: Database;
  let buffer: WriteBuffer;

  beforeEach(() => {
    vi.useFakeTimers();
    db = new Database();
    db.initializeInMemory();
    buffer = new WriteBuffer(db);
  });

  afterEach(() => {
    // Dispose only if not already disposed by the test itself
    try { buffer.dispose(); } catch { /* already disposed */ }
    db.close();
    vi.useRealTimers();
  });

  // ── TC-WB01 ───────────────────────────────────────────────────────────────

  it('TC-WB01: Buffer flushes automatically when 50 events are pushed', () => {
    for (let i = 0; i < 50; i++) {
      buffer.push(makeEvent());
    }
    // The 50th push triggers an immediate synchronous flush
    expect(buffer.getBufferSize()).toBe(0);
    expect(db.getEventCount()).toBe(50);
  });

  it('TC-WB01b: Buffer does NOT flush before reaching the 50-event threshold', () => {
    for (let i = 0; i < 49; i++) {
      buffer.push(makeEvent());
    }
    expect(buffer.getBufferSize()).toBe(49);
    expect(db.getEventCount()).toBe(0);
  });

  // ── TC-WB02 ───────────────────────────────────────────────────────────────

  it('TC-WB02: Buffer flushes all events after the 2-second timer fires', () => {
    for (let i = 0; i < 10; i++) {
      buffer.push(makeEvent());
    }
    // Nothing written yet — timer hasn't fired
    expect(db.getEventCount()).toBe(0);
    expect(buffer.getBufferSize()).toBe(10);

    vi.advanceTimersByTime(2000);

    expect(buffer.getBufferSize()).toBe(0);
    expect(db.getEventCount()).toBe(10);
  });

  // ── TC-WB03 ───────────────────────────────────────────────────────────────

  it('TC-WB03: dispose() performs a synchronous final flush before shutdown', () => {
    for (let i = 0; i < 25; i++) {
      buffer.push(makeEvent());
    }
    // Timer has NOT fired yet; simulate deactivation
    buffer.dispose();

    expect(db.getEventCount()).toBe(25);
    expect(buffer.getBufferSize()).toBe(0);
  });

  // ── TC-WB04 ───────────────────────────────────────────────────────────────

  it('TC-WB04: Empty buffer — timer fires but no database transaction is opened', () => {
    const spy = vi.spyOn(db, 'insertEditEvents');
    vi.advanceTimersByTime(2000); // fire the interval with nothing buffered
    expect(spy).not.toHaveBeenCalled();
  });

  // ── TC-WB05 ───────────────────────────────────────────────────────────────

  it('TC-WB05: Database write failure retains all 30 buffered events for retry', () => {
    vi.spyOn(db, 'insertEditEvents').mockImplementationOnce(() => {
      throw new Error('SQLITE_FULL');
    });

    for (let i = 0; i < 30; i++) {
      buffer.push(makeEvent());
    }
    // Timer fires → flush throws → all 30 events put back in buffer
    vi.advanceTimersByTime(2000);

    expect(buffer.getBufferSize()).toBe(30);
    expect(db.getEventCount()).toBe(0); // nothing was written (error before insert)
  });

  it('TC-WB05b: Events are successfully retried on the next flush after a failure', () => {
    const spy = vi.spyOn(db, 'insertEditEvents')
      .mockImplementationOnce(() => { throw new Error('transient error'); });
    // First call throws; second call uses real implementation
    spy.mockImplementationOnce((evts) => {
      // restore then call real impl
      spy.mockRestore();
      db.insertEditEvents(evts);
    });

    for (let i = 0; i < 30; i++) buffer.push(makeEvent());
    vi.advanceTimersByTime(2000); // first flush — fails
    expect(buffer.getBufferSize()).toBe(30);

    vi.advanceTimersByTime(2000); // second flush — succeeds
    expect(buffer.getBufferSize()).toBe(0);
    expect(db.getEventCount()).toBe(30);
  });

  // ── TC-WB06 ───────────────────────────────────────────────────────────────

  it('TC-WB06: Events pushed during an active flush are buffered and written on the next flush', () => {
    let firstFlushEventCount = 0;

    // Mock insertEditEvents: during the first call, push 5 extra events into the buffer.
    // This simulates a concurrent push arriving while the flush is in progress.
    vi.spyOn(db, 'insertEditEvents').mockImplementationOnce((evts) => {
      firstFlushEventCount = evts.length;
      // isFlushing=true here — pushes go into a fresh buffer, not lost
      for (let i = 0; i < 5; i++) {
        buffer.push(makeEvent());
      }
      // Let the real insert run for the original events
      vi.spyOn(db, 'insertEditEvents').mockRestore();
      db.insertEditEvents(evts);
    });

    for (let i = 0; i < 10; i++) buffer.push(makeEvent());
    vi.advanceTimersByTime(2000); // first flush: writes original 10, buffers 5 new ones

    // The 5 concurrent events are in the buffer (not written yet)
    expect(firstFlushEventCount).toBe(10);
    expect(buffer.getBufferSize()).toBe(5);
    expect(db.getEventCount()).toBe(10); // only the original batch written so far

    // Next flush writes the 5 deferred events
    vi.advanceTimersByTime(2000);
    expect(buffer.getBufferSize()).toBe(0);
    expect(db.getEventCount()).toBe(15); // all 15 now in DB
  });

  // ── TC-WB07 ───────────────────────────────────────────────────────────────

  it('TC-WB07: Transaction integrity — DB failure at event 25 rolls back entire batch; all 50 retained', () => {
    // better-sqlite3 wraps insertEditEvents in a transaction.  If the transaction
    // throws, NO events are committed and the WriteBuffer puts ALL events back.
    let flushAttempts = 0;
    const spy = vi.spyOn(db, 'insertEditEvents').mockImplementation((evts) => {
      flushAttempts++;
      if (flushAttempts === 1) {
        // Simulate a SQLITE_CONSTRAINT error on event 25 — transaction is aborted.
        // Because better-sqlite3 uses all-or-nothing transactions, 0 of the 50 are
        // committed.  We simulate this by simply throwing without inserting anything.
        throw new Error(`SQLITE_CONSTRAINT: NOT NULL constraint failed (event 25 of ${evts.length})`);
      }
      // Second attempt: let the real insert run
      spy.mockRestore();
      db.insertEditEvents(evts);
    });

    // Push 50 events — the 50th push triggers an immediate flush
    for (let i = 0; i < 50; i++) {
      buffer.push(makeEvent());
    }

    // Flush threw → entire transaction rolled back → all 50 events retained in buffer
    expect(buffer.getBufferSize()).toBe(50);
    expect(db.getEventCount()).toBe(0); // nothing committed to DB

    // Retry: advance the 2-second timer → second flush succeeds with all 50 events
    vi.advanceTimersByTime(2000);
    expect(buffer.getBufferSize()).toBe(0);
    expect(db.getEventCount()).toBe(50);
  });
});
