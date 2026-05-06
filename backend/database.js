const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'securevault.db');

let db = null;
let saveTimeout = null;

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

/**
 * Persist database to disk (debounced)
 */
function scheduleSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      const data = db.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
    } catch (err) {
      console.error('DB save error:', err.message);
    }
  }, 200); // debounce 200ms
}

/**
 * Initialize and return the database
 */
async function getDb() {
  if (db) return db;

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // ─── Schema ───────────────────────────────────────────────────────────────

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      email       TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt        TEXT NOT NULL,
      kdf_iterations INTEGER NOT NULL DEFAULT 600000,
      totp_secret TEXT,
      is_totp_enabled INTEGER NOT NULL DEFAULT 0,
      failed_logins INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER,
      created_at  INTEGER NOT NULL,
      last_login  INTEGER
    );

    CREATE TABLE IF NOT EXISTS vault_items (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      type        TEXT NOT NULL DEFAULT 'login',
      name_enc    TEXT NOT NULL,
      data_enc    TEXT NOT NULL,
      iv          TEXT NOT NULL,
      auth_tag    TEXT NOT NULL,
      favorite    INTEGER NOT NULL DEFAULT 0,
      folder_id   TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS folders (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      name_enc    TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      token_hash  TEXT NOT NULL,
      ip_address  TEXT,
      user_agent  TEXT,
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL,
      last_used   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_registrations (
      token       TEXT PRIMARY KEY,
      email       TEXT UNIQUE NOT NULL,
      expires_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_vault_user ON vault_items(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
  `);

  scheduleSave();
  return db;
}

// ─── DB Wrapper (synchronous-style API) ───────────────────────────────────────

class DbWrapper {
  constructor() {
    this._db = null;
    this._ready = false;
  }

  async init() {
    this._db = await getDb();
    this._ready = true;
    return this;
  }

  prepare(sql) {
    const self = this;
    return {
      sql,
      run(...params) {
        const stmt = self._db.prepare(sql);
        stmt.run(params);
        stmt.free();
        scheduleSave();
        return { changes: self._db.getRowsModified() };
      },
      get(...params) {
        const stmt = self._db.prepare(sql);
        stmt.bind(params);
        let result = null;
        if (stmt.step()) {
          result = stmt.getAsObject();
          // Convert int columns back
          result = convertRow(result);
        }
        stmt.free();
        return result;
      },
      all(...params) {
        const results = [];
        const stmt = self._db.prepare(sql);
        stmt.bind(params);
        while (stmt.step()) {
          results.push(convertRow(stmt.getAsObject()));
        }
        stmt.free();
        return results;
      },
    };
  }

  exec(sql) {
    this._db.run(sql);
    scheduleSave();
  }

  pragma() {} // no-op for sql.js compatibility
}

function convertRow(row) {
  // sql.js returns all values as-is; ensure numbers stay numbers
  for (const key in row) {
    if (typeof row[key] === 'bigint') row[key] = Number(row[key]);
  }
  return row;
}

const wrapper = new DbWrapper();
module.exports = wrapper;
