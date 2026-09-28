'use strict';
// better-sqlite3-compatible shim backed by node-sqlite3-wasm (pure WASM, no native build).
// Exposed exactly like better-sqlite3: `module.exports = Database`.
const fs = require('node:fs');
const { Database: WasmDB } = require('node-sqlite3-wasm');

// node-sqlite3-wasm locks writes with a `<dbfile>.lock` DIRECTORY (mkdir/rmdir). If the
// process is killed mid-write (Passenger restart, crash), the dir is orphaned and every
// later write fails with SQLITE_BUSY ("database is locked") forever. This app runs as a
// single Passenger process, so any lock present at startup is stale — clear it before open.
function clearStaleLock(filename) {
  if (!filename || filename === ':memory:') return;
  try { fs.rmSync(filename + '.lock', { recursive: true, force: true }); } catch (_e) { /* ignore */ }
}

const MAX_SAFE = 9007199254740991n;
const MIN_SAFE = -9007199254740991n;
function fixBig(v) {
  if (typeof v === 'bigint' && v <= MAX_SAFE && v >= MIN_SAFE) return Number(v);
  return v;
}
function fixRow(row) {
  if (row == null) return undefined;
  for (const k in row) {
    const v = row[k];
    if (typeof v === 'bigint') row[k] = fixBig(v);
  }
  return row;
}
// better-sqlite3 lets named-param objects use BARE keys ({id}) for @id/:id/$id.
// node-sqlite3-wasm requires the prefix in the key ({'@id'}). Scan each SQL for its
// named tokens and build bare->token map so we can rename at bind time.
const NAMED_RE = /[@:$][a-zA-Z_][a-zA-Z0-9_]*/g;
function namedMap(sql) {
  const m = new Map();
  const found = sql.match(NAMED_RE);
  if (found) for (const tok of found) { const bare = tok.slice(1); if (!m.has(bare)) m.set(bare, tok); }
  return m;
}
function renameNamed(obj, map) {
  const out = {};
  for (const k in obj) {
    if (k[0] === '@' || k[0] === ':' || k[0] === '$') { out[k] = obj[k]; continue; }
    out[map.get(k) || ('@' + k)] = obj[k];
  }
  return out;
}
// Map better-sqlite3 call styles to node-sqlite3-wasm's single BindValues arg.
//  - spread positional: .run(a, b)      -> [a, b]
//  - single named obj:  .run({ x: 1 })  -> { '@x': 1 }
//  - single positional: .run(a)         -> [a]
//  - none:              .run()          -> undefined
function bindOf(args, map) {
  if (args.length === 0) return undefined;
  if (args.length === 1) {
    const a = args[0];
    if (a !== null && typeof a === 'object' && !Array.isArray(a) && !(a instanceof Uint8Array)) {
      return renameNamed(a, map); // named params -> prefixed keys
    }
    return [a];
  }
  return args.slice();
}

class Statement {
  constructor(stmt, sql) { this._stmt = stmt; this._map = namedMap(sql); }
  run(...args) {
    const b = bindOf(args, this._map);
    const r = b === undefined ? this._stmt.run() : this._stmt.run(b);
    return { changes: Number(r.changes), lastInsertRowid: fixBig(r.lastInsertRowid) };
  }
  get(...args) {
    const b = bindOf(args, this._map);
    const row = b === undefined ? this._stmt.get() : this._stmt.get(b);
    return fixRow(row);
  }
  all(...args) {
    const b = bindOf(args, this._map);
    const rows = b === undefined ? this._stmt.all() : this._stmt.all(b);
    for (let i = 0; i < rows.length; i++) fixRow(rows[i]);
    return rows;
  }
}

let shutdownHooked = false;
function hookShutdown(db) {
  if (shutdownHooked) return;
  shutdownHooked = true;
  const close = () => { try { db.close(); } catch (_e) {} };
  process.once('exit', close);
  process.once('SIGINT', () => { close(); process.exit(0); });
  process.once('SIGTERM', () => { close(); process.exit(0); });
}

class Database {
  constructor(filename, _opts) {
    const fn = filename || ':memory:';
    clearStaleLock(fn);
    this._db = new WasmDB(fn);
    this._cache = new Map(); // sql -> Statement (bounded set, compiled once, reused)
    hookShutdown(this); // close on graceful exit so the lock dir is released
  }
  pragma(source) {
    // The wasm VFS has no shared-memory file, so journal_mode=WAL is unsupported and
    // would leave the DB locked. WAL is only a performance hint here — skip journal_mode
    // pragmas and keep the default rollback journal (which still persists to disk).
    if (/journal_mode/i.test(source)) return [];
    try { this._db.exec('PRAGMA ' + source + ';'); } catch (_e) { /* non-fatal */ }
    return [];
  }
  exec(sql) { this._db.exec(sql); return this; }
  prepare(sql) {
    let st = this._cache.get(sql);
    if (!st) { st = new Statement(this._db.prepare(sql), sql); this._cache.set(sql, st); }
    return st;
  }
  transaction(fn) {
    const db = this._db;
    const wrapped = (...a) => {
      db.exec('BEGIN');
      try { const r = fn(...a); db.exec('COMMIT'); return r; }
      catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
    };
    return wrapped;
  }
  close() {
    for (const st of this._cache.values()) { try { st._stmt.finalize(); } catch (_) {} }
    this._cache.clear();
    this._db.close();
  }
  get isOpen() { return this._db.isOpen; }
  get inTransaction() { return this._db.inTransaction; }
}

module.exports = Database;
module.exports.default = Database; // harmless; supports both interop shapes
