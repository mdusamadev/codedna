/**
 * A minimal SQLite adapter interface that is satisfied by both
 * better-sqlite3 (native) and the sql.js (WebAssembly) compatibility wrapper.
 *
 * The surface is intentionally narrow — only the methods that Database.ts
 * actually calls are included.
 */

export interface PreparedStmt {
  /**
   * Execute the statement and return the first result row, or undefined.
   * Accepts either positional spread args or a single named-param object.
   */
  get(...args: unknown[]): Record<string, unknown> | undefined;
  /** Return every result row. */
  all(...args: unknown[]): Array<Record<string, unknown>>;
  /**
   * Execute a DML statement (INSERT / UPDATE / DELETE).
   * - Pass a plain object for named params: run({key: val}) — keys without '@'.
   * - Pass multiple args for positional params: run(val1, val2).
   * - Pass nothing for no params: run().
   */
  run(...args: unknown[]): { changes: number };
}

export interface SqliteAdapter {
  /**
   * Execute a PRAGMA statement.
   * - If the string contains '=' it is treated as a SET pragma (no result).
   * - Otherwise it is treated as a GET pragma and the result rows are returned.
   */
  pragma(s: string): Array<Record<string, unknown>>;
  /** Execute one or more SQL statements with no parameters. */
  exec(sql: string): void;
  /** Compile a SQL statement for repeated execution. */
  prepare(sql: string): PreparedStmt;
  /**
   * Wrap a function in a BEGIN / COMMIT transaction.
   * Returns a callable that runs the wrapped function.
   */
  transaction<T>(fn: (arg: T) => void): (arg: T) => void;
  /** Close the connection (and flush to disk for sql.js). */
  close(): void;
  /** On-disk file path, or null for in-memory connections. */
  readonly filePath: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// BetterSqlite3 adapter — thin shim over the native module
// ─────────────────────────────────────────────────────────────────────────────

type BsDb = import('better-sqlite3').Database;

export function createBetterSqlite3Adapter(db: BsDb, filePath: string | null): SqliteAdapter {
  return {
    filePath,

    pragma(s: string): Array<Record<string, unknown>> {
      const result = db.pragma(s);
      if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
      if (result === undefined || result === null) return [];
      return [{ value: result }];
    },

    exec(sql: string): void {
      db.exec(sql);
    },

    prepare(sql: string): PreparedStmt {
      const stmt = db.prepare(sql);
      return {
        get(...args: unknown[]): Record<string, unknown> | undefined {
          return stmt.get(...(args as never[])) as Record<string, unknown> | undefined;
        },
        all(...args: unknown[]): Array<Record<string, unknown>> {
          return stmt.all(...(args as never[])) as Array<Record<string, unknown>>;
        },
        run(...args: unknown[]): { changes: number } {
          return stmt.run(...(args as never[])) as { changes: number };
        },
      };
    },

    transaction<T>(fn: (arg: T) => void): (arg: T) => void {
      return db.transaction(fn);
    },

    close(): void {
      db.close();
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// sql.js adapter — WebAssembly SQLite with file persistence
// ─────────────────────────────────────────────────────────────────────────────

type SqlJsDatabase = import('sql.js').Database;

/**
 * Wrap a sql.js Database instance to match the SqliteAdapter interface.
 *
 * Persistence strategy: the full database is exported to disk after every
 * transaction commit and every exec() call that modifies the schema.
 * Reads are served entirely from the in-memory copy.
 */
export function createSqlJsAdapter(sqlJsDb: SqlJsDatabase, filePath: string | null): SqliteAdapter {
  function saveToDisk(): void {
    if (!filePath) return;
    try {
      const data = sqlJsDb.export();
      fs.writeFileSync(filePath, Buffer.from(data));
    } catch {
      // Non-fatal — data still accessible in memory this session
    }
  }

  /**
   * Convert a better-sqlite3-style named-param object `{name: val}` to the
   * sql.js format `{'@name': val}` expected when the SQL uses `@name` placeholders.
   */
  function namedToSqlJs(params: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(params).map(([k, v]) => [`@${k}`, v]),
    );
  }

  /** Normalise args for `bind()`. Returns null when there are no params. */
  function toBind(args: unknown[]): unknown[] | Record<string, unknown> | null {
    if (args.length === 0) return null;
    if (args.length === 1) {
      const a = args[0];
      if (a !== null && typeof a === 'object' && !Array.isArray(a)) {
        return namedToSqlJs(a as Record<string, unknown>);
      }
      return [a];
    }
    return args;
  }

  return {
    filePath,

    pragma(s: string): Array<Record<string, unknown>> {
      if (s.includes('=')) {
        // SET pragma — execute and ignore result (WAL not supported in sql.js)
        try { sqlJsDb.run(`PRAGMA ${s}`); } catch { /* ignore */ }
        return [];
      }
      // GET pragma
      try {
        const results = sqlJsDb.exec(`PRAGMA ${s}`);
        if (!results.length || !results[0]!.values.length) return [];
        const cols = results[0]!.columns;
        return results[0]!.values.map((row) =>
          Object.fromEntries(cols.map((c, i) => [c, row[i]])),
        );
      } catch {
        return [];
      }
    },

    exec(sql: string): void {
      sqlJsDb.exec(sql);
      saveToDisk();
    },

    prepare(sql: string): PreparedStmt {
      return {
        get(...args: unknown[]): Record<string, unknown> | undefined {
          const stmt = sqlJsDb.prepare(sql);
          try {
            const b = toBind(args);
            if (b !== null) stmt.bind(b as import('sql.js').BindParams);
            return stmt.step() ? (stmt.getAsObject() as Record<string, unknown>) : undefined;
          } finally {
            stmt.free();
          }
        },

        all(...args: unknown[]): Array<Record<string, unknown>> {
          const stmt = sqlJsDb.prepare(sql);
          const rows: Array<Record<string, unknown>> = [];
          try {
            const b = toBind(args);
            if (b !== null) stmt.bind(b as import('sql.js').BindParams);
            while (stmt.step()) {
              rows.push(stmt.getAsObject() as Record<string, unknown>);
            }
            return rows;
          } finally {
            stmt.free();
          }
        },

        run(...args: unknown[]): { changes: number } {
          const stmt = sqlJsDb.prepare(sql);
          try {
            const b = toBind(args);
            if (b !== null) {
              // toBind already adds '@' prefix for named-param objects
              stmt.bind(b as import('sql.js').BindParams);
            }
            stmt.step();
            const changes = sqlJsDb.getRowsModified();
            return { changes };
          } finally {
            stmt.free();
          }
        },
      };
    },

    transaction<T>(fn: (arg: T) => void): (arg: T) => void {
      return (arg: T) => {
        sqlJsDb.run('BEGIN');
        try {
          fn(arg);
          sqlJsDb.run('COMMIT');
          saveToDisk();
        } catch (err) {
          try { sqlJsDb.run('ROLLBACK'); } catch { /* ignore */ }
          throw err;
        }
      };
    },

    close(): void {
      saveToDisk();
      sqlJsDb.close();
    },
  };
}

// fs is used by createSqlJsAdapter — import it here to keep the adapter file self-contained
import * as fs from 'fs';
