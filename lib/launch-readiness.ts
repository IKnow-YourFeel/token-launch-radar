// Launch readiness: how close a pre-token protocol looks to launching a token.
//
// A second, separate read of the same snapshot the radar-2 model scores. It
// does not touch the ranking, the implied value, or the farm plan. It answers
// a different question: given only what the snapshot records about a protocol -
// how much value it already holds, whether that value is growing, how long it
// has run without a token, how many chains it spans, and how the market values
// its category - how ready does a launch look, and what is driving that read?
//
// Every input comes from the snapshot. Nothing here names a protocol, a chain,
// or a category by hand, and nothing here is tuned to a single row: the same
// five component scores and the same weights score every protocol on the board.
//
// The five components, each scored 0..100 and then weighted: scale (30%)
// is TVL on a log scale; growth (20%) is change_7d clamped to -50..80;
// maturity (25%) is age since first listing on a logarithmic curve, so the
// first year counts for more than the third, with a missing listing date
// scoring neutral; breadth (10%) is chain count on a flattening curve;
// category (15%) is the category multiple the radar-2 model derives from
// live protocols in the same category.
//
// The weighted total is rounded to a whole number 0..100 and banded: ready
// 75..100, warming 55..74, watch 0..54. The launch window is a label, not a
// prediction: it is derived from the band, the age and the growth, and says
// how soon a launch would fit the read. The drivers are the one or two
// components whose weighted score sits furthest from neutral, in either
// direction, so a reader can see at a glance whether a high score is carried
// by scale or by growth, and whether a low score is dragged down by youth or
// by shrinking TVL.

/** What a readiness assessment needs about one protocol, all snapshot-derived. */
export interface ReadinessInput {
  tvl_usd: number;
  change_7d: number | null;
  category: string | null;
  chains: string[];
  age_days: number | null;
  listed_at: string | null;
  category_multiple: number;
}

/** One protocol's launch-readiness assessment. */
export interface LaunchReadiness {
  score: number;
  band: 'watch' | 'warming' | 'ready';
  window: string;
  drivers: string[];
  components: {
    scale: number;
    growth: number;
    maturity: number;
    breadth: number;
    category: number;
  };
}

/** The weights the five components carry; they sum to one. */
export const READINESS_WEIGHTS = {
  scale: 0.3,
  growth: 0.2,
  maturity: 0.25,
  breadth: 0.1,
  category: 0.15,
} as const;

/** The score a band starts at. */
export const READINESS_BANDS = { ready: 75, warming: 55 } as const;

const DAY_MS = 86_400_000;

/** A number kept inside `low..high`. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** A whole number kept inside `low..high`. */
function clampInt(value: number, low: number, high: number): number {
  return Math.round(clamp(value, low, high));
}

/** Whole days from `listedAt` to `asOf`, or null when either date is absent or bad. */
export function readinessAgeDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const listedMs = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(listedMs)) return null;
  return Math.max(0, Math.floor((asOfMs - listedMs) / DAY_MS));
}

/** The age to score: the row's own age when it has one, else the listing date. */
function ageFor(input: ReadinessInput, asOf: string): number | null {
  if (input.age_days !== null && Number.isFinite(input.age_days)) return Math.max(0, input.age_days);
  return readinessAgeDays(asOf, input.listed_at);
}

/**
 * The scale score: TVL on a log scale. $5M scores about 32, $34M (the
 * snapshot median) about 69, $100M about 90, and $1B and up scores 100.
 * A protocol with no positive TVL scores zero.
 */
export function scaleScore(tvlUsd: number): number {
  if (!Number.isFinite(tvlUsd) || tvlUsd <= 0) return 0;
  return clampInt((Math.log10(tvlUsd) - 6) * 45, 0, 100);
}

/**
 * The growth score: the 7-day change, clamped to -50..80, mapped so flat
 * scores 50, a 20% week scores 62, an 80% week scores 98, and a -50% week
 * scores 20. A missing change scores neutral: no data is not a collapse.
 */
export function growthScore(change7d: number | null): number {
  if (change7d === null || !Number.isFinite(change7d)) return 50;
  const growth = clamp(change7d, -50, 80);
  return clampInt(50 + growth * 0.6, 0, 100);
}

/**
 * The maturity score: a logarithmic curve over age, so the first year moves
 * the score far more than the third. 90 days scores about 48, one year
 * about 73, two years about 86, three years about 94. A missing age
 * scores neutral.
 */
export function maturityScore(ageDays: number | null): number {
  if (ageDays === null || !Number.isFinite(ageDays)) return 50;
  const age = Math.max(0, ageDays);
  const curve = Math.log10(1 + age / 30) / Math.log10(1 + 1460 / 30);
  return clampInt(20 + 80 * curve, 0, 100);
}

/**
 * The breadth score: chain count on a flattening curve. One chain scores 35,
 * two score 54, three 62, five 71, eight 77, twelve 82, and the curve tops
 * out near 95. No chain at all scores 20.
 */
