# Render Deployment — Quick Start (5 Minutes)

## TL;DR Steps

### 1. Push to GitHub

```bash
cd /home/ubuntu/oanda-v3-bot
git init
git add .
git commit -m "Multi-instrument bot v1"
git remote add origin https://github.com/YOUR_USERNAME/oanda-v3-bot.git
git push -u origin main
```

### 2. Create Render Web Service

1. Go to [render.com](https://render.com) → Sign up (free)
2. Click **New +** → **Web Service**
3. Connect your GitHub repo
4. Set:
   - **Name**: `oanda-v3-bot`
   - **Build**: `npm install && npm run build`
   - **Start**: `npm run start`
   - **Plan**: Free

### 3. Create PostgreSQL Database

1. Click **New +** → **PostgreSQL**
2. Set:
   - **Name**: `oanda-bot-db`
   - **Plan**: Free
3. Copy the **External Database URL**

### 4. Add Environment Variables

In Web Service settings, add:

```
OANDA_ENVIRONMENT=practice
OANDA_API_TOKEN=<your-token>
OANDA_ACCOUNT_ID=<your-account-id>
RISK_PERCENT=3
TP_MULTIPLIER=2
SL_MULTIPLIER=1
CANDLE_PERIOD=300
MAX_CONCURRENT_TRADES=5
DATABASE_URL=<postgresql-url-from-step-3>
JWT_SECRET=<run: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
VITE_APP_TITLE=OANDA v3 Bot
VITE_APP_ID=<from-manus>
OAUTH_SERVER_URL=https://api.manus.im
VITE_OAUTH_PORTAL_URL=https://manus.im
```

### 5. Deploy

1. Click **Deploy** in Render dashboard
2. Wait 2-3 minutes for build to complete
3. Visit your bot at `https://oanda-v3-bot.onrender.com`

### 6. Verify

1. Log in with OANDA credentials
2. Go to **Market Scanner** tab
3. Confirm prices updating for all pairs
4. Go to **Settings** → verify 3% risk is set
5. Enable trading sessions and start bot

---

## That's It! 🎉

Your bot is now running 24/7 on Render's free tier.

**Next Steps:**
- Monitor the dashboard for 24 hours
- Check Analytics tab after first trades
- Optimize based on performance heatmap

See `RENDER_DEPLOYMENT.md` for detailed troubleshooting and optimization guide.
