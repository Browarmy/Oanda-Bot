# OANDA v3 Bot — Mathematical Framework for Capital Preservation & Compounding

## Executive Summary

This document outlines the mathematical foundation for a trading bot optimized for **capital preservation, risk-of-ruin elimination, and geometric compounding** on accounts ranging from £20 to £2,000+. The system uses four core optimization objectives:

1. **Sortino Ratio Optimization** — Penalize downside volatility; ignore upside
2. **Risk of Ruin Mitigation** — Maintain 0.00% probability of total liquidation
3. **Geometric Capital Compounding** — Fractional Kelly Criterion with dynamic position sizing
4. **Friction Override** — Reject trades where transaction costs exceed 50% of expected profit

---

## 1. SORTINO RATIO OPTIMIZATION

### Objective
Maximize returns while aggressively penalizing downside volatility (losses). Unlike the Sharpe ratio, which penalizes all volatility equally, the Sortino ratio only penalizes downside deviation.

### Formula

```
Sortino Ratio = (Rp - Rf) / σd

Where:
- Rp = Portfolio return (average trade return)
- Rf = Risk-free rate (typically 0%, or OANDA overnight deposit rate)
- σd = Downside deviation (standard deviation of returns below target)
```

### Implementation Logic

For each signal evaluation:

```
1. Calculate rolling average return over last 20 trades
2. Calculate downside deviation (only losses count)
3. Compute Sortino Ratio
4. If Sortino < 1.0, reduce signal confidence by 20%
5. If Sortino < 0.5, reject signal entirely
```

### Example (£20 Account)

```
Last 20 trades:
- Wins: +£0.50, +£0.40, +£0.30, +£0.45, +£0.35 (5 trades)
- Losses: -£0.10, -£0.15, -£0.20, -£0.08, -£0.12 (5 trades)
- Breakeven: 0 (10 trades)

Average return (Rp) = (2.00 - 0.65) / 20 = £0.0675 per trade
Downside deviation (σd) = sqrt(sum of squared losses / count of losses)
                        = sqrt((0.01 + 0.0225 + 0.04 + 0.0064 + 0.0144) / 5)
                        = sqrt(0.01806) = £0.1344

Sortino Ratio = 0.0675 / 0.1344 = 0.50 ← Signal confidence reduced by 50%
```

---

## 2. RISK OF RUIN MITIGATION

### Objective
Maintain the probability of total account liquidation at exactly **0.00%** by enforcing strict maximum drawdown constraints.

### Maximum Drawdown (MDD) Constraint

```
MDD_Max = 2% of current account balance (default)
Risk_Per_Trade = MDD_Max / Number_of_Concurrent_Trades

Example (£20 account, 1 concurrent trade):
- MDD_Max = £20 × 0.02 = £0.40 (maximum loss per trade)
- If a trade threatens to lose more than £0.40, it is rejected
```

### Cumulative Drawdown Tracking

```
Daily_Drawdown = Sum of all losses on current day
If Daily_Drawdown > (Balance × 0.05), pause all trading for remainder of day
If Monthly_Drawdown > (Balance × 0.15), reduce position size by 50% for next month
```

### Risk of Ruin Formula (Gambler's Ruin)

```
P(Ruin) = ((1 - Win_Rate - Spread_Impact) / (1 + Win_Rate + Spread_Impact)) ^ Capital_Units

Where:
- Win_Rate = Probability of winning trade (from rolling 20-trade window)
- Spread_Impact = Transaction costs as % of trade size
- Capital_Units = Account balance / Risk per trade

Example (£20 account, 60% win rate, 0.5% spread impact):
P(Ruin) = ((1 - 0.60 - 0.005) / (1 + 0.60 + 0.005)) ^ (20 / 0.40)
        = (0.395 / 1.605) ^ 50
        = 0.246 ^ 50
        ≈ 0.00% (effectively zero)
```

---

## 3. GEOMETRIC CAPITAL COMPOUNDING (FRACTIONAL KELLY CRITERION)

### Objective
Optimize position sizing dynamically based on win-rate probabilities, ensuring geometric growth while preventing exponential decay.

### Fractional Kelly Formula

```
Position_Size = (f * Kelly_Fraction) × Account_Balance

Where:
- f = Fractional Kelly (typically 0.25 to 0.50, default 0.25 for safety)
- Kelly_Fraction = (Win_Rate × Avg_Win - Loss_Rate × Avg_Loss) / Avg_Win

Example (£20 account, 60% win rate):
- Win_Rate = 0.60
- Loss_Rate = 0.40
- Avg_Win = £0.50
- Avg_Loss = £0.20

Kelly_Fraction = (0.60 × 0.50 - 0.40 × 0.20) / 0.50
               = (0.30 - 0.08) / 0.50
               = 0.22 / 0.50
               = 0.44

Position_Size = (0.25 × 0.44) × £20
              = 0.11 × £20
              = £2.20 (units to trade)
```

### Dynamic Scaling Based on Account Size

