// Validation, token odds and the 758-protocol audit for the token radar (radar-3).
//
// This module is the entry's fitted-and-tested half, and it stands on its own: it
// imports nothing from lib/model.ts, so the model can use it without a cycle. Every
// number below is computed from the snapshot handed in — nothing here is a constant
// tuned to a single protocol, and no protocol, chain or category is named by hand.
//
// Three things live here:
//
//   1. The fitted size curve. Live-token protocols (they already trade, so their
//      market cap is a fact) fit log(market cap) = a + b * log(TVL) by ordinary
//      least squares. That curve is the pricing term: a protocol's fitted base
//      value is exp(a) * TVL^b. It is tested held-out two ways — walk-forward
//      (the oldest half of dated live protocols trains, the newest half is
//      predicted) and leave-one-out (each live protocol predicted from all the
//      others) — and each test reports the median absolute log error as an
//      x-factor: exp(median |log(predicted / actual)|). The same two tests run
//      for a flat overall multiple, so the reader can see what the fit buys.
//      On this snapshot the slope fit beats the flat multiple on both tests,
//      while a per-category intercept does not beat the slope alone, so the
//      category term is dropped from pricing (it survives only as a
//      descriptive stat in the dashboard's model panel).
//
//   2. Token launch odds. One snapshot cannot watch protocols launch over
//      time, but it can read the peers' record as current-status data: every
//      protocol is either already trading by its age or still pre-token at
//      that age. The launch rate by age bucket, smoothed monotone, is the
//      cumulative launch curve F(age); its plateau is the oldest bucket's
//      rate. A pre-token protocol of age a then carries the conditional odds
//      (F(plateau) - F(a)) / (1 - F(a)): the share of protocols that reach
//      its age unlaunched and still launch later. Odds fall with age, as
//      they should — the longer a protocol has run with no token, the less
//      of its launch window is left. A TVL-tier factor (the tier's live
//      rate over the overall rate, clamped) adjusts the odds, since larger
//      protocols launch more often.
//
//   3. The audit. Every protocol in the snapshot is classified exactly once
//      — ranked, live-token set aside, or excluded by one named rule, in
//      the same order lib/model.ts applies its exclusion rules — and the
//      counts must sum to the snapshot's protocol count.

/** The protocol fields this module needs: the same ten the snapshot carries. */
export interface ValidationProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The snapshot fields this module needs. */
export interface ValidationSnapshot {
  as_of: string;
  protocols: ValidationProtocol[];
  watchlist: string[];
}

/** The fitted size curve: log(mcap) = a + b * log(TVL), fit on live comps. */
export interface SizeCurve {
  a: number;
  b: number;
  n: number;
}

/** One held-out test's numbers, as the dashboard prints them. */
export interface HeldOutTest {
  /** Median absolute log error, as an x-factor: exp(median |log(pred/actual)|). */
  x: number;
  /** How many protocols the test predicted. */
  n_test: number;
  /** How many protocols the test trained on (leave-one-out trains on n-1 each time). */
  n_train: number;
}

/** Both held-out tests, for the fitted curve and for a flat multiple. */
export interface SizeCurveValidation {
  walk_forward: HeldOutTest;
  leave_one_out: HeldOutTest;
  flat_walk_forward: HeldOutTest;
  flat_leave_one_out: HeldOutTest;
  /** Live comps the curve was fit on. */
  n_live: number;
  /** Live comps with a listing date, the walk-forward universe. */
  n_dated: number;
  /** The fitted curve on all live comps. */
  curve: SizeCurve;
}

/** One age bucket of the launch-rate curve. */
export interface OddsBucket {
  /** Bucket's lower age bound in days (inclusive). */
  lo_days: number;
  /** Bucket's upper age bound in days (exclusive), or null for the open end. */
  hi_days: number | null;
  /** Protocols in the bucket. */
  n: number;
  /** Share of them already trading (the cumulative launch rate at that age). */
  rate: number;
}

/** The fitted token-odds model, as the dashboard prints it. */
export interface TokenOddsModel {
  buckets: OddsBucket[];
  /** The launch curve's plateau: the oldest bucket's rate. */
  f_infinity: number;
  /** Share of all protocols already trading. */
  overall_rate: number;
  /** TVL-tier adjustment factors, by tier. */
  tiers: { lo_usd: number; hi_usd: number | null; factor: number }[];
}

