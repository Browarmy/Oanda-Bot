export interface AdaptiveExitInput {
  rMultiple: number;
  riskMood?: string;
  regime?: string;
  confidence?: number;
  metaScore?: number;
}

export interface AdaptiveExitResult {
  moveToBreakevenAtR: number;
  partialTakeProfitAtR: number;
  trailStartAtR: number;
  trailAtrMultiplier: number;
  reason: string;
}

export function evaluateAdaptiveExit(input: AdaptiveExitInput): AdaptiveExitResult {
  let moveToBreakevenAtR = 1.0;
  let partialTakeProfitAtR = 1.5;
  let trailStartAtR = 2.0;
  let trailAtrMultiplier = 1.5;

  const reasons: string[] = [];

  const confidence = input.confidence ?? 0.75;
  const metaScore = input.metaScore ?? 0.5;

  if (input.riskMood === "HOT" || input.riskMood === "DANGEROUS") {
    moveToBreakevenAtR = 0.75;
    partialTakeProfitAtR = 1.25;
    trailStartAtR = 1.5;
    trailAtrMultiplier = 1.0;
    reasons.push("hot regime protection");
  }

  if (confidence < 0.75 || metaScore < 0.55) {
    moveToBreakevenAtR = Math.min(moveToBreakevenAtR, 0.8);
    partialTakeProfitAtR = Math.min(partialTakeProfitAtR, 1.25);
    trailStartAtR = Math.min(trailStartAtR, 1.5);
    reasons.push("lower quality setup");
  }

  if (confidence >= 0.88 && metaScore >= 0.7 && input.riskMood !== "HOT") {
    partialTakeProfitAtR = 1.75;
    trailStartAtR = 2.5;
    trailAtrMultiplier = 1.75;
    reasons.push("high quality hold");
  }

  return {
    moveToBreakevenAtR,
    partialTakeProfitAtR,
    trailStartAtR,
    trailAtrMultiplier,
    reason: reasons.length ? reasons.join(", ") : "standard exit model",
  };
}