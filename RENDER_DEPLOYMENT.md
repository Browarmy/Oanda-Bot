# OANDA v3 Multi-Instrument Trading Bot — Render Deployment Guide

This guide walks you through deploying the latest multi-instrument bot to Render's free tier with a fresh database and optimized trading parameters.

---

## Prerequisites

- **Render Account** — Sign up at [render.com](https://render.com) (free tier available)
- **OANDA Practice Account** — Your existing credentials (token, account ID)
- **GitHub Account** — To push code to a repository (Render deploys from Git)

---

## Step 1: Prepare Your Code for Deployment

### 1.1 Create a GitHub Repository

```bash
cd /home/ubuntu/oanda-v3-bot
git init
git add .
git commit -m "Multi-instrument bot with market scanner and analytics"
git remote add origin https://github.com/YOUR_USERNAME/oanda-v3-bot.git
git push -u origin main
```

### 1.2 Verify Deployment Files Exist

Ensure these files are in your repo root:

- `Procfile` — Tells Render how to start the bot
- `package.json` — Dependencies and build scripts
- `tsconfig.json` — TypeScript configuration
- `.env.example` — Template for environment variables

If `Procfile` doesn't exist, create it:

```bash
cat > Procfile << 'EOF'
web: npm run build && npm run start
EOF
```

---

## Step 2: Create a Render Web Service

### 2.1 Log In to Render Dashboard

1. Go to [dashboard.render.com](https://dashboard.render.com)
2. Click **New +** → **Web Service**
3. Select **Deploy an existing Git repository**
4. Paste your GitHub repo URL and click **Connect**

### 2.2 Configure the Web Service

| Setting | Value |
|---------|-------|
| **Name** | `oanda-v3-bot` |
| **Environment** | `Node` |
| **Region** | `Frankfurt (EU)` (closest to OANDA servers) |
| **Branch** | `main` |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm run start` |
| **Plan** | `Free` |

### 2.3 Add Environment Variables

Click **Environment** and add these variables:

```
OANDA_ENVIRONMENT=practice
OANDA_API_TOKEN=<your-oanda-token>
OANDA_ACCOUNT_ID=<your-oanda-account-id>
RISK_PERCENT=3
TP_MULTIPLIER=2
SL_MULTIPLIER=1
CANDLE_PERIOD=300
MAX_CONCURRENT_TRADES=5
DATABASE_URL=<will-be-set-in-step-3>
JWT_SECRET=<generate-random-string>
VITE_APP_TITLE=OANDA v3 Bot
VITE_APP_ID=<from-manus>
OAUTH_SERVER_URL=<from-manus>
VITE_OAUTH_PORTAL_URL=<from-manus>
```

**To generate JWT_SECRET:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Step 3: Create a PostgreSQL Database

### 3.1 Create a Render PostgreSQL Instance

1. In Render Dashboard, click **New +** → **PostgreSQL**
2. Configure:
   - **Name**: `oanda-bot-db`
   - **Database**: `oanda_bot`
   - **User**: `postgres`
   - **Region**: `Frankfurt (EU)`
   - **Plan**: `Free` (0.5 GB storage)

3. Click **Create Database**

### 3.2 Copy Connection String

Once created, copy the **External Database URL** (looks like):

```
postgresql://user:password@host:5432/database
```

### 3.3 Add to Web Service

1. Go back to your Web Service
2. Click **Environment**
3. Update `DATABASE_URL` with the PostgreSQL connection string

---

## Step 4: Deploy and Verify

### 4.1 Trigger Initial Deployment

1. Click **Deploy** on the Web Service page
2. Watch the build logs — should complete in 2-3 minutes
3. Once live, you'll get a URL like `https://oanda-v3-bot.onrender.com`

### 4.2 Initialize Database Schema

The bot will auto-create tables on first run. To verify:

```bash
# SSH into Render (if available) or use the logs to confirm
# Look for: "[DB] Connected successfully" or similar
```

### 4.3 Test the Bot

**Access the Dashboard:**

```
https://oanda-v3-bot.onrender.com
```

**Check Bot Status:**

1. Log in with your OANDA credentials
2. Go to **Overview** tab
3. Verify "Bot Engine" shows connection status
4. Check **Market Scanner** tab — should show all 10 enabled pairs

**Verify Multi-Pair Streaming:**

1. Go to **Market Scanner** tab
2. Wait 10-15 seconds for price updates
3. Confirm bid/ask prices update for all pairs
4. Signal strength should gradually populate as candles build

---

## Step 5: Configure Trading Parameters

### 5.1 Access Settings

1. Open Dashboard → **Settings** tab
2. Scroll to **Multi-Instrument Scanner** section

### 5.2 Verify Configuration

| Parameter | Value |
|-----------|-------|
| **Risk per Trade** | 3% |
| **Max Concurrent Trades** | 5 |
| **Candle Period** | 300 seconds |
| **Enabled Pairs** | Top 10 (GBP/USD, EUR/USD, USD/JPY, etc.) |

### 5.3 Configure Sessions

1. Go to **Settings** → **Trading Sessions**
2. Enable:
   - ✅ London (08:00-17:00 UTC)
   - ✅ New York (13:00-21:00 UTC)
   - ☐ Tokyo (00:00-09:00 UTC) — optional
   - ☐ Sydney (22:00-07:00 UTC) — optional

3. Click **Save Sessions**

---

## Step 6: Monitor the Bot

### 6.1 Live Monitoring

**Dashboard Tabs:**

- **Overview** — Equity curve, daily P&L, bot status
- **Market Scanner** — Real-time signal strength for all pairs
- **Positions** — Open trades with live charts
- **Analytics** — Win rate heatmap by pair and session
- **Diagnostics** — EMA, RSI, ATR, spread data

### 6.2 View Logs

1. In Render Dashboard, click **Logs**
2. Look for:
   - `[MULTI-BOT] Starting stream for X pairs`
   - `[PRICE] Bid/Ask updates`
   - `[TRADE] Order placed successfully`
   - Any error messages

### 6.3 Set Up Notifications

1. Go to Dashboard → **Settings** → **Notifications**
2. Enable trade alerts (optional)
3. Trades will trigger notifications when opened/closed

---

## Step 7: Optimize for 75-90% Win Rate

### 7.1 Monitor Performance Heatmap

1. Go to **Analytics** tab
2. Review win rate by pair and session
3. Identify high-performing combinations:
   - Which pairs have ≥70% win rate?
   - Which sessions are most profitable?

### 7.2 Adjust Watchlist

1. Go to **Settings** → **Multi-Instrument Scanner**
2. Focus on top-performing pairs
3. Consider disabling underperforming pairs
4. Save changes

### 7.3 Fine-Tune Signal Filters

After 50-100 trades, analyze:

- **Signal Strength Threshold** — Currently 80%. Consider 75% for more trades or 85% for higher quality
- **RSI Bands** — Adjust overbought (70) / oversold (30) thresholds
- **ADX Filter** — Currently requires ADX > 25 for trend confirmation
- **Risk per Trade** — Currently 3%. Consider 2.5% for more conservative approach

---

## Step 8: Troubleshooting

### Issue: Bot Not Streaming

**Symptoms:** Market Scanner shows no price updates

**Solution:**

1. Check OANDA credentials in Environment variables
2. Verify OANDA_ENVIRONMENT is set to `practice`
3. Confirm OANDA account has active API access
4. Restart the service: Click **Restart** in Render dashboard

### Issue: Database Connection Error

**Symptoms:** "Failed to connect to database" in logs

**Solution:**

1. Verify DATABASE_URL is correct in Environment
2. Check PostgreSQL instance is running (Render dashboard)
3. Ensure IP whitelist allows Render servers (usually automatic)
4. Restart the service

### Issue: Trades Not Executing

**Symptoms:** Signal strength shows 80%+ but no trades placed

**Solution:**

1. Check session window is active (Settings → Trading Sessions)
2. Verify max concurrent trades not reached (Market Scanner tab)
3. Check daily loss guard not triggered (Overview tab)
4. Review bot logs for order placement errors

### Issue: High Latency or Timeouts

**Symptoms:** Slow price updates, delayed order execution

**Solution:**

1. Render free tier may have resource constraints
2. Consider upgrading to Render's paid tier ($7/month)
3. Or switch to Oracle Cloud free tier (more resources)

---

## Step 9: Maintenance

### Daily Checks

- [ ] Dashboard loads without errors
- [ ] Market Scanner shows live price updates
- [ ] Positions tab reflects open trades
- [ ] Analytics tab shows updated win rate

### Weekly Reviews

- [ ] Check performance heatmap for optimization opportunities
- [ ] Review closed trades for signal quality
- [ ] Adjust watchlist if needed
- [ ] Monitor logs for any warnings

### Monthly Optimization

- [ ] Analyze 30+ days of trade data
- [ ] Identify best-performing pairs and sessions
- [ ] Update signal thresholds based on win rate
- [ ] Consider enabling/disabling pairs

---

## Step 10: Upgrade Path (Optional)

If you outgrow the free tier:

### Render Paid Tier

- **Cost**: $7/month (Web Service) + $15/month (PostgreSQL)
- **Benefits**: 100 GB storage, more compute, better uptime

### Oracle Cloud Always-Free

- **Cost**: $0 (always free)
- **Benefits**: 2 vCPUs, 12 GB RAM, 200 GB storage
- **Setup**: More complex, requires Docker

### DigitalOcean App Platform

- **Cost**: $5-12/month
- **Benefits**: Simple deployment, good documentation

---

## Deployment Checklist

- [ ] GitHub repository created and pushed
- [ ] Render Web Service created
- [ ] PostgreSQL database created
- [ ] Environment variables configured
- [ ] Initial deployment completed
- [ ] Database schema initialized
- [ ] Dashboard accessible
- [ ] Market Scanner showing live prices
- [ ] OANDA credentials verified
- [ ] Trading sessions configured
- [ ] First trade executed successfully
- [ ] Monitoring and alerts set up

---

## Support & Monitoring

**Render Status Page**: [status.render.com](https://status.render.com)

**OANDA API Status**: Check your OANDA account dashboard

**Bot Logs**: Available in Render dashboard → Logs

**Common Issues**: See Troubleshooting section above

---

## Next Steps

1. **Deploy to Render** using this guide
2. **Monitor for 24-48 hours** to confirm stable operation
3. **Collect trade data** (50+ trades minimum)
4. **Analyze performance heatmap** to identify optimization opportunities
5. **Adjust signal filters** based on win rate analysis
6. **Target 75-90% win rate** through continuous refinement

Good luck! 🚀
