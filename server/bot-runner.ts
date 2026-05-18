/**
 * Standalone Bot Runner
 * Deploy this as a background service on DigitalOcean, Railway, or Render
 * 
 * Usage:
 *   npx tsx server/bot-runner.ts
 * 
 * Environment variables:
 *   OANDA_TOKEN - Your OANDA API token
 *   OANDA_ACCOUNT_ID - Your OANDA account ID
 *   USER_ID - Your user ID in the database
 *   INSTRUMENT - Trading instrument (default: GBP_USD)
 *   CANDLE_PERIOD - Candle period in seconds (default: 300)
 *   RISK_PERCENT - Risk per trade (default: 2)
 *   TP_MULTIPLIER - Take profit multiplier (default: 2)
 *   SL_MULTIPLIER - Stop loss multiplier (default: 1)
 *   MAX_TRADES - Max open trades (default: 1)
 */

import { TradingBotEngine } from "./bot-engine";
import { getDb } from "./db";

// Load environment variables
const config = {
  userId: parseInt(process.env.USER_ID || "1"),
  oandaToken: process.env.OANDA_TOKEN || "",
  accountId: process.env.OANDA_ACCOUNT_ID || "",
  instrument: process.env.INSTRUMENT || "GBP_USD",
  candlePeriod: parseInt(process.env.CANDLE_PERIOD || "300"),
  riskPercent: parseFloat(process.env.RISK_PERCENT || "2"),
  tpMultiplier: parseFloat(process.env.TP_MULTIPLIER || "2"),
  slMultiplier: parseFloat(process.env.SL_MULTIPLIER || "1"),
  maxOpenTrades: parseInt(process.env.MAX_TRADES || "1"),
};

// Validate required environment variables
if (!config.oandaToken || !config.accountId) {
  console.error("❌ Error: OANDA_TOKEN and OANDA_ACCOUNT_ID environment variables are required");
  process.exit(1);
}

// Initialize bot engine
const bot = new TradingBotEngine(config);

// Event listeners
bot.on("started", () => {
  console.log("✓ Trading bot started");
});

bot.on("stopped", () => {
  console.log("✓ Trading bot stopped");
});

bot.on("tick", (data: any) => {
  if (data.signal.action !== "WAIT") {
    console.log(`[SIGNAL] ${data.signal.action} - ${data.signal.reason} (confidence: ${(data.signal.confidence * 100).toFixed(0)}%)`);
  }
});

bot.on("trade", (data: any) => {
  console.log(`[TRADE] ${data.signal.action} ${data.units} units @ ${data.stopLoss.toFixed(5)} SL / ${data.takeProfit.toFixed(5)} TP`);
});

bot.on("error", (error: any) => {
  console.error(`[ERROR] ${error.message}`);
});

// Start the bot
async function main() {
  console.log("🤖 OANDA v3 Trading Bot - Cloud Runner");
  console.log(`📊 Instrument: ${config.instrument}`);
  console.log(`⏱️  Candle Period: ${config.candlePeriod}s`);
  console.log(`💰 Risk per Trade: ${config.riskPercent}%`);
  console.log("");

  try {
    // Verify database connection
    const db = await getDb();
    if (!db) {
      console.error("❌ Database connection failed. Check DATABASE_URL environment variable.");
      process.exit(1);
    }
    console.log("✓ Database connected");

    // Start the bot
    await bot.start();

    // Graceful shutdown
    process.on("SIGINT", async () => {
      console.log("\n⏹️  Shutting down...");
      await bot.stop();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      console.log("\n⏹️  Shutting down...");
      await bot.stop();
      process.exit(0);
    });

    // Keep process alive
    console.log("🟢 Bot is running. Press Ctrl+C to stop.");
  } catch (error) {
    console.error("❌ Failed to start bot:", error);
    process.exit(1);
  }
}

main();