export function breadthScore(chains: string[]): number {
  const count = chains.length;
  if (count <= 0) return 20;
  return clampInt(35 + 65 * (1 - 1 / Math.sqrt(count)), 0, 100);
}

/**
 * The category score: the category multiple the radar-2 model derives from
 * live protocols in the category, mapped linearly from 0.12 (scores 25) to
 * 0.35 (scores 95). The overall live median, about 0.205, scores about 51.
 */
export function categoryScore(categoryMultiple: number): number {
  if (!Number.isFinite(categoryMultiple)) return 50;
  return clampInt(25 + ((categoryMultiple - 0.12) / 0.23) * 70, 0, 100);
}

/** The band a total score falls in. */
export function bandForScore(score: number): LaunchReadiness['band'] {
  if (score >= READINESS_BANDS.ready) return 'ready';
  if (score >= READINESS_BANDS.warming) return 'warming';
  return 'watch';
}

/** The launch window label, from the band, the age and the growth: ready and
 * growing fast reads as this quarter, ready and flat as the next two
 * quarters, warming and young as 6-12 months, warming and older as 6-18
 * months, and watch as 12+ months, or no near-term signal when very young
 * or shrinking hard. */
export function windowFor(score: number, ageDays: number | null, change7d: number | null): string {
  const band = bandForScore(score);
  const growth = change7d !== null && Number.isFinite(change7d) ? change7d : 0;
  if (band === 'ready' && growth >= 15) return '0–3 months';
  if (band === 'ready') return '3–6 months';
  if (band === 'warming' && ageDays !== null && ageDays < 365) return '6–12 months';
  if (band === 'warming') return '6–18 months';
  if (ageDays !== null && ageDays < 180) return '12+ months';
  if (growth < -10) return 'no near-term signal';
  return '12+ months';
}

/** A TVL as a short human figure: $4.2M, $861.6M, $1.2B. */
export function formatTvl(tvlUsd: number): string {
  if (!Number.isFinite(tvlUsd) || tvlUsd <= 0) return '$0';
  if (tvlUsd >= 1_000_000_000) return `$${(tvlUsd / 1_000_000_000).toFixed(1)}B`;
  if (tvlUsd >= 1_000_000) return `$${(tvlUsd / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(tvlUsd / 1_000)}K`;
}

/** One component's driver line: its name, its evidence, and its score. */
function driverLine(kind: string, detail: string, score: number): string {
  return `${kind} ${detail} (score ${score})`;
}

/**
 * The one or two drivers: the components whose weighted score sits furthest
 * from neutral (50), in either direction, so a high score's drivers are its
 * strengths and a low score's drivers are its drags. Ties break in the fixed
 * order scale, growth, maturity, breadth, category, so the result is
 * deterministic for identical inputs.
 */
function topDrivers(
  input: ReadinessInput,
  ageDays: number | null,
  components: LaunchReadiness['components'],
): string[] {
  const order = ['scale', 'growth', 'maturity', 'breadth', 'category'] as const;
  const details: Record<(typeof order)[number], string> = {
    scale: `TVL ${formatTvl(input.tvl_usd)}`,
    growth: input.change_7d === null ? '7d change unknown' : `7d change ${input.change_7d >= 0 ? '+' : ''}${input.change_7d.toFixed(1)}%`,
    maturity: ageDays === null ? 'age unknown' : `listed ${ageDays} days ago`,
    breadth: input.chains.length === 1 ? '1 chain' : `${input.chains.length} chains`,
    category: `category ${input.category ?? 'Other'}`,
  };
  const weighted = order.map((kind, index) => ({
    kind,
    index,
    deviation: (components[kind] - 50) * READINESS_WEIGHTS[kind],
  }));
  weighted.sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation) || a.index - b.index);
  return weighted.slice(0, 2).map((w) => driverLine(w.kind, details[w.kind], components[w.kind]));
}

/** One protocol's launch-readiness assessment. Pure function of the input
 * and the snapshot date: the same protocol on the same snapshot always gets
 * the same score, band, window and drivers. */
export function assessLaunchReadiness(input: ReadinessInput, asOf: string): LaunchReadiness {
  const ageDays = ageFor(input, asOf);
  const components: LaunchReadiness['components'] = {
    scale: scaleScore(input.tvl_usd),
    growth: growthScore(input.change_7d),
    maturity: maturityScore(ageDays),
    breadth: breadthScore(input.chains),
    category: categoryScore(input.category_multiple),
  };
  const total =
    components.scale * READINESS_WEIGHTS.scale +
    components.growth * READINESS_WEIGHTS.growth +
    components.maturity * READINESS_WEIGHTS.maturity +
    components.breadth * READINESS_WEIGHTS.breadth +
    components.category * READINESS_WEIGHTS.category;
  const score = clampInt(total, 0, 100);
  return {
    score,
    band: bandForScore(score),
    window: windowFor(score, ageDays, input.change_7d),
    drivers: topDrivers(input, ageDays, components),
    components,
  };
}
