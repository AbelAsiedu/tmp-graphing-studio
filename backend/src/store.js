// Persistence layer. Three interchangeable implementations behind one tiny interface:
//   list(filterFn) / get(id) / insert(board) / update(id, patch, expectedVersion) / remove(id)
// MemoryStore (tests), FileStore (single-instance dev/demo), PgStore (recommended in production).

import fs from 'node:fs/promises';
import path from 'node:path';

export class VersionConflict extends Error {
  constructor() {
    super('Board was changed elsewhere');
    this.status = 409;
  }
}

export class MemoryStore {
  constructor() {
    this.boards = new Map();
  }
  async list(pred) {
    return [...this.boards.values()].filter(pred).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async get(id) {
    return this.boards.get(id) || null;
  }
  async insert(board) {
    this.boards.set(board.id, structuredClone(board));
    return board;
  }
  async update(id, patch, expectedVersion) {
    const cur = this.boards.get(id);
    if (!cur) return null;
    if (expectedVersion != null && cur.version !== expectedVersion) throw new VersionConflict();
    const next = { ...cur, ...patch, version: cur.version + 1, updatedAt: new Date().toISOString() };
    this.boards.set(id, next);
    return next;
  }
  async remove(id) {
    return this.boards.delete(id);
  }
}

export class FileStore extends MemoryStore {
  constructor(file) {
    super();
    this.file = file;
    this.ready = this.#load();
    this.queue = Promise.resolve();
  }
  async #load() {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8'));
      for (const b of raw) this.boards.set(b.id, b);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  #persist() {
    this.queue = this.queue.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      await fs.writeFile(tmp, JSON.stringify([...this.boards.values()]));
      await fs.rename(tmp, this.file);
    });
    return this.queue;
  }
  async list(p) {
    await this.ready;
    return super.list(p);
  }
  async get(id) {
    await this.ready;
    return super.get(id);
  }
  async insert(b) {
    await this.ready;
    const r = await super.insert(b);
    await this.#persist();
    return r;
  }
  async update(id, patch, v) {
    await this.ready;
    const r = await super.update(id, patch, v);
    if (r) await this.#persist();
    return r;
  }
  async remove(id) {
    await this.ready;
    const r = await super.remove(id);
    await this.#persist();
    return r;
  }
}

export class PgStore {
  /** @param pool a pg.Pool (or compatible) */
  constructor(pool) {
    this.pool = pool;
    this.ready = pool.query(`
      CREATE TABLE IF NOT EXISTS boards (
        id          TEXT PRIMARY KEY,
        owner_id    TEXT NOT NULL,
        owner_name  TEXT NOT NULL,
        owner_role  TEXT NOT NULL,
        title       TEXT NOT NULL,
        visibility  TEXT NOT NULL DEFAULT 'private',
        class_id    TEXT,
        version     INTEGER NOT NULL DEFAULT 1,
        created_at  TIMESTAMPTZ NOT NULL,
        updated_at  TIMESTAMPTZ NOT NULL,
        data        JSONB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS boards_owner_idx ON boards (owner_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS boards_class_idx ON boards (class_id, visibility);
    `);
  }
  static row(r) {
    return {
      id: r.id,
      ownerId: r.owner_id,
      ownerName: r.owner_name,
      ownerRole: r.owner_role,
      title: r.title,
      visibility: r.visibility,
      classId: r.class_id,
      version: r.version,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
      data: r.data,
    };
  }
  async list(pred) {
    await this.ready;
    // Access is decided by permissions.js; the set is small per user/class, so filter in app code.
    const { rows } = await this.pool.query('SELECT * FROM boards ORDER BY updated_at DESC LIMIT 5000');
    return rows.map(PgStore.row).filter(pred);
  }
  async get(id) {
    await this.ready;
    const { rows } = await this.pool.query('SELECT * FROM boards WHERE id = $1', [id]);
    return rows[0] ? PgStore.row(rows[0]) : null;
  }
  async insert(b) {
    await this.ready;
    await this.pool.query(
      `INSERT INTO boards (id, owner_id, owner_name, owner_role, title, visibility, class_id, version, created_at, updated_at, data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [b.id, b.ownerId, b.ownerName, b.ownerRole, b.title, b.visibility, b.classId, b.version, b.createdAt, b.updatedAt, JSON.stringify(b.data)]
    );
    return b;
  }
  async update(id, patch, expectedVersion) {
    await this.ready;
    const cur = await this.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    const { rowCount } = await this.pool.query(
      `UPDATE boards SET title=$2, visibility=$3, class_id=$4, data=$5, version=version+1, updated_at=now()
       WHERE id=$1 AND ($6::int IS NULL OR version=$6::int)`,
      [id, next.title, next.visibility, next.classId, JSON.stringify(next.data), expectedVersion ?? null]
    );
    if (!rowCount) throw new VersionConflict();
    return this.get(id);
  }
  async remove(id) {
    await this.ready;
    const { rowCount } = await this.pool.query('DELETE FROM boards WHERE id=$1', [id]);
    return rowCount > 0;
  }
}

export async function createStore(cfg) {
  if (cfg.databaseUrl) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({
      connectionString: cfg.databaseUrl,
      ssl: cfg.isProd ? { rejectUnauthorized: false } : undefined, // Render Postgres requires TLS
      max: 10,
    });
    return new PgStore(pool);
  }
  return new FileStore(cfg.dataFile);
}
