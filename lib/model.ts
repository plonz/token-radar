// Lumen Radar's model: one sealed DefiLlama snapshot in, one ranked board of
// pre-token protocols out.
//
// The idea: a protocol that has not issued a token is worth what the market
// already pays for comparable protocols that have. For every category the
// model reads the snapshot's own live-token protocols, takes the median of
// their market-cap-to-TVL ratios, and prices each pre-token protocol's TVL at
// its category's median. Three snapshot-derived adjustments follow:
//
//   momentum   the 7-day TVL change, clamped, moves the price by up to ±60%
//   track      a saturating age curve: a protocol tracked for years with no
//              token has proved it can hold value, a new one has not
//   breadth    each extra chain is distribution a launch can land on
//
// implied = TVL x peer_multiple(category) x momentum x track x breadth
//
// No protocol name is ever special-cased; the same function scores every row.
// Protocols that already record a token are never ranked: they are the peer
// set the multiples come from, and the dashboard shows them apart, at the
// market's own values.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label, stated on the dashboard. */
export const MODEL_VERSION = 'lumen-radar-1';

/** Peer-multiple clamps: a category median outside this band is not believed. */
const MULTIPLE_MIN = 0.05;
const MULTIPLE_MAX = 1.5;
/** A category needs at least this many live peers before its own median is used. */
const PEER_MIN = 3;
/** Momentum: the clamped 7-day change and the weight it carries. */
const GROWTH_FLOOR = -50;
const GROWTH_CAP = 100;
const GROWTH_WEIGHT = 0.6;
/** Track record: floor plus a saturating rise over TRACK_TAU_DAYS. */
const TRACK_FLOOR = 0.55;
const TRACK_RANGE = 0.45;
const TRACK_TAU_DAYS = 540;
const UNKNOWN_AGE_DAYS = 270;
/** Breadth: each chain past the first adds this, up to BREADTH_MAX_EXTRA chains. */
const BREADTH_PER_CHAIN = 0.04;
const BREADTH_MAX_EXTRA = 5;

/** One row of board.json. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_count: number;
    peer_scope: 'category' | 'global';
    momentum_multiplier: number;
    track_multiplier: number;
    breadth_multiplier: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one ranked row, farm plan included. */
export interface RadarRow extends BoardRow {
  watchlist: boolean;
}

/** A live-token protocol: already trading, shown at the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  tvl_multiple: number;
  change_7d: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  global_multiple: number;
  watchlist_size: number;
  board_size: number;
  scanned_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A protocol records no token when all three token fields are null. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * The house watchlist's own exclusions, applied to the early radar: a wrapped,
 * staked or bridged product of a protocol whose token already trades is not a
 * launch candidate, however its record reads — WBTC records no token here and
 * is still not one. Categories that are wrappers by construction, names that
 * carry a whole word wrapped/staked/staking, and names that begin with an
 * exchange's name are all set aside. (The watchlist itself is read as given:
 * every slug on it is ranked, exclusions or not.)
 */
const WRAPPER_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const WRAPPER_WORDS = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Rankable on the early radar: pre-token and not a wrapper, pool or exchange product of a live token. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && WRAPPER_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || WRAPPER_WORDS.test(p.name) || EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/**
 * The peer multiples: for each category, the median market-cap-to-TVL ratio of
 * the snapshot's live-token protocols in it, clamped; categories with too few
 * peers fall back to the global median. Returns the per-category table and the
 * global median.
 */
export function peerMultiples(snapshot: Snapshot): { byCategory: Map<string, { multiple: number; peers: number }>; global: number; globalPeers: number } {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio)) continue;
    all.push(ratio);
    const key = p.category ?? '';
    const list = ratiosByCategory.get(key);
    if (list) list.push(ratio);
    else ratiosByCategory.set(key, [ratio]);
  }
  const global = all.length > 0 ? clamp(median(all), MULTIPLE_MIN, MULTIPLE_MAX) : 0.17;
  const byCategory = new Map<string, { multiple: number; peers: number }>();
  for (const [key, ratios] of ratiosByCategory) {
    byCategory.set(key, {
      multiple: ratios.length >= PEER_MIN ? clamp(median(ratios), MULTIPLE_MIN, MULTIPLE_MAX) : global,
      peers: ratios.length,
    });
  }
  return { byCategory, global, globalPeers: all.length };
}

