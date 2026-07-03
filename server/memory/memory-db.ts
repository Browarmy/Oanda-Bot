// server/memory/memory-db.ts

/**
 * Phase 0 Memory PostgreSQL client.
 *
 * Purpose:
 * - Connect only to MEMORY_DATABASE_URL.
 * - Never touch DATABASE_URL, MySQL, Drizzle, or the existing trading system.
 * - Provide a small, safe query layer for future Memory schema, writers,
 *   DNA encoding, and similarity search.
 *
 * Trust rule:
 * If MEMORY_DATABASE_URL is missing, Memory is unavailable by design.
 */

type PgPool = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>;
  end: () => Promise<void>;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
};

type PgModule = {
  Pool: new (config: Record<string, unknown>) => PgPool;
};

let memoryPool: PgPool | null = null;
let pgModulePromise: Promise<PgModule> | null = null;

function getMemoryDatabaseUrl(): string {
  const url = process.env.MEMORY_DATABASE_URL;

  if (!url || url.trim().length === 0) {
    throw new Error(
      "[MemoryDB] MEMORY_DATABASE_URL is not set. Phase 0 Memory cannot start without its isolated PostgreSQL database."
    );
  }

  return url;
}

async function loadPgModule(): Promise<PgModule> {
  if (!pgModulePromise) {
    pgModulePromise = new Function("moduleName", "return import(moduleName)")("pg") as Promise<PgModule>;
  }

  return pgModulePromise;
}

function shouldUseSsl(connectionString: string): boolean {
  return (
    process.env.MEMORY_DATABASE_SSL === "true" ||
    connectionString.includes("railway") ||
    connectionString.includes("sslmode=require")
  );
}

export async function getMemoryPool(): Promise<PgPool> {
  if (memoryPool) return memoryPool;

  const connectionString = getMemoryDatabaseUrl();
  const pg = await loadPgModule();

  memoryPool = new pg.Pool({
    connectionString,
    max: Number(process.env.MEMORY_DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: Number(process.env.MEMORY_DATABASE_IDLE_TIMEOUT_MS ?? 30_000),
    connectionTimeoutMillis: Number(process.env.MEMORY_DATABASE_CONNECTION_TIMEOUT_MS ?? 10_000),
    ssl: shouldUseSsl(connectionString)
      ? {
          rejectUnauthorized: false,
        }
      : undefined,
  });

  memoryPool.on("error", (error) => {
    console.error("[MemoryDB] PostgreSQL pool error:", error);
  });

  console.log("[MemoryDB] PostgreSQL pool initialised using MEMORY_DATABASE_URL");

  return memoryPool;
}

export async function memoryQuery<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const pool = await getMemoryPool();
  const result = await pool.query(text, params);

  return result.rows as T[];
}

export async function checkMemoryDatabaseHealth(): Promise<{
  ok: boolean;
  store: "postgresql";
  isolated: true;
  error?: string;
}> {
  try {
    await memoryQuery("SELECT 1 AS ok");

    return {
      ok: true,
      store: "postgresql",
      isolated: true,
    };
  } catch (error) {
    return {
      ok: false,
      store: "postgresql",
      isolated: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function closeMemoryPool(): Promise<void> {
  if (!memoryPool) return;

  await memoryPool.end();
  memoryPool = null;

  console.log("[MemoryDB] PostgreSQL pool closed");
}