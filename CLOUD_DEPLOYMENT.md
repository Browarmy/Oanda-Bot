# OANDA v3 Trading Bot - Cloud Deployment Guide

This guide explains how to deploy the trading bot to run 24/7 on a cloud server.

## Overview

The bot runs as a background service that:
- Connects to OANDA via SSE streaming
- Executes trades automatically based on your signal engine
- Tracks all trades and equity in a database
- Provides a web dashboard for monitoring from your iPhone

## Deployment Options

### Option 1: Railway (Recommended - £4/month)

1. **Create a Railway account** at [railway.app](https://railway.app)

2. **Connect your GitHub repository**
   - Fork this repo or push to your own GitHub
   - Click "New Project" → "Deploy from GitHub"
   - Select this repository

3. **Set environment variables** in Railway:
   ```
   DATABASE_URL=your_database_url
   OANDA_TOKEN=your_oanda_api_token
   OANDA_ACCOUNT_ID=your_account_id
   USER_ID=1
   INSTRUMENT=GBP_USD
   CANDLE_PERIOD=300
   RISK_PERCENT=2
   TP_MULTIPLIER=2
   SL_MULTIPLIER=1
   MAX_TRADES=1
   ```

4. **Deploy**
   - Railway automatically deploys on push
   - The bot runs continuously in the background

### Option 2: DigitalOcean (£4/month)

1. **Create a Droplet**
   - Ubuntu 22.04 LTS, Basic Plan (£4/month)
   - Add SSH key for secure access

2. **SSH into your droplet**
   ```bash
   ssh root@your_droplet_ip
   ```

3. **Install dependencies**
   ```bash
   apt update && apt upgrade -y
   apt install -y nodejs npm git mysql-server
   npm install -g pnpm
   ```

4. **Clone and setup**
   ```bash
   git clone https://github.com/yourusername/oanda-v3-bot.git
   cd oanda-v3-bot
   pnpm install
   ```

5. **Set environment variables**
   ```bash
   cat > .env << EOF
   DATABASE_URL=mysql://user:password@localhost:3306/oanda_bot
   OANDA_TOKEN=your_oanda_api_token
   OANDA_ACCOUNT_ID=your_account_id
   USER_ID=1
   INSTRUMENT=GBP_USD
   CANDLE_PERIOD=300
   RISK_PERCENT=2
   TP_MULTIPLIER=2
   SL_MULTIPLIER=1
   MAX_TRADES=1
   EOF
   ```

6. **Setup database**
   ```bash
   mysql -u root -p < setup_database.sql
   pnpm run db:push
   ```

7. **Run with PM2 (process manager)**
   ```bash
   npm install -g pm2
   pm2 start "npx tsx server/bot-runner.ts" --name "oanda-bot"
   pm2 startup
   pm2 save
   ```

### Option 3: Render (Similar to Railway)

1. Go to [render.com](https://render.com)
2. Create new "Web Service"
3. Connect GitHub repository
4. Set environment variables (same as Railway)
5. Deploy

## Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `DATABASE_URL` | Yes | MySQL connection string | `mysql://user:pass@host/db` |
| `OANDA_TOKEN` | Yes | Your OANDA API token | `abc123...` |
| `OANDA_ACCOUNT_ID` | Yes | Your OANDA account ID | `123-456-789` |
| `USER_ID` | No | Database user ID (default: 1) | `1` |
| `INSTRUMENT` | No | Trading pair (default: GBP_USD) | `GBP_USD` |
| `CANDLE_PERIOD` | No | Candle period in seconds (default: 300) | `300` |
| `RISK_PERCENT` | No | Risk per trade % (default: 2) | `2` |
| `TP_MULTIPLIER` | No | Take profit multiplier (default: 2) | `2` |
| `SL_MULTIPLIER` | No | Stop loss multiplier (default: 1) | `1` |
| `MAX_TRADES` | No | Max open trades (default: 1) | `1` |

## Monitoring from iPhone

1. **Access the dashboard**
   - Web: `https://your-domain.com/trading`
   - The dashboard shows:
     - Real-time bot status
     - Trade history
     - Equity curve
     - Performance analytics
     - Session filter status
     - Daily loss guard status

2. **API endpoints** (for custom apps)
   - `GET /api/bot/status` - Current bot status
   - `GET /api/bot/trades` - Trade history
   - `GET /api/bot/analytics` - Performance metrics
   - `GET /api/bot/equity-curve` - Equity curve data
   - `POST /api/bot/pause` - Pause trading
   - `POST /api/bot/resume` - Resume trading

## Logs and Debugging

### View logs on Railway
```
railway logs
```

### View logs on DigitalOcean
```
pm2 logs oanda-bot
```

### Check bot status
```
curl https://your-domain.com/api/bot/status
```

## Cost Breakdown

| Service | Cost | Notes |
|---------|------|-------|
| Railway | £4/month | Includes database |
| DigitalOcean | £4/month | Droplet only; database separate |
| Domain | £1-10/month | Optional custom domain |
| **Total** | **~£5-15/month** | 24/7 trading execution |

## Troubleshooting

### Bot not executing trades
- Check `OANDA_TOKEN` and `OANDA_ACCOUNT_ID` are correct
- Verify database connection: `DATABASE_URL`
- Check logs: `railway logs` or `pm2 logs oanda-bot`

### High latency/delays
- Ensure candle period matches your strategy
- Check OANDA API status: https://status.oanda.com

### Database errors
- Verify `DATABASE_URL` is correct
- Run migrations: `pnpm run db:push`
- Check database user permissions

## Next Steps

1. **Get OANDA API credentials**
   - Sign up at [oanda.com](https://www.oanda.com)
   - Generate API token in account settings
   - Copy your account ID

2. **Set up database**
   - Use Railway's built-in PostgreSQL, or
   - Set up MySQL on DigitalOcean

3. **Deploy**
   - Choose Railway, DigitalOcean, or Render
   - Follow the setup steps above
   - Monitor from your iPhone dashboard

4. **Monitor and adjust**
   - Watch the equity curve
   - Adjust risk parameters as needed
   - Monitor session filters and daily loss guard

## Support

For issues or questions:
- Check logs: `railway logs` or `pm2 logs`
- Review OANDA API docs: https://developer.oanda.com
- Verify environment variables are set correctly