/** The full scoring of one protocol: its implied value and every factor behind it. */
export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  peers: { byCategory: Map<string, { multiple: number; peers: number }>; global: number; globalPeers: number },
): { implied: number; age: number | null; peerMultiple: number; peerCount: number; peerScope: 'category' | 'global'; momentum: number; track: number; breadth: number } {
  const age = ageDays(asOf, p.listed_at);
  const cat = peers.byCategory.get(p.category ?? '');
  const useCategory = cat !== undefined && cat.peers >= PEER_MIN;
  const peerMultiple = useCategory ? cat.multiple : peers.global;
  const peerCount = useCategory ? cat.peers : peers.globalPeers;
  const peerScope: 'category' | 'global' = useCategory ? 'category' : 'global';
  const growth = clamp(typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0, GROWTH_FLOOR, GROWTH_CAP);
  const momentum = 1 + (growth / 100) * GROWTH_WEIGHT;
  const ageForTrack = age ?? UNKNOWN_AGE_DAYS;
  const track = TRACK_FLOOR + TRACK_RANGE * (1 - Math.exp(-Math.max(0, ageForTrack) / TRACK_TAU_DAYS));
  const breadth = 1 + BREADTH_PER_CHAIN * Math.min(Math.max(p.chains.length - 1, 0), BREADTH_MAX_EXTRA);
  const implied = Math.max(1, Math.round(p.tvl_usd * peerMultiple * momentum * track * breadth));
  return { implied, age, peerMultiple, peerCount, peerScope, momentum, track, breadth };
}

/** The protocols the board ranks: every watchlist slug, plus every rankable pre-token protocol. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const peers = peerMultiples(snapshot);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, peers) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      peer_multiple: round4(s.peerMultiple),
      peer_count: s.peerCount,
      peer_scope: s.peerScope,
      momentum_multiplier: round4(s.momentum),
      track_multiplier: round4(s.track),
      breadth_multiplier: round4(s.breadth),
    },
    farm_steps: farmSteps(p, s.age),
  }));
}

/** Gas for one on-chain action, by the class of the chain it happens on. */
function gasFor(chain: string): { label: string; usd: number } {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return { label: 'Ethereum mainnet gas', usd: 6 };
  if (c === 'solana') return { label: 'Solana fees', usd: 0.05 };
  if (c === 'bitcoin' || c === 'bsc' || c === 'binance') return { label: 'chain fees', usd: 0.6 };
  if (['arbitrum', 'base', 'optimism', 'zksync era', 'linea', 'scroll', 'mantle', 'blast', 'mode', 'polygon', 'avalanche', 'gnosis', 'celo', 'fantom', 'sonic', 'berachain', 'soneium', 'unichain', 'ink', 'world chain', 'taiko', 'starknet'].includes(c)) {
    return { label: 'L2 gas', usd: 0.4 };
  }
  return { label: 'chain gas', usd: 1 };
}

/** The capital one farm position runs, from the protocol's own TVL tier. */
function capitalFor(tvl: number): number {
  if (tvl >= 1_000_000_000) return 500;
  if (tvl >= 250_000_000) return 250;
  if (tvl >= 50_000_000) return 150;
  if (tvl >= 10_000_000) return 100;
  return 50;
}