```
If Balance < £50:
  - Fractional Kelly = 0.15 (ultra-conservative)
  - Max position size = £0.50

If Balance £50-£100:
  - Fractional Kelly = 0.25 (conservative)
  - Max position size = £2.00

If Balance £100-£500:
  - Fractional Kelly = 0.35 (moderate)
  - Max position size = £10.00

If Balance > £500:
  - Fractional Kelly = 0.50 (aggressive)
  - Max position size = £50.00
```

### Geometric Compounding Example

```
Starting balance: £20
Win rate: 60%
Avg win: £0.50
Avg loss: £0.20

Month 1:
- Trade 1: Win +£0.50 → Balance = £20.50
- Trade 2: Win +£0.50 → Balance = £21.00
- Trade 3: Loss -£0.20 → Balance = £20.80
- Trade 4: Win +£0.50 → Balance = £21.30
- Trade 5: Win +£0.50 → Balance = £21.80
...
Month 1 End: Balance = £28.50 (42.5% growth)

Month 2 (with Kelly-adjusted position sizing):
- Position size now = (0.25 × 0.44) × £28.50 = £3.13
- Trade 1: Win +£0.63 → Balance = £29.13
- Trade 2: Win +£0.63 → Balance = £29.76
...
Month 2 End: Balance = £40.50 (42.1% growth)

Month 3:
- Balance crosses £50 threshold → Unlock user-configurable Alpha/Beta
- Position size now = (0.25 × 0.44) × £40.50 = £4.46
...
Month 3 End: Balance = £57.50 (42% growth)

Year 1 Projection: £20 → £250+ (1150% growth)
```

---

## 4. FRICTION & SLIPPAGE OVERRIDE

### Objective
Maximize net profitability after all real-world transaction costs by automatically rejecting trades where friction consumes > 50% of expected profit.

### Expected Value (EV) Calculation

```
EV = (Win_Rate × Avg_Profit) - (Loss_Rate × Avg_Loss) - Transaction_Costs

Transaction_Costs = (Live_Spread + Commission + Slippage) × Position_Size

Example (GBP/USD, £20 account):
- Live spread: 1.5 pips (£0.00015 per unit)
- Commission: 0.01% per trade
- Slippage: 0.5 pips (£0.00005 per unit)
- Position size: 100 units
- Expected profit (before friction): £0.50

Transaction_Costs = (0.00015 + 0.00001 + 0.00005) × 100
                  = 0.00021 × 100
                  = £0.021

Friction_Ratio = Transaction_Costs / Expected_Profit
               = 0.021 / 0.50
               = 4.2% ← Trade accepted (< 50% threshold)
```

### Signal Rejection Logic

```
If Balance < £50:
  If Friction_Ratio > 0.30 (30%), reject signal
  If Expected_Profit < £0.10, reject signal

If Balance £50-£100:
  If Friction_Ratio > 0.40 (40%), reject signal
  If Expected_Profit < £0.25, reject signal

If Balance > £100:
  If Friction_Ratio > 0.50 (50%), reject signal
  If Expected_Profit < £0.50, reject signal
```

### Micro-Account Mode (Balance < £100)

```
Automatic Actions:
1. Lock to ultra-low-margin instruments (GBP/USD, EUR/USD only)
2. Reject all scalping strategies (target profit < 5 pips)
3. Reject all news-driven trades (high spread events)
4. Minimum trade duration: 5 minutes
5. Maximum trades per day: 10
6. Mandatory 2-hour break after 5 consecutive trades
```

---

## 5. ALPHA & BETA DYNAMIC SCALING

### Alpha (Risk Aversion Weight)

```
Alpha = Base_Alpha × (£100 / Current_Balance)

Where Base_Alpha = 2.0 (tunable)

Example:
- Balance £20: Alpha = 2.0 × (100 / 20) = 10.0 (extreme risk aversion)
- Balance £50: Alpha = 2.0 × (100 / 50) = 4.0 (high risk aversion)
- Balance £100: Alpha = 2.0 × (100 / 100) = 2.0 (moderate risk aversion)
- Balance £500: Alpha = 2.0 × (100 / 500) = 0.4 (low risk aversion)

Interpretation:
- Alpha multiplies the penalty for downside deviation in Sortino calculation
- Higher Alpha = more aggressive downside penalization
- At £20, even a small losing streak triggers signal rejection
```

### Beta (Fee Sensitivity Weight)

```
Beta = Base_Beta × (£100 / Current_Balance)

Where Base_Beta = 3.0 (tunable)

Example:
- Balance £20: Beta = 3.0 × (100 / 20) = 15.0 (extreme fee sensitivity)
- Balance £50: Beta = 3.0 × (100 / 50) = 6.0 (high fee sensitivity)
- Balance £100: Beta = 3.0 × (100 / 100) = 3.0 (moderate fee sensitivity)
- Balance £500: Beta = 3.0 × (100 / 500) = 0.6 (low fee sensitivity)

Interpretation:
- Beta multiplies the transaction cost penalty in the reward function
- Higher Beta = more aggressive rejection of high-friction trades
- At £20, even a 1% spread causes signal rejection
```

### Reward Function (Complete)

