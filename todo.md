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

## Completed
