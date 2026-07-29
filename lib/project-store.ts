import { durableDatabase } from "./durable-jobs";

export interface SharedProject {
  id: string;
  name: string;
  repo?: string;
  instructions: string;
  createdAt: number;
  updatedAt: number;
}

const db = durableDatabase();
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    repository TEXT,
    instructions TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS project_preferences (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    active_project_id TEXT,
    updated_at INTEGER NOT NULL
  ) STRICT;
`);

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function listProjects(): SharedProject[] {
  const rows = db.prepare("SELECT id, name, repository, instructions, created_at, updated_at FROM projects ORDER BY updated_at DESC").all() as Array<{
    id: string; name: string; repository: string | null; instructions: string; created_at: number; updated_at: number;
  }>;
  return rows.map((row) => ({ id: row.id, name: row.name, repo: row.repository || undefined, instructions: row.instructions, createdAt: row.created_at, updatedAt: row.updated_at }));
}

export function activeProjectId() {
  return (db.prepare("SELECT active_project_id FROM project_preferences WHERE singleton=1").get() as { active_project_id: string | null } | undefined)?.active_project_id || null;
}

export function saveProject(input: Partial<SharedProject> & { id: string; name: string }) {
  const id = clean(input.id, 80).replace(/[^a-zA-Z0-9_-]/g, "");
  const name = clean(input.name, 100);
  if (!id || !name) throw new Error("A project id and name are required.");
  const now = Date.now();
  db.prepare(`INSERT INTO projects(id, name, repository, instructions, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, repository=excluded.repository,
      instructions=excluded.instructions, updated_at=excluded.updated_at`)
    .run(id, name, clean(input.repo, 240) || null, clean(input.instructions, 12_000), Number(input.createdAt) || now, now);
  return listProjects().find((project) => project.id === id)!;
}

export function removeProject(id: string) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM projects WHERE id=?").run(id);
    db.prepare("UPDATE project_preferences SET active_project_id=NULL, updated_at=? WHERE singleton=1 AND active_project_id=?").run(Date.now(), id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function setActiveProject(id: string | null) {
  if (id && !db.prepare("SELECT 1 FROM projects WHERE id=?").get(id)) throw new Error("Project not found.");
  db.prepare(`INSERT INTO project_preferences(singleton, active_project_id, updated_at) VALUES (1, ?, ?)
    ON CONFLICT(singleton) DO UPDATE SET active_project_id=excluded.active_project_id, updated_at=excluded.updated_at`)
    .run(id, Date.now());
  return activeProjectId();
}
