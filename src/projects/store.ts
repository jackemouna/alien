import fs from "node:fs";
import path from "node:path";
import type { Project, TaskRecord } from "./types.js";

/**
 * Disk persistence for Projects and their Tasks. Layout (one directory per
 * project so a single task transition does not rewrite an unrelated project):
 *
 *   <projectsDir>/<projectId>/project.json     — Project metadata (0o600)
 *   <projectsDir>/<projectId>/tasks/<taskId>.json — one TaskRecord per file
 *
 * Both files use 0o600 and live inside a 0o700 parent directory. Sanitization
 * mirrors src/orchestrator/run-store.ts so the same filename safety properties
 * apply (no traversal, no dotfiles).
 *
 * The store deliberately does not embed audit-log writes — callers thread
 * audit emission separately so the persistence layer stays a thin fs adapter
 * and is trivially mockable in tests.
 */

export type ProjectStoreOptions = {
  readonly fsImpl?: Pick<
    typeof fs,
    "readFileSync" | "writeFileSync" | "mkdirSync" | "existsSync" | "readdirSync" | "rmSync"
  >;
};

export function resolveProjectDir(projectsDir: string, projectId: string): string {
  return path.join(projectsDir, sanitizeId(projectId));
}

export function resolveProjectFile(projectsDir: string, projectId: string): string {
  return path.join(resolveProjectDir(projectsDir, projectId), "project.json");
}

export function resolveTasksDir(projectsDir: string, projectId: string): string {
  return path.join(resolveProjectDir(projectsDir, projectId), "tasks");
}

export function resolveTaskFile(projectsDir: string, projectId: string, taskId: string): string {
  return path.join(resolveTasksDir(projectsDir, projectId), `${sanitizeId(taskId)}.json`);
}

export function saveProject(
  projectsDir: string,
  project: Project,
  options: ProjectStoreOptions = {},
): void {
  const fsImpl = options.fsImpl ?? fs;
  const projectDir = resolveProjectDir(projectsDir, project.id);
  if (!fsImpl.existsSync(projectDir)) {
    fsImpl.mkdirSync(projectDir, { recursive: true, mode: 0o700 });
  }
  fsImpl.writeFileSync(
    resolveProjectFile(projectsDir, project.id),
    `${JSON.stringify(project, null, 2)}\n`,
    { mode: 0o600 },
  );
}

export function loadProject(
  projectsDir: string,
  projectId: string,
  options: ProjectStoreOptions = {},
): Project | null {
  const fsImpl = options.fsImpl ?? fs;
  const filePath = resolveProjectFile(projectsDir, projectId);
  if (!fsImpl.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fsImpl.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Project;
    if (!parsed || typeof parsed !== "object" || typeof parsed.id !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function listProjectIds(projectsDir: string, options: ProjectStoreOptions = {}): string[] {
  const fsImpl = options.fsImpl ?? fs;
  if (!fsImpl.existsSync(projectsDir)) {
    return [];
  }
  return fsImpl
    .readdirSync(projectsDir)
    .filter((name) => {
      try {
        return fsImpl.existsSync(path.join(projectsDir, name, "project.json"));
      } catch {
        return false;
      }
    })
    .toSorted();
}

export function deleteProject(
  projectsDir: string,
  projectId: string,
  options: ProjectStoreOptions = {},
): boolean {
  const fsImpl = options.fsImpl ?? fs;
  const projectDir = resolveProjectDir(projectsDir, projectId);
  if (!fsImpl.existsSync(projectDir)) {
    return false;
  }
  fsImpl.rmSync(projectDir, { recursive: true, force: true });
  return true;
}

export function saveTask(
  projectsDir: string,
  task: TaskRecord,
  options: ProjectStoreOptions = {},
): void {
  const fsImpl = options.fsImpl ?? fs;
  const tasksDir = resolveTasksDir(projectsDir, task.projectId);
  if (!fsImpl.existsSync(tasksDir)) {
    fsImpl.mkdirSync(tasksDir, { recursive: true, mode: 0o700 });
  }
  fsImpl.writeFileSync(
    resolveTaskFile(projectsDir, task.projectId, task.id),
    `${JSON.stringify(task, null, 2)}\n`,
    { mode: 0o600 },
  );
}

export function loadTask(
  projectsDir: string,
  projectId: string,
  taskId: string,
  options: ProjectStoreOptions = {},
): TaskRecord | null {
  const fsImpl = options.fsImpl ?? fs;
  const filePath = resolveTaskFile(projectsDir, projectId, taskId);
  if (!fsImpl.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fsImpl.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as TaskRecord;
    if (!parsed || typeof parsed !== "object" || typeof parsed.id !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function listTasks(
  projectsDir: string,
  projectId: string,
  options: ProjectStoreOptions = {},
): TaskRecord[] {
  const fsImpl = options.fsImpl ?? fs;
  const tasksDir = resolveTasksDir(projectsDir, projectId);
  if (!fsImpl.existsSync(tasksDir)) {
    return [];
  }
  const entries = fsImpl.readdirSync(tasksDir);
  const out: TaskRecord[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const taskId = name.slice(0, -".json".length);
    const task = loadTask(projectsDir, projectId, taskId, options);
    if (task) {
      out.push(task);
    }
  }
  return out;
}

export function deleteTask(
  projectsDir: string,
  projectId: string,
  taskId: string,
  options: ProjectStoreOptions = {},
): boolean {
  const fsImpl = options.fsImpl ?? fs;
  const filePath = resolveTaskFile(projectsDir, projectId, taskId);
  if (!fsImpl.existsSync(filePath)) {
    return false;
  }
  fsImpl.rmSync(filePath, { force: true });
  return true;
}

function sanitizeId(id: string): string {
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) {
    throw new Error(`Invalid id (must match [A-Za-z0-9_.-]+): ${id}`);
  }
  if (id.startsWith(".") || id === "..") {
    throw new Error(`Invalid id (refusing dotfile/parent): ${id}`);
  }
  return id;
}
