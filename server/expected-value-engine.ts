export interface EVInput {
  confidence: number;
  expectedWinRate: number;
  averageWinR: number;
  averageLossR: number;
}

export interface EVResult {
  expectedValue: number;
  approved: boolean;
  reason: string;
}

export function evaluateExpectedValue(
  input: EVInput
): EVResult {

  const winRate =
    (input.expectedWinRate + input.confidence) / 2;

  const lossRate = 1 - winRate;

  const ev =
    (winRate * input.averageWinR) -
    (lossRate * input.averageLossR);

  return {

    expectedValue: ev,

    approved: ev > 0.20,

    reason:
      `EV ${ev.toFixed(2)}R | WR ${(winRate*100).toFixed(1)}%`
  };
}