/** The 758-protocol audit: every protocol classified exactly once. */
export interface Audit {
  total: number;
  ranked: number;
  live: number;
  excluded_total: number;
  excluded: {
    /** Excluded by an excluded category (CEX, bridge, liquid staking, ...). */
    category: number;
    /** Excluded as a versioned pool (a name ending in a release). */
    versioned: number;
    /** Excluded as a wrapped or staked product. */
    wrapped: number;
    /** Excluded as an exchange's own name. */
    exchange: number;
  };
}

const DAY_MS = 86_400_000;

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The geometric mean of positive numbers. */
function geometricMean(values: number[]): number {
  return Math.exp(values.reduce((total, v) => total + Math.log(v), 0) / values.length);
}

/** Whole days from `listedAt` to `asOf`, or null when either date is absent or bad. */
export function validationAgeDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function validationIsPreToken(p: ValidationProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The live-token comps a value model can be fit on: trading, with a TVL and a market cap. */
export function liveComps(snapshot: ValidationSnapshot): ValidationProtocol[] {
  return snapshot.protocols.filter((p) => !validationIsPreToken(p) && p.tvl_usd > 0 && p.mcap_usd !== null && p.mcap_usd > 0);
}

/**
 * The size curve, fit by least squares on log(market cap) against log(TVL)
 * over the live comps. With fewer than ten comps the fit is meaningless, so
 * the curve falls back to a flat multiple of 0.2 (a = log(0.2), b = 1).
 */
export function fitSizeCurve(snapshot: ValidationSnapshot): SizeCurve {
  const comps = liveComps(snapshot);
  if (comps.length < 10) return { a: Math.log(0.2), b: 1, n: comps.length };
  const xs = comps.map((p) => Math.log(p.tvl_usd));
  const ys = comps.map((p) => Math.log(p.mcap_usd as number));
  const meanX = xs.reduce((t, v) => t + v, 0) / xs.length;
  const meanY = ys.reduce((t, v) => t + v, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i]! - meanX) * (ys[i]! - meanY);
    sxx += (xs[i]! - meanX) * (xs[i]! - meanX);
  }
  const b = sxx === 0 ? 1 : sxy / sxx;
  const a = meanY - b * meanX;
  return { a, b, n: comps.length };
}

/** The market cap the size curve predicts for a TVL. */
export function predictMcap(curve: SizeCurve, tvlUsd: number): number {
  if (!Number.isFinite(tvlUsd) || tvlUsd <= 0) return 1;
  return Math.exp(curve.a + curve.b * Math.log(tvlUsd));
}

/** The flat predictor the fitted curve is compared against: the overall geometric-mean multiple. */
function flatMultiple(train: ValidationProtocol[]): number {
  if (train.length === 0) return 0.2;
  return geometricMean(train.map((p) => (p.mcap_usd as number) / p.tvl_usd));
}

/** One held-out test's x-factor from a list of absolute log errors. */
function xFactor(absLogErrors: number[], nTrain: number): HeldOutTest {
  return {
    x: Math.round(Math.exp(median(absLogErrors)) * 100) / 100,
    n_test: absLogErrors.length,
    n_train: nTrain,
  };
}

/**
 * Both held-out tests for the fitted size curve, and the same two tests for
 * a flat overall multiple, so the reader can see what the fit buys.
 * Walk-forward trains on the oldest half of dated live comps and predicts
 * the newest half; leave-one-out predicts each live comp from all the
 * others. A smaller x is a tighter fit: x3 means the typical prediction
 * is within a factor of three of the actual market cap.
 */
