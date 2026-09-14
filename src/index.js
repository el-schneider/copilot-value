import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

export const sources = {
  pricing: 'https://models.dev/api.json',
  benchmarks: 'https://artificialanalysis.ai/api/v2/data/llms/models',
  authoritativePricing: 'https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing',
};
export const ttl = 6 * 60 * 60 * 1000;
export const defaultCache = () => process.env.COPILOT_VALUE_CACHE ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'copilot-value', 'snapshot.json');
const normalize = (id) => id.toLowerCase().replace(/[._]/g, '-');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const aliases = {
  'claude-sonnet-4.6': 'claude-sonnet-4-6-adaptive',
  'claude-sonnet-4': 'claude-4-sonnet-thinking',
  'claude-opus-4.6': 'claude-opus-4-6-adaptive',
  'claude-haiku-4.5': 'claude-4-5-haiku-reasoning',
};
export const querySchema = {
  type: 'object', additionalProperties: false,
  properties: {
    sort: { type: 'string', enum: ['coding', 'intelligence', 'value', 'price'], default: 'coding' },
    metric: { type: 'string', enum: ['coding', 'intelligence'], default: 'coding' },
    minScore: { type: 'number', minimum: 0 },
    input: { type: 'integer', minimum: 0, description: 'Total input tokens, including cache reads and writes', default: 100000 },
    cachedInput: { type: 'integer', minimum: 0, default: 0 },
    cacheWrite: { type: 'integer', minimum: 0, default: 0 },
    output: { type: 'integer', minimum: 0, default: 10000 },
    top: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
  },
};

function number(value, label, integer = false) {
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) throw Error(`Invalid ${label}: expected non-negative ${integer ? 'integer' : 'number'}`);
  return value;
}
function text(value, label) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value)) throw Error(`Invalid ${label}`);
  return value;
}
export function options(raw = {}) {
  for (const key of Object.keys(raw)) if (!(key in querySchema.properties)) throw Error(`Unknown ranking option: ${key}`);
  const o = { sort: 'coding', metric: 'coding', minScore: 0, input: 100000, cachedInput: 0, cacheWrite: 0, output: 10000, top: 10, ...raw };
  for (const key of ['sort', 'metric']) if (!querySchema.properties[key].enum.includes(o[key])) throw Error(`Invalid ${key}: ${o[key]}`);
  for (const key of ['input', 'cachedInput', 'cacheWrite', 'output', 'top']) number(o[key], key, true);
  number(o.minScore, 'minScore');
  if (!o.top || o.top > 100) throw Error('top must be 1–100');
  if (o.cachedInput + o.cacheWrite > o.input) throw Error('cachedInput + cacheWrite must not exceed total input');
  if (!o.input && !o.output) throw Error('Workload must contain tokens');
  if (o.sort === 'coding' || o.sort === 'intelligence') {
    if (raw.metric !== undefined && raw.metric !== o.sort) throw Error('metric must match score sort; use sort=value or sort=price to choose a metric');
    o.metric = o.sort;
  }
  return o;
}

function validateRates(rates, label) {
  if (!rates || typeof rates !== 'object') throw Error(`Missing pricing: ${label}`);
  number(rates.input, `${label}.input`);
  number(rates.output, `${label}.output`);
  for (const key of ['cache_read', 'cache_write']) if (rates[key] !== undefined) number(rates[key], `${label}.${key}`);
}
export function validateSnapshot(s) {
  if (s?.version !== 1 || !Array.isArray(s.models) || !s.models.length || !Array.isArray(s.benchmarks) || !s.benchmarks.length) throw Error('Invalid snapshot format');
  for (const key of ['pricingAt', 'benchmarksAt']) {
    number(s[key], key);
    if (!s[key] || s[key] > Date.now() + 60000) throw Error(`Invalid ${key}`);
  }
  const ids = new Set();
  for (const m of s.models) {
    text(m.id, 'model id');
    if (ids.has(m.id)) throw Error(`Duplicate model: ${m.id}`);
    ids.add(m.id);
    validateRates(m.cost, m.id);
    if (m.cost.tiers !== undefined && !Array.isArray(m.cost.tiers)) throw Error(`Invalid tiers: ${m.id}`);
    for (const t of m.cost.tiers ?? []) {
      if (t.tier?.type !== 'context') throw Error(`Unsupported pricing tier: ${m.id}`);
      number(t.tier.size, `${m.id}.threshold`, true);
      validateRates(t, m.id);
    }
    if (m.limit?.input !== undefined) number(m.limit.input, `${m.id}.input limit`, true);
    if (m.limit?.context !== undefined) number(m.limit.context, `${m.id}.context`, true);
    if (m.limit?.output !== undefined) number(m.limit.output, `${m.id}.output limit`, true);
  }
  const slugs = new Set();
  for (const b of s.benchmarks) {
    text(b.slug, 'AA slug'); text(b.name, 'AA name');
    if (slugs.has(normalize(b.slug))) throw Error(`Ambiguous AA slug: ${b.slug}`);
    slugs.add(normalize(b.slug));
    if (!b.evaluations || typeof b.evaluations !== 'object') throw Error(`Missing evaluations: ${b.slug}`);
    for (const metric of ['coding', 'intelligence']) {
      const score = b.evaluations[`artificial_analysis_${metric}_index`];
      if (score != null) number(score, `${b.slug}.${metric}`);
    }
  }
  return s;
}