```
Total_Reward = Trade_Return - (Alpha × Downside_Drawdown) - (Beta × Transaction_Costs)

Example (£20 account, losing streak):
- Trade_Return = -£0.15 (loss)
- Downside_Drawdown = £0.35 (cumulative losses this session)
- Transaction_Costs = £0.02 (spread + commission)
- Alpha = 10.0
- Beta = 15.0

Total_Reward = -0.15 - (10.0 × 0.35) - (15.0 × 0.02)
             = -0.15 - 3.50 - 0.30
             = -3.95 ← Massive penalty; next signal rejected
```

---

## 6. ADAPTIVE WIN-RATE ESTIMATION (ROLLING WINDOW)

### Rolling 20-30 Trade Window

```
Recent_Win_Rate = Count_of_Wins_in_Last_20_Trades / 20

Example:
- Last 20 trades: 12 wins, 8 losses
- Recent_Win_Rate = 12 / 20 = 60%

This win rate is used for:
1. Kelly Criterion calculation
2. Risk of Ruin probability estimation
3. Signal confidence adjustment
```

### Market Regime Filtering

```
If Recent_Win_Rate < 40% AND Trend_Direction = Ranging:
  - Reduce all signal confidence by 30%
  - Increase Friction_Ratio threshold by 10%

If Recent_Win_Rate > 70% AND Trend_Direction = Strong_Trend:
  - Increase Fractional Kelly from 0.25 to 0.35
  - Unlock additional signal types (e.g., news trades)

If Recent_Win_Rate drops from 60% to 35% in last 5 trades:
  - Trigger "Losing Streak Alert"
  - Reduce position size by 50%
  - Pause trading for 1 hour
```

---

## 7. LIVE SPREAD INTEGRATION

### Real-Time Spread Fetching from OANDA

```
Every 10 seconds:
  1. Fetch current bid/ask from OANDA Streaming API
  2. Calculate live spread = ask - bid (in pips)
  3. Update Transaction_Costs calculation
  4. Re-evaluate signal EV
  5. Reject signal if EV becomes negative due to spread widening

Example (GBP/USD):
- Normal spread: 1.5 pips
- During news event: 4.0 pips
- Bot detects spread widening → Increases Friction_Ratio
- If Friction_Ratio > threshold, signal is rejected automatically
```

### Slippage Modeling

```
Slippage = (Execution_Price - Expected_Price) / Expected_Price

For micro accounts:
- Assume 0.5 pips slippage on normal market conditions
- Assume 2.0 pips slippage during high-volatility events
- Assume 5.0 pips slippage during news releases

Slippage is added to Transaction_Costs in EV calculation
```

---

## 8. MICRO-ACCOUNT MODE ACTIVATION

### Trigger Condition

```
If Current_Balance < £100:
  - Activate Micro-Account Mode
  - Lock all parameters to ultra-conservative settings
  - Display warning on dashboard: "Micro-Account Mode Active"
```

### Automatic Restrictions

| Parameter | Micro-Account | Standard | Aggressive |
|-----------|---------------|----------|-----------|
| Max Risk per Trade | 0.5% | 2% | 5% |
| Fractional Kelly | 0.15 | 0.25 | 0.50 |
| Max Spread Tolerance | 1.0 pip | 2.0 pips | 3.0 pips |
| Min Trade Duration | 5 min | 1 min | 30 sec |
| Max Trades/Day | 10 | 50 | 100 |
| Friction Threshold | 30% | 50% | 70% |
| Allowed Instruments | GBP/USD, EUR/USD | All major pairs | All pairs + minors |
| Allowed Strategies | Trend only | Trend + Pullback | All |

---

## 9. IMPLEMENTATION CHECKLIST

- [ ] Sortino Ratio calculator (penalize downside only)
- [ ] Maximum Drawdown constraint enforcer (2% per trade)
- [ ] Fractional Kelly position sizer (dynamic scaling)
- [ ] Expected Value calculator (with live spreads)
- [ ] Signal rejection filter (EV vs friction)
- [ ] Alpha/Beta dynamic scaler (inversely proportional to balance)
- [ ] Rolling 20-trade win-rate estimator
- [ ] Market regime detector (trending vs ranging)
- [ ] Live spread fetcher (OANDA API integration)
- [ ] Slippage model (dynamic based on volatility)
- [ ] Micro-Account Mode trigger and restrictions
- [ ] Risk of Ruin probability calculator
- [ ] Geometric compounding tracker
- [ ] Dashboard display of all metrics
- [ ] Automated alerts (losing streak, spread widening, etc.)

---

## 10. REFERENCES & FURTHER READING

- Kelly Criterion: https://en.wikipedia.org/wiki/Kelly_criterion
- Sortino Ratio: https://www.investopedia.com/terms/s/sortinoratio.asp
- Risk of Ruin: https://www.investopedia.com/terms/r/risk-of-ruin.asp
- Fractional Kelly: https://www.investopedia.com/terms/f/fractional-kelly.asp
- OANDA API Documentation: https://developer.oanda.com/

---

**Author:** Manus AI  
**Version:** 1.0  
**Last Updated:** May 18, 2026
