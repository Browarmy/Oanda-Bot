/**
 * Autonomous Bot Worker
 * Runs as the Railway worker process — reads OANDA credentials from env vars
 * and starts the full autonomous trading engine.
 *
 * Environment variables:
 *   OANDA_API_TOKEN      - Your OANDA API token (from hub.oanda.com → Tools → API)
 *   OANDA_ACCOUNT_ID     - Your OANDA account ID (e.g. 101-004-12345678-001)
 *   OANDA_ENVIRONMENT    - "practice" or "live" (default: practice)
 */
import { autonomousEngine } from "./autonomous-engine";

const token = process.env.OANDA_API_TOKEN ?? process.env.OANDA_TOKEN ?? "";
const accountId = process.env.OANDA_ACCOUNT_ID ?? "";
const environment = (process.env.OANDA_ENVIRONMENT ?? "practice") as "practice" | "live";

if (!token || !accountId) {
  console.error("❌ OANDA_API_TOKEN and OANDA_ACCOUNT_ID environment variables are required.");
  console.error("   Set them in Railway → Variables for both web and worker services.");
  process.exit(1);
}

console.log("🤖 OANDA v3 Autonomous Bot Worker starting...");
console.log(`   Environment : ${environment.toUpperCase()}`);
console.log(`   Account ID  : ${accountId}`);
console.log("OANDA token loaded");

async function main() {
  try {
    autonomousEngine.init(token, accountId, environment);
    await autonomousEngine.start();
    console.log("✅ Autonomous engine started — scanning all pairs");

    // Graceful shutdown
    const shutdown = () => {
      console.log("\n⏹️  Shutting down autonomous engine...");
      autonomousEngine.stop();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Keep process alive with periodic status log
    setInterval(() => {
      const state = autonomousEngine.getState();
      const wr = state.totalTrades > 0
        ? ((state.totalWins / state.totalTrades) * 100).toFixed(1)
        : "0.0";
      console.log(`[Worker] Status: ${state.isLive ? "LIVE" : state.isPaused ? "PAUSED" : "RUNNING"} | Trades: ${state.totalTrades} | Win rate: ${wr}%`);
    }, 60_000);

  } catch (err: any) {
    console.error("❌ Failed to start autonomous engine:", err?.message ?? err);
    process.exit(1);
  }
}

main();
