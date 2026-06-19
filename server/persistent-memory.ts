import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "./db";

const DATA_DIR =
  process.env.PERSISTENT_DATA_DIR ||
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  path.join(process.cwd(), "data");

async function ensurePersistentTable(db: any) {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS bot_persistent_state (
      \`key\` varchar(191) NOT NULL PRIMARY KEY,
      \`value\` longtext NOT NULL,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

export async function loadJsonFile<T>(fileName: string, fallback: T): Promise<T> {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    const raw = await readFile(path.join(DATA_DIR, fileName), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function saveJsonFile(fileName: string, data: unknown): Promise<void> {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(
      path.join(DATA_DIR, fileName),
      JSON.stringify(data, null, 2),
      "utf8"
    );
  } catch (e) {
    console.warn(`[PersistentMemory] Failed to save ${fileName}:`, e);
  }
}

export async function loadPersistentState<T>(
  key: string,
  fallback: T
): Promise<T> {
  try {
    const db = await getDb();

    console.log(
      `[PersistentMemory] LOAD ${key}: ${db ? "DB" : "JSON fallback"}`
    );

    if (!db) {
      return loadJsonFile(`${key}.json`, fallback);
    }

    await ensurePersistentTable(db);

    const rows: any = await db.execute(sql`
      SELECT \`value\`
      FROM bot_persistent_state
      WHERE \`key\` = ${key}
      LIMIT 1
    `);

    const value =
      rows?.[0]?.value ??
      rows?.rows?.[0]?.value ??
      null;

    if (!value) return fallback;

    return JSON.parse(value) as T;
  } catch (e) {
    console.warn(`[PersistentMemory] DB load failed for ${key}:`, e);
    return loadJsonFile(`${key}.json`, fallback);
  }
}

export async function savePersistentState(
  key: string,
  data: unknown
): Promise<void> {
  const json = JSON.stringify(data);

  try {
    const db = await getDb();

    console.log(
      `[PersistentMemory] SAVE ${key}: ${db ? "DB" : "JSON fallback"}`
    );

    if (!db) {
      await saveJsonFile(`${key}.json`, data);
      return;
    }

    await ensurePersistentTable(db);

    await db.execute(sql`
      INSERT INTO bot_persistent_state (\`key\`, \`value\`, updated_at)
      VALUES (${key}, ${json}, NOW())
      ON DUPLICATE KEY UPDATE
        \`value\` = ${json},
        updated_at = NOW()
    `);
  } catch (e) {
    console.warn(`[PersistentMemory] DB save failed for ${key}:`, e);
    await saveJsonFile(`${key}.json`, data);
  }
}

export async function getPersistentMemoryStatus() {
  const db = await getDb();

  return {
    primaryStore: db ? "database" : "file",
    fileFallbackDir: DATA_DIR,
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    railwayVolumeMountPath: process.env.RAILWAY_VOLUME_MOUNT_PATH ?? null,
    persistentDataDir: process.env.PERSISTENT_DATA_DIR ?? null,
  };
}