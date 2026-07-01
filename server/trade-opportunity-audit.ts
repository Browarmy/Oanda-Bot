export type TradeBlockReason =
  | "SIGNAL_WAIT"
  | "SPREAD"
  | "H4_FILTER"
  | "CONFIDENCE"
  | "QUALITY"
  | "EXPECTED_VALUE"
  | "NEURAL"
  | "EXECUTIVE"
  | "LEARNING_PAIR_DISABLED"
  | "LEARNING_HOUR_DISABLED"
  | "PORTFOLIO"
  | "NEWS"
  | "EXECUTION"
  | "SAFETY"
| "FORECAST"
  | "OTHER";

export interface TradeOpportunityAudit {
  cycleStartedAt: number;
  scanned: number;
  signalsFound: number;
  executed: number;
  blocked: Record<TradeBlockReason, number>;
}

export function createTradeOpportunityAudit(): TradeOpportunityAudit {
  return {
    cycleStartedAt: Date.now(),
    scanned: 0,
    signalsFound: 0,
    executed: 0,
    blocked: {
      SIGNAL_WAIT: 0,
      SPREAD: 0,
      H4_FILTER: 0,
      CONFIDENCE: 0,
      QUALITY: 0,
      EXPECTED_VALUE: 0,
      NEURAL: 0,
      EXECUTIVE: 0,
      LEARNING_PAIR_DISABLED: 0,
      LEARNING_HOUR_DISABLED: 0,
      PORTFOLIO: 0,
      NEWS: 0,
      EXECUTION: 0,
      SAFETY: 0,
FORECAST: 0,
      OTHER: 0,
    },
  };
}

export function recordTradeBlock(
  audit: TradeOpportunityAudit,
  reason: TradeBlockReason
) {
  audit.blocked[reason]++;
}

export function summariseTradeOpportunityAudit(
  audit: TradeOpportunityAudit
): string {
  const blockedTotal = Object.values(audit.blocked).reduce((a, b) => a + b, 0);

  return (
    `📋 OPPORTUNITY AUDIT | scanned ${audit.scanned} | ` +
    `signals ${audit.signalsFound} | executed ${audit.executed} | ` +
    `blocked ${blockedTotal} | ` +
    `wait ${audit.blocked.SIGNAL_WAIT} | ` +
    `spread ${audit.blocked.SPREAD} | ` +
    `H4 ${audit.blocked.H4_FILTER} | ` +
    `confidence ${audit.blocked.CONFIDENCE} | ` +
    `quality ${audit.blocked.QUALITY} | ` +
    `EV ${audit.blocked.EXPECTED_VALUE} | ` +
    `neural ${audit.blocked.NEURAL} | ` +
    `executive ${audit.blocked.EXECUTIVE} | ` +
    `learning ${audit.blocked.LEARNING_PAIR_DISABLED + audit.blocked.LEARNING_HOUR_DISABLED} | ` +
    `portfolio ${audit.blocked.PORTFOLIO} | ` +
    `news ${audit.blocked.NEWS} | ` +
    `execution ${audit.blocked.EXECUTION} | ` +
    `safety ${audit.blocked.SAFETY}`
    `forecast ${audit.blocked.FORECAST} | ` +
  ;
}