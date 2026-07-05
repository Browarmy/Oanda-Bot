// server/memory/memoryQualityScorer.ts

export type MemoryQualityInput = {
  dataIntegrityScore: number;
  marketState: unknown;
  dnaVector: unknown;
  observedAt?: unknown;
};

export type MemoryQualitySignal = {
  name: string;
  score: number;
  weight: number;
};

export type MemoryQualityScoreResult = {
  score: number;
  usableForSimilarity: boolean;
  minimumSimilarityScore: number;
  signals: MemoryQualitySignal[];
};

const MINIMUM_SIMILARITY_QUALITY_SCORE = 0.7;
const DNA_VECTOR_DIMENSIONS = 10;

const MARKET_RICHNESS_FIELDS = [
  "trendDirection",
  "trendStrength",
  "volatilityState",
  "volumeProfilePosition",
  "session",
  "regime",
  "liquidityScore",
  "momentumDirection",
  "macroFlag",
  "confidenceScore",
];

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.0;
  return Math.max(0.0, Math.min(1.0, value));
}

function roundScore(value: number): number {
  return Number(clamp01(value).toFixed(6));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasUsefulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return false;
}

function scoreMarketStateRichness(marketState: unknown): number {
  if (!isPlainObject(marketState)) return 0.0;

  const presentFields = MARKET_RICHNESS_FIELDS.filter((field) =>
    hasUsefulValue(marketState[field])
  ).length;

  return roundScore(presentFields / MARKET_RICHNESS_FIELDS.length);
}

function scoreDnaCompleteness(dnaVector: unknown): number {
  if (!Array.isArray(dnaVector)) return 0.0;
  if (dnaVector.length !== DNA_VECTOR_DIMENSIONS) return 0.0;

  const validDimensions = dnaVector.filter(
    (dimension) =>
      typeof dimension === "number" &&
      Number.isFinite(dimension) &&
      dimension >= 0.0 &&
      dimension <= 1.0
  ).length;

  return roundScore(validDimensions / DNA_VECTOR_DIMENSIONS);
}

function scoreObservationFreshness(observedAt: unknown): number {
  if (!observedAt) return 0.5;

  const observedTime =
    observedAt instanceof Date ? observedAt.getTime() : Date.parse(String(observedAt));

  if (!Number.isFinite(observedTime)) return 0.5;

  const ageMs = Math.max(0, Date.now() - observedTime);
  const ageDays = ageMs / 86_400_000;

  if (ageDays <= 7) return 1.0;
  if (ageDays <= 30) return 0.9;
  if (ageDays <= 90) return 0.8;
  if (ageDays <= 180) return 0.7;
  if (ageDays <= 365) return 0.6;

  return 0.5;
}

export function scoreMemoryQuality(input: MemoryQualityInput): MemoryQualityScoreResult {
  const signals: MemoryQualitySignal[] = [
    {
      name: "data_integrity",
      score: roundScore(input.dataIntegrityScore),
      weight: 0.45,
    },
    {
      name: "market_state_richness",
      score: scoreMarketStateRichness(input.marketState),
      weight: 0.35,
    },
    {
      name: "dna_completeness",
      score: scoreDnaCompleteness(input.dnaVector),
      weight: 0.15,
    },
    {
      name: "observation_freshness",
      score: scoreObservationFreshness(input.observedAt),
      weight: 0.05,
    },
  ];

  const weightedScore = signals.reduce(
    (total, signal) => total + signal.score * signal.weight,
    0.0
  );

  const score = roundScore(weightedScore);

  return {
    score,
    usableForSimilarity: score >= MINIMUM_SIMILARITY_QUALITY_SCORE,
    minimumSimilarityScore: MINIMUM_SIMILARITY_QUALITY_SCORE,
    signals,
  };
}