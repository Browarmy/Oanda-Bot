// server/memory/migrationRunner.ts

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { memoryQuery } from "./memory-db";

type MigrationRow = {
  id: string;
};

type MigrationResult = {
  applied: string[];
  skipped: string[];
};

const MIGRATION_DIRECTORY = resolve(process.cwd(), "server", "memory", "migrations");

const globalMigrationState = globalThis as typeof globalThis & {
  __nereqoMemoryMigrationPromise?: Promise<MigrationResult>;
};

async function ensureMigrationTable(): Promise<void> {
  await memoryQuery(`
    CREATE TABLE IF NOT EXISTS memory_schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrationIds(): Promise<Set<string>> {
  const rows = await memoryQuery<MigrationRow>(
    "SELECT id FROM memory_schema_migrations ORDER BY id ASC"
  );

  return new Set(rows.map((row) => row.id));
}

async function getMigrationFiles(): Promise<string[]> {
  const files = await readdir(MIGRATION_DIRECTORY, { withFileTypes: true });

  return files
    .filter((file) => file.isFile())
    .map((file) => file.name)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));
}

function getMigrationId(fileName: string): string {
  return fileName.replace(/\.sql$/u, "");
}

async function applyMigration(fileName: string): Promise<void> {
  const migrationId = getMigrationId(fileName);
  const migrationPath = join(MIGRATION_DIRECTORY, fileName);
  const sql = await readFile(migrationPath, "utf8");

  if (sql.trim().length === 0) {
    throw new Error(`[MemoryMigrations] Migration ${fileName} is empty.`);
  }

  console.log(`[MemoryMigrations] Applying ${migrationId}`);

  await memoryQuery(sql);

  await memoryQuery(
    `
      INSERT INTO memory_schema_migrations (id)
      VALUES ($1)
      ON CONFLICT (id) DO NOTHING
    `,
    [migrationId]
  );

  console.log(`[MemoryMigrations] Applied ${migrationId}`);
}

export async function runMemoryMigrations(): Promise<MigrationResult> {
  await ensureMigrationTable();

  const appliedMigrationIds = await getAppliedMigrationIds();
  const migrationFiles = await getMigrationFiles();

  const result: MigrationResult = {
    applied: [],
    skipped: [],
  };

  for (const fileName of migrationFiles) {
    const migrationId = getMigrationId(fileName);

    if (appliedMigrationIds.has(migrationId)) {
      result.skipped.push(migrationId);
      continue;
    }

    await applyMigration(fileName);
    appliedMigrationIds.add(migrationId);
    result.applied.push(migrationId);
  }

  console.log(
    `[MemoryMigrations] Complete. Applied: ${result.applied.length}. Skipped: ${result.skipped.length}.`
  );

  return result;
}

function startMemoryMigrationsOnImport(): Promise<MigrationResult> {
  if (!globalMigrationState.__nereqoMemoryMigrationPromise) {
    globalMigrationState.__nereqoMemoryMigrationPromise = runMemoryMigrations().catch((error) => {
      console.error("[MemoryMigrations] Startup migration failed:", error);
      throw error;
    });
  }

  return globalMigrationState.__nereqoMemoryMigrationPromise;
}

export const memoryMigrationStartup = startMemoryMigrationsOnImport();

export const memoryMigrationRunnerPath = dirname(fileURLToPath(import.meta.url));