async function readOptional(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}
async function fetchJson(url, headers, signal) {
  const response = await fetch(url, { headers, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`${url}: HTTP ${response.status}`);
  return response.json();
}
export async function loadSnapshot({ cache = defaultCache(), offline = false, refresh = false, aaCache = process.env.AA_MODEL_CACHE, signal } = {}) {
  if (offline && refresh) throw Error('offline and refresh cannot be combined');
  const existing = refresh ? undefined : await readOptional(cache);
  if (existing) {
    validateSnapshot(existing);
    if (offline || (!refresh && Date.now() - Math.min(existing.pricingAt, existing.benchmarksAt) < ttl)) return existing;
  }
  if (offline) throw Error(`No offline snapshot at ${cache}; run copilot-value refresh first`);
  let aa, benchmarksAt;
  if (process.env.ARTIFICIAL_ANALYSIS_API_KEY && !aaCache) {
    aa = await fetchJson(sources.benchmarks, { 'x-api-key': process.env.ARTIFICIAL_ANALYSIS_API_KEY }, signal);
    benchmarksAt = Date.now();
  } else {
    const path = aaCache ?? join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent'), 'aa-models-cache.json');
    aa = await readOptional(path);
    if (!aa) throw Error('Set ARTIFICIAL_ANALYSIS_API_KEY or --aa-cache to an existing pi AA cache');
    benchmarksAt = aa.time;
    if (!Number.isFinite(benchmarksAt) || Date.now() - benchmarksAt >= ttl) throw Error('AA cache is stale; refresh it in pi or set ARTIFICIAL_ANALYSIS_API_KEY');
  }
  const catalog = await fetchJson(sources.pricing, undefined, signal);
  const models = catalog['github-copilot']?.models;
  if (!models || typeof models !== 'object' || Array.isArray(models)) throw Error('models.dev has no GitHub Copilot catalog');
  const snapshot = validateSnapshot({ version: 1, pricingAt: Date.now(), benchmarksAt, models: Object.values(models), benchmarks: aa.data });
  await mkdir(dirname(cache), { recursive: true });
  const temp = `${cache}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(snapshot), { mode: 0o600 });
  await rename(temp, cache);
  return snapshot;
}

export function rank(snapshot, raw = {}, { modelIds, mappings = {} } = {}) {
  validateSnapshot(snapshot);
  const o = options(raw);
  if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) throw Error('Mappings must be an object of Copilot ID to exact AA slug');
  for (const [id, slug] of Object.entries(mappings)) { text(id, 'mapping id'); text(slug, 'mapping slug'); }
  if (modelIds !== undefined && (!Array.isArray(modelIds) || modelIds.some(id => typeof id !== 'string'))) throw Error('modelIds must be an array of IDs');
  const allowed = modelIds && new Set(modelIds.map(id => id.replace(/^github-copilot\//, '')));
  const bySlug = new Map(snapshot.benchmarks.map(b => [normalize(b.slug), b]));
  const skipped = [], models = [];
  for (const m of snapshot.models) {
    if (allowed && !allowed.has(m.id)) continue;
    const reject = reason => skipped.push({ id: m.id, reason });
    const slug = mappings[m.id] ?? aliases[m.id] ?? normalize(m.id);
    const aa = bySlug.get(normalize(slug));
    if (!aa) { reject(`No exact AA match for ${slug}; supply --mapping`); continue; }
    const score = aa.evaluations[`artificial_analysis_${o.metric}_index`];
    if (score == null) { reject(`No ${o.metric} score for ${aa.slug}`); continue; }
    if (score < o.minScore) { reject(`Below minimum ${o.metric} score ${o.minScore}`); continue; }
    if ((m.limit?.input && o.input > m.limit.input) || (m.limit?.context && o.input + o.output > m.limit.context) || (m.limit?.output && o.output > m.limit.output)) { reject('Workload exceeds model token limits'); continue; }
    let rates = m.cost, threshold = null;
    const tiers = [...(m.cost.tiers ?? [])].sort((a, b) => a.tier.size - b.tier.size);
    if (!tiers.length && m.cost.context_over_200k) { reject('Legacy long-context pricing has no exact threshold'); continue; }
    for (const tier of tiers) if (o.input > tier.tier.size) { rates = tier; threshold = tier.tier.size; }
    if (o.cachedInput && rates.cache_read === undefined) { reject('Missing cache-read rate'); continue; }
    if (o.cacheWrite && rates.cache_write === undefined) { reject('Missing cache-write rate'); continue; }
    const costUsd = ((o.input - o.cachedInput - o.cacheWrite) * rates.input + o.cachedInput * (rates.cache_read ?? 0) + o.cacheWrite * (rates.cache_write ?? 0) + o.output * rates.output) / 1e6;
    if (!Number.isFinite(costUsd) || costUsd <= 0) { reject('Non-positive or invalid workload cost; value is undefined'); continue; }
    models.push({ id: m.id, dispatchId: `github-copilot/${m.id}`, benchmark: { slug: aa.slug, name: aa.name }, score, costUsd, aiCredits: costUsd * 100, value: score / costUsd, rates: { input: rates.input, output: rates.output, cacheRead: rates.cache_read ?? null, cacheWrite: rates.cache_write ?? null, threshold }, metric: o.metric });
  }
  if (allowed) for (const id of allowed) if (!snapshot.models.some(m => m.id === id)) skipped.push({ id, reason: 'No Copilot pricing in catalog' });
  const key = m => o.sort === 'price' ? -m.costUsd : o.sort === 'value' ? m.value : m.score;
  models.sort((a, b) => key(b) - key(a) || a.costUsd - b.costUsd || compare(a.id, b.id));
  skipped.sort((a, b) => compare(a.id, b.id));
  return {
    snapshotId: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
    sources, pricingAt: snapshot.pricingAt, benchmarksAt: snapshot.benchmarksAt,
    stale: Date.now() - Math.min(snapshot.pricingAt, snapshot.benchmarksAt) >= ttl,
    options: o, scope: allowed ? 'explicit-model-list' : 'published-copilot-catalog',
    caveats: ['Catalog membership is not account entitlement.', 'Token-billed AI Credits only; not legacy premium-request plans.', 'AA benchmark variants are shown explicitly; scores do not measure pi task success or Copilot speed.', 'Value is benchmark score per estimated workload dollar, not subscription savings.'],
    total: models.length, models: models.slice(0, o.top), skipped,
  };
}

export function format(result) {
  const o = result.options;
  const lines = [
    `Copilot value · ${o.sort} · ${o.metric} score`,
    `Input ${o.input} (cached ${o.cachedInput}, write ${o.cacheWrite}) · output ${o.output}`,
    `Prices ${new Date(result.pricingAt).toISOString()} · AA ${new Date(result.benchmarksAt).toISOString()}${result.stale ? ' · STALE SNAPSHOT' : ''}`,
    '',
  ];
  if (result.eligibility) lines.splice(3, 0, `Subscription: ${result.eligibility.enabledCount} enabled · checked ${new Date(result.eligibility.fetchedAt).toISOString()}${result.eligibility.stale ? ' · STALE ELIGIBILITY' : ''}`);
  else lines.splice(3, 0, 'Scope: published catalog (account eligibility not checked)');
  const rows = [['#', 'MODEL', 'SCORE', 'USD', 'CREDITS', 'SCORE/$'], ...result.models.map((m, i) => [String(i + 1), m.id, m.score.toFixed(1), m.costUsd.toFixed(4), m.aiCredits.toFixed(2), m.value.toFixed(1)])];
  const widths = rows[0].map((_, col) => Math.max(...rows.map(row => row[col].length)));
  lines.push(...rows.map(row => row.map((cell, col) => col < 2 ? cell.padEnd(widths[col]) : cell.padStart(widths[col])).join('  ').trimEnd()));
  if (!result.models.length) lines.push('No rankable models.');
  lines.push('', 'Benchmark variants:', ...result.models.map(m => `  ${m.id}: ${m.benchmark.name}`));
  if (result.skipped.length) lines.push('', `Excluded (${result.skipped.length}):`, ...result.skipped.map(m => `  ${m.id}: ${m.reason}`));
  lines.push('', ...result.caveats, 'Benchmarks: https://artificialanalysis.ai · Prices: https://models.dev');
  return lines.join('\n');
}
