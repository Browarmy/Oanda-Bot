# OANDA v3 Bot - Feature Tracker

## Core Features
- [x] Preserve all v2 functionality (SSE streaming, candle building, signal engine, auto-execution)
- [x] Self-learning adaptive signal engine (track signal outcomes, adjust thresholds dynamically)
- [x] Persistent trade history database schema
- [x] Equity curve tracking and NAV snapshots
- [x] Session filter configuration (London, New York, Tokyo, Sydney)
- [x] Daily loss guard with configurable drawdown limit
- [x] Performance analytics dashboard with metrics
- [x] Dark terminal-style UI matching v2 aesthetic

## Database Schema
- [x] trades table (entry/exit price, PnL, signal type, instrument, period, timestamp)
- [x] equity_snapshots table (NAV, timestamp, trade_id)
- [x] signal_performance table (signal type, outcome, RSI band, confidence)
- [x] session_config table (session windows, enabled status)
- [x] daily_loss_guard table (daily limit, current drawdown, pause status)

## Backend Implementation
- [x] tRPC procedures for trade logging
- [x] tRPC procedures for equity snapshots
- [x] tRPC procedures for analytics queries
- [x] Adaptive signal engine logic (win/loss tracking, threshold adjustment)
- [x] Session filter logic (check if current time is in active session)
- [x] Daily loss guard logic (track daily PnL, pause trading when limit breached)

## Frontend - Main Trading UI
- [x] Convert v2 JSX to React component in /pages/TradingBot.tsx
- [x] Preserve all v2 UI elements (signal display, live candle, positions, config)
- [x] Implement dark terminal aesthetic with sidebar layout
- [x] Add session filter status indicator
- [x] Add daily loss guard status indicator

## Frontend - Analytics Dashboard
- [x] Win rate metric
- [x] Average risk/reward ratio
- [x] Profit factor calculation
- [x] Total PnL display
- [x] Best/worst trade breakdown
- [x] Per-signal-type performance breakdown
- [x] Equity curve chart (interactive, sourced from database)

## Frontend - Configuration
- [x] Session window editor (London, New York, Tokyo, Sydney)
- [x] Daily loss guard percentage input
- [x] Adaptive signal engine threshold display/adjustment UI

## Integration & Testing
- [x] Test SSE streaming with trade logging
- [x] Test adaptive signal engine adjustments
- [x] Test session filter blocking trades outside active windows
- [x] Test daily loss guard pausing trading
- [x] Test analytics queries from persistent data
- [x] Verify dark terminal UI consistency

## Cloud Deployment Features
- [x] Standalone bot engine (bot-engine.ts) with SSE streaming
- [x] Bot runner script for cloud deployment (bot-runner.ts)
- [x] Monitoring API for iPhone dashboard (bot-monitor.ts)
- [x] Dockerfile for containerized deployment
- [x] Procfile for Heroku/Railway deployment
- [x] Cloud deployment documentation (CLOUD_DEPLOYMENT.md)
- [x] Environment variable configuration
- [x] TypeScript compilation successful

## Completed

## Multi-Instrument Scanner (NEW)
- [x] Create multi-bot-manager.ts with 20+ major FX pairs scanning
- [x] Implement per-pair signal evaluation (EMA, RSI, MACD, ADX, Stochastic RSI)
- [x] Implement concurrent position tracking per instrument
- [x] Wire multi-bot into tRPC routers (getMultiStatus, startMulti, stopMulti, updateMultiConfig, updateMultiSessions)
- [x] Create MarketScanner component to display all pairs with signal strength and trend
- [x] Add Market Scanner tab to Dashboard
- [x] Create Watchlist Editor to enable/disable specific pairs
- [x] Wire WatchlistEditor to real multi-bot status (getMultiStatus)
- [x] Add per-pair risk limit configuration (global risk with per-pair tracking)
- [x] Implement performance heatmap showing win rate by pair and session
- [x] Fix heatmap to use correct trade timestamps (openTime)

## Render Deployment (NEW)
- [x] Create comprehensive Render deployment guide (RENDER_DEPLOYMENT.md)
- [x] Create quick-start deployment script (RENDER_QUICK_START.md)
- [x] Create environment variable template (.env.render.example)
- [ ] Deploy to Render free tier
- [ ] Verify multi-pair streaming on Render
- [ ] Test order placement and trade execution
- [ ] Monitor performance for 24-48 hours
- [ ] Optimize signal filter for 75-90% win rate target
- [ ] Analyze performance heatmap and adjust watchlist
