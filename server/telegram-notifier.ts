/**
 * Telegram Notifier
 *
 * Sends push notifications to a Telegram chat when:
 * - A trade opens
 * - A trade closes (with P&L)
 * - Daily loss guard triggers
 * - Bot starts/stops
 *
 * Setup: create a bot via @BotFather, get the token, then get your chat ID
 * by messaging the bot and calling https://api.telegram.org/bot<TOKEN>/getUpdates
 */

// ─── Config (stored in DB via settings) ──────────────────────────────────────

let _token: string | null = null;
let _chatId: string | null = null;
let _enabled = false;

export function configureTelegram(token: string, chatId: string) {
  _token = token.trim();
  _chatId = chatId.trim();
  _enabled = !!(token && chatId);
}

export function getTelegramConfig(): { enabled: boolean; hasToken: boolean; hasChatId: boolean } {
  return { enabled: _enabled, hasToken: !!_token, hasChatId: !!_chatId };
}

// ─── Core send ────────────────────────────────────────────────────────────────

export async function sendTelegramMessage(text: string): Promise<boolean> {
  if (!_enabled || !_token || !_chatId) return false;
  try {
    const url = `https://api.telegram.org/bot${_token}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: _chatId,
        text,
        parse_mode: "HTML",
      }),
    });
    const data = await res.json() as { ok: boolean };
    return data.ok === true;
  } catch {
    return false;
  }
}

export async function sendTelegramTestMessage() {
  const sent = await sendTelegramMessage(
"✅ Telegram connected successfully — Nereqo alerts are active."
  );

  if (!sent) {
    throw new Error("Telegram not configured or message failed to send");
  }

  return { success: true };
}

// ─── Notification templates ───────────────────────────────────────────────────

export async function notifyTradeOpen(params: {
  instrument: string;
  direction: "BUY" | "SELL";
  units: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  reason: string;
  regime: string;
}): Promise<void> {
  const { instrument, direction, units, entryPrice, stopLoss, takeProfit, confidence, reason, regime } = params;
  const isJpy = instrument.includes("JPY");
  const dp = isJpy ? 3 : 5;
  const pip = isJpy ? 100 : 10000;
  const slPips = Math.abs(entryPrice - stopLoss) * pip;
  const tpPips = Math.abs(takeProfit - entryPrice) * pip;
  const rr = slPips > 0 ? (tpPips / slPips).toFixed(1) : "?";
  const emoji = direction === "BUY" ? "🟢" : "🔴";
  const msg = [
    `${emoji} <b>TRADE OPENED</b>`,
    ``,
    `<b>${direction}</b> ${instrument.replace("_", "/")}`,
    `📊 Regime: ${regime}`,
    `💰 Units: ${units.toLocaleString()}`,
    ``,
    `Entry:  <code>${entryPrice.toFixed(dp)}</code>`,
    `SL:     <code>${stopLoss.toFixed(dp)}</code>  (${slPips.toFixed(1)}p)`,
    `TP:     <code>${takeProfit.toFixed(dp)}</code>  (${tpPips.toFixed(1)}p)`,
    `RR:     ${rr}:1`,
    ``,
    `🤖 Confidence: ${(confidence * 100).toFixed(0)}%`,
    `📝 ${reason}`,
  ].join("\n");
  await sendTelegramMessage(msg);
}

export async function notifyTradeClose(params: {
  instrument: string;
  direction: "BUY" | "SELL";
  units: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pips: number;
  reason: string;
  currency: string;
}): Promise<void> {
  const { instrument, direction, units, entryPrice, exitPrice, pnl, pips, reason, currency } = params;
  const isJpy = instrument.includes("JPY");
  const dp = isJpy ? 3 : 5;
  const isWin = pnl >= 0;
  const emoji = isWin ? "✅" : "❌";
  const msg = [
    `${emoji} <b>TRADE CLOSED</b>`,
    ``,
    `<b>${direction}</b> ${instrument.replace("_", "/")}`,
    `Units: ${units.toLocaleString()}`,
    ``,
    `Entry: <code>${entryPrice.toFixed(dp)}</code>`,
    `Exit:  <code>${exitPrice.toFixed(dp)}</code>`,
    `Pips:  <code>${pips >= 0 ? "+" : ""}${pips.toFixed(1)}</code>`,
    `P&L:   <b>${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} ${currency}</b>`,
    ``,
    `📝 ${reason}`,
  ].join("\n");
  await sendTelegramMessage(msg);
}

export async function notifyDailyLossGuard(params: {
  dailyLoss: number;
  limit: number;
  currency: string;
}): Promise<void> {
  const { dailyLoss, limit, currency } = params;
  const msg = [
    `🛑 <b>DAILY LOSS GUARD TRIGGERED</b>`,
    ``,
    `Daily loss: <b>${dailyLoss.toFixed(2)} ${currency}</b>`,
    `Limit: ${limit.toFixed(2)} ${currency}`,
    ``,
    `Trading paused for the rest of the day.`,
    `Bot will resume tomorrow automatically.`,
  ].join("\n");
  await sendTelegramMessage(msg);
}

export async function notifyBotStatus(status: "STARTED" | "STOPPED" | "PAUSED" | "RESUMED", details?: string): Promise<void> {
  const emojis = { STARTED: "▶️", STOPPED: "⏹️", PAUSED: "⏸️", RESUMED: "▶️" };
  const msg = [
    `${emojis[status]} <b>BOT ${status}</b>`,
    details ? `\n${details}` : "",
  ].join("\n");
  await sendTelegramMessage(msg);
}

export async function notifyPropFirmAlert(params: {
  type: "DAILY_LOSS" | "TOTAL_DRAWDOWN" | "TARGET_HIT";
  current: number;
  limit: number;
  currency: string;
}): Promise<void> {
  const { type, current, limit, currency } = params;
  const messages = {
    DAILY_LOSS: `⚠️ <b>PROP FIRM: Daily Loss Warning</b>\nCurrent: ${current.toFixed(2)} ${currency}\nLimit: ${limit.toFixed(2)} ${currency}`,
    TOTAL_DRAWDOWN: `🚨 <b>PROP FIRM: Max Drawdown Reached</b>\nDrawdown: ${current.toFixed(2)}%\nLimit: ${limit.toFixed(2)}%\nTrading HALTED.`,
    TARGET_HIT: `🎯 <b>PROP FIRM: Profit Target Reached!</b>\nProfit: +${current.toFixed(2)} ${currency}\nTarget: ${limit.toFixed(2)} ${currency}\nConsider stopping and submitting.`,
  };
  await sendTelegramMessage(messages[type]);
}
