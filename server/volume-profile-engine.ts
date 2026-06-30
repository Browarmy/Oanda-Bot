interface CandleLike {
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface VolumeProfileContext {
  poc: number;
  valueAreaHigh: number;
  valueAreaLow: number;
  nearestHvn: number;
  nearestLvn: number;
  position: "ABOVE_VALUE" | "IN_VALUE" | "BELOW_VALUE";
  score: number;
  summary: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function analyseVolumeProfile(
  candles: CandleLike[],
  currentPrice: number,
  buckets = 24
): VolumeProfileContext {
  if (candles.length < 30) {
    return {
      poc: currentPrice,
      valueAreaHigh: currentPrice,
      valueAreaLow: currentPrice,
      nearestHvn: currentPrice,
      nearestLvn: currentPrice,
      position: "IN_VALUE",
      score: 0.5,
      summary: "Insufficient volume profile data",
    };
  }

  const sample = candles.slice(-80);
  const high = Math.max(...sample.map(c => c.high));
  const low = Math.min(...sample.map(c => c.low));
  const range = high - low || 0.0000001;
  const bucketSize = range / buckets;

  const profile = Array.from({ length: buckets }, (_, i) => ({
    index: i,
    price: low + bucketSize * (i + 0.5),
    volume: 0,
  }));

  for (const candle of sample) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    const index = Math.max(
      0,
      Math.min(buckets - 1, Math.floor((typicalPrice - low) / bucketSize))
    );

    profile[index].volume += candle.volume;
  }

  const sorted = [...profile].sort((a, b) => b.volume - a.volume);
  const pocBucket = sorted[0];

  const totalVolume = profile.reduce((sum, b) => sum + b.volume, 0);
  const targetVolume = totalVolume * 0.7;

  let valueVolume = 0;
  const valueBuckets: typeof profile = [];

  for (const bucket of sorted) {
    if (valueVolume >= targetVolume) break;
    valueBuckets.push(bucket);
    valueVolume += bucket.volume;
  }

  const valueAreaHigh = Math.max(...valueBuckets.map(b => b.price));
  const valueAreaLow = Math.min(...valueBuckets.map(b => b.price));

  const averageVolume = totalVolume / buckets;

  const hvns = profile.filter(b => b.volume >= averageVolume * 1.25);
  const lvns = profile.filter(b => b.volume <= averageVolume * 0.6);

  const nearestHvn =
    hvns.length > 0
      ? hvns.reduce((best, b) =>
          Math.abs(b.price - currentPrice) < Math.abs(best.price - currentPrice)
            ? b
            : best
        ).price
      : pocBucket.price;

  const nearestLvn =
    lvns.length > 0
      ? lvns.reduce((best, b) =>
          Math.abs(b.price - currentPrice) < Math.abs(best.price - currentPrice)
            ? b
            : best
        ).price
      : pocBucket.price;

  const position =
    currentPrice > valueAreaHigh
      ? "ABOVE_VALUE"
      : currentPrice < valueAreaLow
        ? "BELOW_VALUE"
        : "IN_VALUE";

  const distanceToPoc = Math.abs(currentPrice - pocBucket.price) / range;
  const distanceToHvn = Math.abs(currentPrice - nearestHvn) / range;
  const distanceToLvn = Math.abs(currentPrice - nearestLvn) / range;

  let score = 0.5;

  if (position === "IN_VALUE") score += 0.15;
  if (distanceToPoc < 0.12) score += 0.15;
  if (distanceToHvn < 0.10) score += 0.1;
  if (distanceToLvn < 0.06) score -= 0.12;

  score = clamp01(score);

  return {
    poc: pocBucket.price,
    valueAreaHigh,
    valueAreaLow,
    nearestHvn,
    nearestLvn,
    position,
    score,
    summary:
      `VP ${position} | POC ${pocBucket.price.toFixed(5)} | ` +
      `VA ${valueAreaLow.toFixed(5)}-${valueAreaHigh.toFixed(5)} | ` +
      `HVN ${nearestHvn.toFixed(5)} | LVN ${nearestLvn.toFixed(5)}`,
  };
}