export function validateSizeCurve(snapshot: ValidationSnapshot): SizeCurveValidation {
  const comps = liveComps(snapshot);
  const curve = fitSizeCurve(snapshot);
  const dated = comps
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at as string) < (b.listed_at as string) ? -1 : (a.listed_at as string) > (b.listed_at as string) ? 1 : 0);
  const half = Math.floor(dated.length / 2);
  const train = dated.slice(0, half);
  const test = dated.slice(half);
  const trainCurve = fitSizeCurve({ as_of: snapshot.as_of, protocols: train, watchlist: snapshot.watchlist });
  const trainFlat = flatMultiple(train);
  const wfErrors = test.map((p) => Math.abs(Math.log(predictMcap(trainCurve, p.tvl_usd) / (p.mcap_usd as number))));
  const wfFlatErrors = test.map((p) => Math.abs(Math.log(((p.tvl_usd * trainFlat) / (p.mcap_usd as number)))));
  const looErrors: number[] = [];
  const looFlatErrors: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const rest = comps.filter((_, j) => j !== i);
    const c = fitSizeCurve({ as_of: snapshot.as_of, protocols: rest, watchlist: snapshot.watchlist });
    const p = comps[i]!;
    looErrors.push(Math.abs(Math.log(predictMcap(c, p.tvl_usd) / (p.mcap_usd as number))));
    looFlatErrors.push(Math.abs(Math.log(((p.tvl_usd * flatMultiple(rest)) / (p.mcap_usd as number)))));
  }
  return {
    walk_forward: xFactor(wfErrors, train.length),
    leave_one_out: xFactor(looErrors, comps.length - 1),
    flat_walk_forward: xFactor(wfFlatErrors, train.length),
    flat_leave_one_out: xFactor(looFlatErrors, comps.length - 1),
    n_live: comps.length,
    n_dated: dated.length,
    curve,
  };
}

/** The age buckets the launch-rate curve is read in. */
const AGE_BUCKETS: { lo: number; hi: number | null }[] = [
  { lo: 0, hi: 180 },
  { lo: 180, hi: 365 },
  { lo: 365, hi: 730 },
  { lo: 730, hi: 1095 },
  { lo: 1095, hi: null },
];

/** The TVL tiers the odds are adjusted by. */
const TVL_TIERS: { lo: number; hi: number | null }[] = [
  { lo: 0, hi: 100_000_000 },
  { lo: 100_000_000, hi: 1_000_000_000 },
  { lo: 1_000_000_000, hi: null },
];

/**
 * Pool-adjacent-violators: the smallest nondecreasing curve through the
 * bucket rates, weighted by bucket size, so the launch curve never claims
 * a younger bucket launches more often than an older one on noise.
 */
function isotonic(rates: number[], weights: number[]): number[] {
  const levels: { value: number; weight: number; count: number }[] = [];
  for (let i = 0; i < rates.length; i++) {
    levels.push({ value: rates[i]!, weight: weights[i]!, count: 1 });
    while (levels.length > 1) {
      const last = levels[levels.length - 1]!;
      const prev = levels[levels.length - 2]!;
      if (prev.value <= last.value) break;
      const weight = prev.weight + last.weight;
      levels.splice(levels.length - 2, 2, {
        value: (prev.value * prev.weight + last.value * last.weight) / weight,
        weight,
        count: prev.count + last.count,
      });
    }
  }
  const out: number[] = [];
  for (const level of levels) for (let i = 0; i < level.count; i++) out.push(level.value);
  return out;
}

/**
 * The token-odds model, fit from the peers' record: the launch rate in each
 * age bucket (smoothed monotone), the curve's plateau, the overall live
 * rate, and the TVL-tier factors.
 */
export function fitTokenOdds(snapshot: ValidationSnapshot): TokenOddsModel {
  const total = snapshot.protocols.length;
  const liveCount = snapshot.protocols.filter((p) => !validationIsPreToken(p)).length;
  const overallRate = total > 0 ? liveCount / total : 0;
  const raw: OddsBucket[] = AGE_BUCKETS.map(({ lo, hi }) => {
    const inBucket = snapshot.protocols.filter((p) => {
      const age = validationAgeDays(snapshot.as_of, p.listed_at);
      return age !== null && age >= lo && (hi === null || age < hi);
    });
    const live = inBucket.filter((p) => !validationIsPreToken(p)).length;
    return { lo_days: lo, hi_days: hi, n: inBucket.length, rate: inBucket.length > 0 ? live / inBucket.length : overallRate };
  });
  const smoothed = isotonic(
    raw.map((b) => b.rate),
    raw.map((b) => b.n),
  );
  const buckets = raw.map((b, i) => ({ ...b, rate: Math.round(smoothed[i]! * 1e4) / 1e4 }));
  const fInfinity = buckets.length > 0 ? buckets[buckets.length - 1]!.rate : overallRate;
  const tiers = TVL_TIERS.map(({ lo, hi }) => {
    const inTier = snapshot.protocols.filter((p) => p.tvl_usd >= lo && (hi === null || p.tvl_usd < hi));
    const live = inTier.filter((p) => !validationIsPreToken(p)).length;
    const rate = inTier.length > 0 ? live / inTier.length : overallRate;
    const factor = overallRate > 0 ? Math.min(1.4, Math.max(0.7, rate / overallRate)) : 1;
    return { lo_usd: lo, hi_usd: hi, factor: Math.round(factor * 100) / 100 };
  });
  return { buckets, f_infinity: fInfinity, overall_rate: Math.round(overallRate * 1e4) / 1e4, tiers };
}

