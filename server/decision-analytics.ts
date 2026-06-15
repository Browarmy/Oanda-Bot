import type { DecisionJournalEntry } from "./decision-journal";

export function analyseDecisions(entries: DecisionJournalEntry[]) {
  const total = entries.length;

  const byAction: Record<string, number> = {};
  const byLayer: Record<string, number> = {};
  const byStrategy: Record<string, number> = {};
  const byRegime: Record<string, number> = {};
  const blockedByLayer: Record<string, number> = {};
  const riskReducedByLayer: Record<string, number> = {};

  let avgConfidence = 0;
  let avgMetaScore = 0;
  let confidenceCount = 0;
  let metaScoreCount = 0;

  for (const entry of entries) {
    byAction[entry.action] = (byAction[entry.action] ?? 0) + 1;
    byLayer[entry.layer] = (byLayer[entry.layer] ?? 0) + 1;

    if (entry.strategy) {
      byStrategy[entry.strategy] = (byStrategy[entry.strategy] ?? 0) + 1;
    }

    if (entry.regime) {
      byRegime[entry.regime] = (byRegime[entry.regime] ?? 0) + 1;
    }

    if (entry.action === "BLOCKED") {
      blockedByLayer[entry.layer] = (blockedByLayer[entry.layer] ?? 0) + 1;
    }

    if (entry.action === "RISK_REDUCED") {
      riskReducedByLayer[entry.layer] = (riskReducedByLayer[entry.layer] ?? 0) + 1;
    }

    if (typeof entry.confidence === "number") {
      avgConfidence += entry.confidence;
      confidenceCount++;
    }

    if (typeof entry.metaScore === "number") {
      avgMetaScore += entry.metaScore;
      metaScoreCount++;
    }
  }

  const approved = byAction.APPROVED ?? 0;
  const blocked = byAction.BLOCKED ?? 0;
  const riskReduced = byAction.RISK_REDUCED ?? 0;

  const mostCommonBlockLayer =
    Object.entries(blockedByLayer).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "NONE";

  const mostCommonStrategy =
    Object.entries(byStrategy).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "UNKNOWN";

  const mostCommonRegime =
    Object.entries(byRegime).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "UNKNOWN";

  return {
    total,
    approved,
    blocked,
    riskReduced,

    approvalRate: total > 0 ? approved / total : 0,
    blockRate: total > 0 ? blocked / total : 0,
    riskReductionRate: total > 0 ? riskReduced / total : 0,

    avgConfidence: confidenceCount > 0 ? avgConfidence / confidenceCount : 0,
    avgMetaScore: metaScoreCount > 0 ? avgMetaScore / metaScoreCount : 0,

    byAction,
    byLayer,
    byStrategy,
    byRegime,
    blockedByLayer,
    riskReducedByLayer,

    mostCommonBlockLayer,
    mostCommonStrategy,
    mostCommonRegime,
  };
}