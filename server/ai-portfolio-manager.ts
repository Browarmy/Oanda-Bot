export interface PortfolioCandidate {
  instrument: string;
  direction: "BUY" | "SELL";
  confidence: number;
  metaScore?: number;
  regime?: string;
  strategy?: string;
}

export interface PortfolioManagerResult {
  approved: boolean;
  reason: string;
  adjustedConfidence: number;
  riskMultiplier: number;
}

function currencyTheme(instrument: string, direction: "BUY" | "SELL") {
  const [base, quote] = instrument.split("_");

  if (!base || !quote) return `${instrument}_${direction}`;

  return direction === "BUY"
    ? `${base}_LONG_${quote}_SHORT`
    : `${base}_SHORT_${quote}_LONG`;
}

export function evaluatePortfolioCandidate(
  candidate: PortfolioCandidate,
  openCandidates: PortfolioCandidate[]
): PortfolioManagerResult {
  const candidateTheme = currencyTheme(candidate.instrument, candidate.direction);

  const sameTheme = openCandidates.filter(
    t => currencyTheme(t.instrument, t.direction) === candidateTheme
  );

  const candidateStrength =
    candidate.confidence * 0.55 +
    (candidate.metaScore ?? 0.5) * 0.45;

  const strongerSameTheme = sameTheme.some(t => {
    const strength =
      t.confidence * 0.55 +
      (t.metaScore ?? 0.5) * 0.45;

    return strength > candidateStrength + 0.05;
  });

  if (strongerSameTheme) {
    return {
      approved: false,
      reason: `stronger same-theme position already active: ${candidateTheme}`,
      adjustedConfidence: candidate.confidence,
      riskMultiplier: 0,
    };
  }

  if (sameTheme.length >= 2) {
    return {
      approved: true,
      reason: `crowded same-theme exposure: ${candidateTheme}`,
      adjustedConfidence: Math.max(0, candidate.confidence - 0.04),
      riskMultiplier: 0.7,
    };
  }

  if (sameTheme.length === 1) {
    return {
      approved: true,
      reason: `moderate same-theme exposure: ${candidateTheme}`,
      adjustedConfidence: Math.max(0, candidate.confidence - 0.02),
      riskMultiplier: 0.85,
    };
  }

  return {
    approved: true,
    reason: `portfolio candidate clean: ${candidateTheme}`,
    adjustedConfidence: candidate.confidence,
    riskMultiplier: 1,
  };
}