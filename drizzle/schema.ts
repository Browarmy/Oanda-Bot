import { 
  int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, 
  boolean, datetime, json, float, index 
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Trade history: logs every executed trade with full context
 */
export const trades = mysqlTable("trades", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  oandaTradeId: varchar("oandaTradeId", { length: 64 }).notNull(),
  instrument: varchar("instrument", { length: 32 }).notNull(), // e.g., "GBP_USD"
  direction: mysqlEnum("direction", ["BUY", "SELL"]).notNull(),
  entryPrice: decimal("entryPrice", { precision: 10, scale: 5 }).notNull(),
  exitPrice: decimal("exitPrice", { precision: 10, scale: 5 }).notNull(),
  units: int("units").notNull(),
  pnl: decimal("pnl", { precision: 12, scale: 2 }).notNull(),
  pnlPercent: decimal("pnlPercent", { precision: 8, scale: 4 }).notNull(),
  signalType: mysqlEnum("signalType", ["CROSSOVER_BUY", "CROSSOVER_SELL", "RSI_PULLBACK_BUY", "RSI_PULLBACK_SELL"]).notNull(),
  rsiAtEntry: decimal("rsiAtEntry", { precision: 5, scale: 2 }).notNull(),
  atrAtEntry: decimal("atrAtEntry", { precision: 10, scale: 5 }).notNull(),
  stopLossPrice: decimal("stopLossPrice", { precision: 10, scale: 5 }).notNull(),
  takeProfitPrice: decimal("takeProfitPrice", { precision: 10, scale: 5 }).notNull(),
  candlePeriod: int("candlePeriod").notNull(), // in seconds (60, 300, 900, etc.)
  entryTime: datetime("entryTime").notNull(),
  exitTime: datetime("exitTime").notNull(),
  durationSeconds: int("durationSeconds").notNull(),
  sessionWindow: varchar("sessionWindow", { length: 32 }), // "LONDON", "NEW_YORK", "TOKYO", "SYDNEY"
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("userId_idx").on(table.userId),
  entryTimeIdx: index("entryTime_idx").on(table.entryTime),
  signalTypeIdx: index("signalType_idx").on(table.signalType),
}));

export type Trade = typeof trades.$inferSelect;
export type InsertTrade = typeof trades.$inferInsert;

/**
 * Equity snapshots: NAV recorded after each trade close
 */
export const equitySnapshots = mysqlTable("equitySnapshots", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tradeId: int("tradeId").notNull(),
  nav: decimal("nav", { precision: 12, scale: 2 }).notNull(),
  navPercent: decimal("navPercent", { precision: 8, scale: 4 }).notNull(), // % change from initial
  drawdownPercent: decimal("drawdownPercent", { precision: 8, scale: 4 }).notNull(), // % from peak
  timestamp: datetime("timestamp").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("userId_idx").on(table.userId),
  timestampIdx: index("timestamp_idx").on(table.timestamp),
}));

export type EquitySnapshot = typeof equitySnapshots.$inferSelect;
export type InsertEquitySnapshot = typeof equitySnapshots.$inferInsert;

/**
 * Signal performance tracking: adaptive learning data
 * Tracks win/loss outcomes per signal type to adjust thresholds dynamically
 */
export const signalPerformance = mysqlTable("signalPerformance", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  signalType: mysqlEnum("signalType", ["CROSSOVER_BUY", "CROSSOVER_SELL", "RSI_PULLBACK_BUY", "RSI_PULLBACK_SELL"]).notNull(),
  outcome: mysqlEnum("outcome", ["WIN", "LOSS"]).notNull(),
  pnl: decimal("pnl", { precision: 12, scale: 2 }).notNull(),
  rsiAtEntry: decimal("rsiAtEntry", { precision: 5, scale: 2 }).notNull(),
  rsiLowerBand: decimal("rsiLowerBand", { precision: 5, scale: 2 }).notNull(),
  rsiUpperBand: decimal("rsiUpperBand", { precision: 5, scale: 2 }).notNull(),
  confidence: int("confidence").notNull(), // 0-100
  tradeId: int("tradeId").notNull(),
  recordedAt: datetime("recordedAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("userId_idx").on(table.userId),
  signalTypeIdx: index("signalType_idx").on(table.signalType),
  recordedAtIdx: index("recordedAt_idx").on(table.recordedAt),
}));

export type SignalPerformance = typeof signalPerformance.$inferSelect;
export type InsertSignalPerformance = typeof signalPerformance.$inferInsert;

/**
 * Session configuration: trading windows for each session
 */
export const sessionConfig = mysqlTable("sessionConfig", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  sessionName: mysqlEnum("sessionName", ["LONDON", "NEW_YORK", "TOKYO", "SYDNEY"]).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  startHour: int("startHour").notNull(), // 0-23 UTC
  startMinute: int("startMinute").default(0).notNull(),
  endHour: int("endHour").notNull(),
  endMinute: int("endMinute").default(0).notNull(),
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userIdIdx: index("userId_idx").on(table.userId),
  sessionNameIdx: index("sessionName_idx").on(table.sessionName),
}));

export type SessionConfig = typeof sessionConfig.$inferSelect;
export type InsertSessionConfig = typeof sessionConfig.$inferInsert;

/**
 * Daily loss guard: tracks daily drawdown and pause status
 */
export const dailyLossGuard = mysqlTable("dailyLossGuard", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
  maxDrawdownPercent: decimal("maxDrawdownPercent", { precision: 8, scale: 4 }).notNull(),
  currentDrawdownPercent: decimal("currentDrawdownPercent", { precision: 8, scale: 4 }).default('0.0000').notNull(),
  isPaused: boolean("isPaused").default(false).notNull(),
  pausedAt: datetime("pausedAt"),
  initialNav: decimal("initialNav", { precision: 12, scale: 2 }).notNull(),
  peakNav: decimal("peakNav", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userIdIdx: index("userId_idx").on(table.userId),
  dateIdx: index("date_idx").on(table.date),
}));

export type DailyLossGuard = typeof dailyLossGuard.$inferSelect;
export type InsertDailyLossGuard = typeof dailyLossGuard.$inferInsert;

/**
 * Adaptive signal thresholds: current dynamic settings per signal type
 */
export const adaptiveThresholds = mysqlTable("adaptiveThresholds", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  signalType: mysqlEnum("signalType", ["CROSSOVER_BUY", "CROSSOVER_SELL", "RSI_PULLBACK_BUY", "RSI_PULLBACK_SELL"]).notNull(),
  rsiLowerBand: decimal("rsiLowerBand", { precision: 5, scale: 2 }).notNull(), // default 25
  rsiUpperBand: decimal("rsiUpperBand", { precision: 5, scale: 2 }).notNull(), // default 75
  confidenceThreshold: int("confidenceThreshold").notNull(), // 0-100
  winRate: decimal("winRate", { precision: 5, scale: 2 }).default('0.00').notNull(), // %
  lastUpdated: datetime("lastUpdated").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("userId_idx").on(table.userId),
  signalTypeIdx: index("signalType_idx").on(table.signalType),
}));

export type AdaptiveThreshold = typeof adaptiveThresholds.$inferSelect;
export type InsertAdaptiveThreshold = typeof adaptiveThresholds.$inferInsert;
