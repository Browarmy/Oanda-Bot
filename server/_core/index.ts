import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { memoryMigrationStartup } from "../memory/migrationRunner";
import { memoryQuery } from "../memory/memory-db";
import { decisionJournal } from "../decision-journal";


function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  await memoryMigrationStartup;

  const app = express();
  const server = createServer(app);

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerStorageProxy(app);
  registerOAuthRoutes(app);

  app.get("/api/memory-status", async (_req, res) => {
    const { getPersistentMemoryStatus } = await import("../persistent-memory");
    res.json(await getPersistentMemoryStatus());
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  app.get("/api/memory-health", async (_req, res) => {
    try {
      const rows = await memoryQuery<{
        total_observations: string;
        quality_observations: string;
        last_observed_at: string | null;
        last_created_at: string | null;
      }>(`
        SELECT
          COUNT(*)::text AS total_observations,
          COUNT(*) FILTER (WHERE memory_quality_score >= 0.7)::text AS quality_observations,
          MAX(observed_at)::text AS last_observed_at,
          MAX(created_at)::text AS last_created_at
        FROM memory_observations
      `);

      const row = rows[0];

      res.json({
        ok: true,
        database: "postgresql",
        isolated: true,
        totalObservations: Number(row?.total_observations ?? 0),
        qualityObservations: Number(row?.quality_observations ?? 0),
        lastObservedAt: row?.last_observed_at ?? null,
        lastCreatedAt: row?.last_created_at ?? null,
        qualityThreshold: 0.7,
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        database: "postgresql",
        isolated: true,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received — flushing pending state before exit...`);

    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5000));
    await Promise.race([decisionJournal.flushNow(), timeout]);

    server.close(() => process.exit(0));
    // Force-exit if something (e.g. an open DB connection) keeps the server alive.
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}


startServer().catch(console.error);