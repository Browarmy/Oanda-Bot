// server/memory/dataIntegrityScorer.ts

export type DataIntegrityInput = {
  instrument: unknown;
  observedAt: unknown;
  marketState: unknown;
  dnaVector: unknown;
};

export type DataIntegrityIssueSeverity = "warning" | "error";

export type DataIntegrityIssue = {
  field: string;
  severity: DataIntegrityIssueSeverity;
  message: string;
};

export type DataIntegrityScoreResult = {
  score: number;
  passed: boolean;
  issues: DataIntegrityIssue[];
};

const DNA_VECTOR_DIMENSIONS = 10;

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

function isValidObservedAt(value: unknown): boolean {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime());
  }

  if (typeof value !== "string") {
    return false;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function validateInstrument(value: unknown): DataIntegrityIssue[] {
  if (typeof value !== "string" || value.trim().length === 0) {
    return [
      {
        field: "instrument",
        severity: "error",
        message: "Instrument must be a non-empty string.",
      },
    ];
  }

  return [];
}

function validateObservedAt(value: unknown): DataIntegrityIssue[] {
  if (!isValidObservedAt(value)) {
    return [
      {
        field: "observedAt",
        severity: "error",
        message: "observedAt must be a valid timestamp value.",
      },
    ];
  }

  return [];
}

function validateMarketState(value: unknown): DataIntegrityIssue[] {
  if (!isPlainObject(value)) {
    return [
      {
        field: "marketState",
        severity: "error",
        message: "marketState must be a structured object from the trading engine.",
      },
    ];
  }

  if (Object.keys(value).length === 0) {
    return [
      {
        field: "marketState",
        severity: "error",
        message: "marketState cannot be empty.",
      },
    ];
  }

  return [];
}

function validateDnaVector(value: unknown): DataIntegrityIssue[] {
  if (!Array.isArray(value)) {
    return [
      {
        field: "dnaVector",
        severity: "error",
        message: "dnaVector must be an array.",
      },
    ];
  }

  const issues: DataIntegrityIssue[] = [];

  if (value.length !== DNA_VECTOR_DIMENSIONS) {
    issues.push({
      field: "dnaVector",
      severity: "error",
      message: `dnaVector must contain exactly ${DNA_VECTOR_DIMENSIONS} dimensions.`,
    });
  }

  const invalidIndex = value.findIndex(
    (dimension) =>
      typeof dimension !== "number" ||
      !Number.isFinite(dimension) ||
      dimension < 0.0 ||
      dimension > 1.0
  );

  if (invalidIndex >= 0) {
    issues.push({
      field: `dnaVector[${invalidIndex}]`,
      severity: "error",
      message: "Each DNA dimension must be a finite number between 0.0 and 1.0.",
    });
  }

  return issues;
}

export function scoreDataIntegrity(input: DataIntegrityInput): DataIntegrityScoreResult {
  const issues: DataIntegrityIssue[] = [
    ...validateInstrument(input.instrument),
    ...validateObservedAt(input.observedAt),
    ...validateMarketState(input.marketState),
    ...validateDnaVector(input.dnaVector),
  ];

  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;

  const score = roundScore(1.0 - errorCount * 0.25 - warningCount * 0.1);

  return {
    score,
    passed: errorCount === 0,
    issues,
  };
}