/** How long a position must season, from the protocol's age: younger protocols season longer. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The core action for a category, in words a farmer can follow. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend')) return `Supply $${capital} in USDC or ETH to ${n}'s main market on ${chain}, then borrow no more than 30% against it so the health factor stays boring`;
  if (c.includes('cdp') || c.includes('collateral')) return `Open a vault on ${n} (${chain}), deposit $${capital} of collateral and mint a small amount of its stablecoin against it`;
  if (c.includes('dex') || c.includes('aggregator')) return `Route $${capital} of swaps through ${n} on ${chain} across the week and add $${Math.round(capital / 2)} to its deepest stable pool`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of margin on ${n} and trade one small hedged position a week, sized so liquidation is not a real possibility`;
  if (c.includes('bridge') || c.includes('canonical')) return `Bridge $${capital} to ${chain} through ${n}, then put the bridged funds to work in one app on the far side instead of bridging straight back`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the native staking asset through ${n} on ${chain} and keep the liquid receipt token in the same wallet`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield')) return `Deposit $${capital} into one curated ${n} vault on ${chain} and leave the shares untouched while they accrue`;
  if (c.includes('rwa')) return `Mint $${capital} of ${n}'s tokenised real-world asset on ${chain} and hold it past the first yield distribution`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset ${n} issues on ${chain} and hold it in the farming wallet`;
  if (c.includes('prediction')) return `Fund the wallet with $${capital} and take one position in ${n}'s most liquid market each week`;
  if (c.includes('insurance')) return `Buy $${capital} of protocol cover from ${n} on ${chain} and keep the policy NFT in the wallet`;
  if (c.includes('launchpad') || c.includes('launchpool')) return `Commit $${capital} to one ${n} launch on ${chain} and complete every participation step it lists`;
  if (c.includes('gaming') || c.includes('nft')) return `Spend up to $${capital} on ${n}'s in-app assets on ${chain} and play or list something every week`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} through its main product flow and keep the position open`;
}

/** The second weekly action for a category: the interaction that makes an address look like a user. */
function secondAction(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Repay and re-borrow a small slice once a week on ${n} so the account shows a living credit history, not one deposit`;
  if (c.includes('dex') || c.includes('aggregator')) return `Make two or three small swaps a week on ${n} at different times of day instead of one large trade`;
  if (c.includes('bridge') || c.includes('canonical')) return `Bridge a small amount back or onward once a week through ${n} so both directions appear in the wallet's history`;
  if (c.includes('staking') || c.includes('restak')) return `Claim and re-stake the rewards on ${n} once a week so the position compounds in the same wallet`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Open and close one small position a week on ${n}; volume with a flat book reads as usage, not gambling`;
  return `Repeat one small deposit or interaction on ${n} every week so the address ages as an active user`;
}

/**
 * A protocol's farm plan: six steps, each with its cost and its time, derived
 * from the protocol's own record (category, first chain, TVL tier, age).
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const gas = gasFor(chain);
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const weeklyGas = Math.max(0.1, Math.round(gas.usd * 2 * 10) / 10);
  const steps = [
    `Set up one fresh wallet for ${p.name} alone, fund it from an exchange withdrawal (not from another farm wallet), and store the seed phrase on paper. Cost: about $${gas.usd} of ${gas.label} for the first transfer in. Time: 10 minutes, once.`,
    `${coreAction(p, capital, chain)}. Cost: $${capital} of capital plus about $${gas.usd} of ${gas.label}. Time: 15 minutes to set up.`,
    `${secondAction(p)}. Cost: about $${weeklyGas} of ${gas.label} a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days and stay active in at least ${Math.max(4, Math.round(hold / 7))} separate weeks, so the address appears in several weekly snapshots, not one. Cost: the $${capital} stays deployed and cannot chase other farms. Time: ${hold} days.`,
    `Every Sunday, open ${p.name}'s own points, rewards or governance page from its official site and screenshot the balance; never follow a claim link from social media. Cost: nothing to check, and never pay a fee to "unlock" a claim. Time: 5 minutes a week.`,
    `When a token or points conversion is announced, claim only from the link on ${p.name}'s official page, then unwind over a few days instead of market-selling the whole position at once. Cost: about $${gas.usd} of ${gas.label} to exit. Time: 20 minutes, once.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

/** The live-token protocols the multiples came from, biggest first, for the dashboard's apart view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1))
    .slice(0, 40)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      tvl_multiple: p.tvl_usd > 0 ? round4(p.mcap_usd! / p.tvl_usd) : 0,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const peers = peerMultiples(snapshot);
  const watch = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    global_multiple: round4(peers.global),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    scanned_size: snapshot.protocols.length,
    rows: board.map((r) => ({ ...r, watchlist: watch.has(r.slug) })),
    live: liveRows(snapshot),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. Mirrors the gate's seven rows that concern the board. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears twice on the board';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's whole dataset as one script: no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
