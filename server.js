// Task list server: serves index.html and stores tasks in SQLite (Node's built-in node:sqlite).
// Usage: node server.js   (PORT, HOST and DB env vars are optional)
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = +process.env.PORT || 4321;
const HOST = process.env.HOST || '127.0.0.1';
const DB_PATH = process.env.DB || path.join(__dirname, 'tasks.db');
const MAX_BODY = 10 * 1024 * 1024;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS projects (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    color     TEXT NOT NULL,
    position  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id            TEXT PRIMARY KEY,
    project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    position      INTEGER NOT NULL,          -- order within the project's outline
    depth         INTEGER NOT NULL,          -- outline indent; parent = nearest earlier row with depth - 1
    text          TEXT NOT NULL DEFAULT '',
    done          INTEGER NOT NULL DEFAULT 0,
    deadline      INTEGER,                   -- epoch ms
    estimate_min  INTEGER,
    created       INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS tasks_by_project ON tasks(project_id, position);
  -- Interleaved view: which project fills each top-level slot, in order.
  CREATE TABLE IF NOT EXISTS mix_slots (
    position    INTEGER PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT OR IGNORE INTO meta (key, value) VALUES ('rev', '0');
`);

const q = {
  rev: db.prepare(`SELECT CAST(value AS INTEGER) AS rev FROM meta WHERE key = 'rev'`),
  setRev: db.prepare(`UPDATE meta SET value = ? WHERE key = 'rev'`),
  projects: db.prepare(`SELECT id, name, color FROM projects ORDER BY position`),
  tasks: db.prepare(`SELECT * FROM tasks ORDER BY project_id, position`),
  mix: db.prepare(`SELECT project_id FROM mix_slots ORDER BY position`),
  insProject: db.prepare(`INSERT INTO projects (id, name, color, position) VALUES (?, ?, ?, ?)`),
  insTask: db.prepare(`INSERT INTO tasks (id, project_id, position, depth, text, done, deadline, estimate_min, created)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  insSlot: db.prepare(`INSERT INTO mix_slots (position, project_id) VALUES (?, ?)`),
};

function readState() {
  const projects = q.projects.all().map(p => ({ id: p.id, name: p.name, color: p.color, items: [] }));
  const byId = new Map(projects.map(p => [p.id, p]));
  const tasks = {};
  for (const t of q.tasks.all()) {
    tasks[t.id] = {
      id: t.id, text: t.text, done: !!t.done, project: t.project_id,
      deadline: t.deadline ?? null, estimate: t.estimate_min ?? null, created: t.created,
    };
    byId.get(t.project_id)?.items.push({ id: t.id, depth: t.depth });
  }
  return { rev: q.rev.get().rev, data: { projects, tasks, mix: q.mix.all().map(r => r.project_id) } };
}

const str = (v, max = 100000) => String(v ?? '').slice(0, max);
const intOrNull = v => (Number.isFinite(+v) && v !== null && v !== '' ? Math.round(+v) : null);

// The client sends its whole state. A single user's list is small, so we replace it in one transaction.
function writeState(data) {
  const projects = Array.isArray(data?.projects) ? data.projects : null;
  const tasks = data?.tasks && typeof data.tasks === 'object' ? data.tasks : null;
  if (!projects || !tasks) throw Object.assign(new Error('invalid state'), { status: 400 });

  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DELETE FROM mix_slots; DELETE FROM tasks; DELETE FROM projects;');
    const projectIds = new Set();
    const seenTasks = new Set();
    projects.forEach((p, pi) => {
      const id = str(p.id, 64);
      if (!id || projectIds.has(id)) return;
      projectIds.add(id);
      q.insProject.run(id, str(p.name, 200) || 'Untitled', str(p.color, 32) || '#888888', pi);
      (Array.isArray(p.items) ? p.items : []).forEach((r, i) => {
        const t = tasks[r?.id];
        if (!t || seenTasks.has(r.id)) return;
        seenTasks.add(r.id);
        q.insTask.run(str(r.id, 64), id, i, Math.max(0, intOrNull(r.depth) ?? 0), str(t.text),
          t.done ? 1 : 0, intOrNull(t.deadline), intOrNull(t.estimate), intOrNull(t.created) ?? Date.now());
      });
    });
    (Array.isArray(data.mix) ? data.mix : []).forEach((pid, i) => {
      if (projectIds.has(pid)) q.insSlot.run(i, pid);
    });
    const rev = q.rev.get().rev + 1;
    q.setRev.run(String(rev));
    db.exec('COMMIT');
    return rev;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'index.html')), 'text/html; charset=utf-8');
    }
    if (url.pathname === '/api/state') {
      if (req.method === 'GET') return send(res, 200, readState());
      if (req.method === 'PUT') {
        const body = JSON.parse(await readBody(req));
        // Optimistic concurrency: a stale window gets the current state back instead of overwriting it.
        if (body.baseRev !== q.rev.get().rev) return send(res, 409, readState());
        return send(res, 200, { rev: writeState(body.data) });
      }
      return send(res, 405, { error: 'method not allowed' });
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, e.status || (e instanceof SyntaxError ? 400 : 500), { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Tasks running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (db: ${DB_PATH})`);
});

// Close the database on Ctrl+C / `systemctl stop`: SQLite then folds the -wal file back into
// tasks.db and removes the -wal and -shm files, leaving one self-contained file.
// Writes are synchronous, so no transaction can be half-done when this runs.
function shutdown(signal) {
  server.close();
  server.closeAllConnections();
  try {
    db.close();
  } catch (e) {
    console.error('Error closing database:', e.message);
  }
  console.log(`Stopped (${signal})`);
  process.exit(0);
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, shutdown);