/** A whole number kept inside `low..high`. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * One pre-token protocol's odds that a token ever lists, from the fitted
 * model: the conditional share of protocols that reach its age unlaunched
 * and still launch later, adjusted by its TVL tier. Young protocols score
 * high (most of their launch window is still ahead) and old ones low; a
 * protocol with no listing date takes the overall rate as its age curve.
 * The result is a probability in 0.02..0.95, rounded to two decimals.
 */
export function tokenOddsFor(p: ValidationProtocol, asOf: string, model: TokenOddsModel): number {
  const age = validationAgeDays(asOf, p.listed_at);
  return tokenOddsForAge(age, p.tvl_usd, model);
}

/** The odds for an age in days (null: unknown) and a TVL, from the fitted model. */
export function tokenOddsForAge(ageDays: number | null, tvlUsd: number, model: TokenOddsModel): number {
  let f: number;
  if (ageDays === null) {
    f = model.overall_rate;
  } else {
    const bucket = model.buckets.find((b) => ageDays >= b.lo_days && (b.hi_days === null || ageDays < b.hi_days));
    f = bucket !== undefined ? bucket.rate : model.f_infinity;
  }
  const conditional = f >= model.f_infinity ? 0 : (model.f_infinity - f) / (1 - f);
  const tier = model.tiers.find((t) => tvlUsd >= t.lo_usd && (t.hi_usd === null || tvlUsd < t.hi_usd));
  const factor = tier !== undefined ? tier.factor : 1;
  return Math.round(clamp(conditional * factor, 0.02, 0.95) * 100) / 100;
}

/** Categories the house's watchlist rule keeps off the board. Kept in step with lib/model.ts. */
const EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. Kept in step with lib/model.ts. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking in a name: a product of a token that already trades. Kept in step with lib/model.ts. */
const WRAPPED = /\b(wrapped|staked|staking)\b/i;

/** Exchange names a protocol may not begin with, per the house's watchlist rule. Kept in step with lib/model.ts. */
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;

/**
 * The audit: every protocol classified exactly once, in the same order
 * lib/model.ts applies its exclusion rules — live first, then rankable,
 * then one named exclusion reason. The counts always sum to the snapshot's
 * protocol count; a caller that finds otherwise has a classification bug.
 */
export function auditSnapshot(snapshot: ValidationSnapshot): Audit {
  const excluded = { category: 0, versioned: 0, wrapped: 0, exchange: 0 };
  let ranked = 0;
  let live = 0;
  for (const p of snapshot.protocols) {
    if (!validationIsPreToken(p)) {
      live++;
      continue;
    }
    if (EXCLUDED_CATEGORIES.has(p.category ?? '')) {
      excluded.category++;
      continue;
    }
    if (VERSIONED.test(p.name)) {
      excluded.versioned++;
      continue;
    }
    if (WRAPPED.test(p.name)) {
      excluded.wrapped++;
      continue;
    }
    if (EXCHANGE_PREFIX.test(p.name)) {
      excluded.exchange++;
      continue;
    }
    ranked++;
  }
  const excludedTotal = excluded.category + excluded.versioned + excluded.wrapped + excluded.exchange;
  return {
    total: snapshot.protocols.length,
    ranked,
    live,
    excluded_total: excludedTotal,
    excluded,
  };
}
