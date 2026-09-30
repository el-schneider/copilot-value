import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

export const sources = {
  pricing: 'https://models.dev/api.json',
  aa: 'https://artificialanalysis.ai/api/v2/data/llms/models',
  arena: 'https://datasets-server.huggingface.co/rows?dataset=lmarena-ai%2Fleaderboard-dataset&config=webdev&split=latest',
  authoritativePricing: 'https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing',
};
export const benchmarkSources = {
  aa: { name: 'Artificial Analysis Intelligence Index', url: 'https://artificialanalysis.ai', caveat: 'AA scores the exact variant shown; scores do not measure pi task success or Copilot speed.' },
  arena: { name: 'LMArena WebDev Elo', url: 'https://lmarena.ai/leaderboard/webdev', caveat: 'Arena Elo is human preference on web-app tasks (lmarena-ai/leaderboard-dataset, CC BY 4.0). The best-scoring effort variant is used.' },
};
export const ttl = 6 * 60 * 60 * 1000;
export const defaultSource = () => process.env.ARTIFICIAL_ANALYSIS_API_KEY ? 'aa' : 'arena';
export const cacheDir = () => join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'copilot-value');
export const defaultCache = (source = defaultSource()) => process.env.COPILOT_VALUE_CACHE ?? join(cacheDir(), `snapshot-${source}.json`);
const normalize = (id) => id.toLowerCase().replace(/[._]/g, '-');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const aliases = {
  'claude-sonnet-4.6': 'claude-sonnet-4-6-adaptive',
  'claude-sonnet-4': 'claude-4-sonnet-thinking',
  'claude-opus-4.6': 'claude-opus-4-6-adaptive',
  'claude-haiku-4.5': 'claude-4-5-haiku-reasoning',
};
// Arena lists effort/date/harness variants of one model; anything else after the ID (e.g. "-5-max", "-mini") is a different model.
const arenaVariant = /^(-(minimal|low|medium|high|xhigh|max|thinking|\d{8}))*( \([^)]*\))?$/;

export const querySchema = {
  type: 'object', additionalProperties: false,
  properties: {
    mode: { type: 'string', enum: ['value', 'best'], default: 'value', description: 'value: price/score frontier, cheapest first. best: highest score first' },
    source: { type: 'string', enum: ['aa', 'arena'], description: 'Default: aa when ARTIFICIAL_ANALYSIS_API_KEY is set, else arena (no key needed)' },
    minScore: { type: 'number', minimum: 0, description: 'Uses the source scale: AA index ~0-70, Arena Elo ~1300-1850' },
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
  const o = { mode: 'value', source: defaultSource(), minScore: 0, input: 100000, cachedInput: 0, cacheWrite: 0, output: 10000, top: 10, ...raw };
  for (const key of ['mode', 'source']) if (!querySchema.properties[key].enum.includes(o[key])) throw Error(`Invalid ${key}: ${o[key]}`);
  for (const key of ['input', 'cachedInput', 'cacheWrite', 'output', 'top']) number(o[key], key, true);
  number(o.minScore, 'minScore');
  if (!o.top || o.top > 100) throw Error('top must be 1–100');
  if (o.cachedInput + o.cacheWrite > o.input) throw Error('cachedInput + cacheWrite must not exceed total input');
  if (!o.input && !o.output) throw Error('Workload must contain tokens');
  return o;
}

function validateRates(rates, label) {
  if (!rates || typeof rates !== 'object') throw Error(`Missing pricing: ${label}`);
  number(rates.input, `${label}.input`);
  number(rates.output, `${label}.output`);
  for (const key of ['cache_read', 'cache_write']) if (rates[key] !== undefined) number(rates[key], `${label}.${key}`);
}
export function validateSnapshot(s) {
  const b = s?.benchmarks;
  if (s?.version !== 2 || !Array.isArray(s.models) || !s.models.length || !(b?.source in benchmarkSources) || !Array.isArray(b.entries) || !b.entries.length) throw Error('Invalid snapshot format');
  for (const [key, value] of [['pricingAt', s.pricingAt], ['benchmarks.fetchedAt', b.fetchedAt]]) {
    number(value, key);
    if (!value || value > Date.now() + 60000) throw Error(`Invalid ${key}`);
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
  for (const e of b.entries) {
    text(e.slug, `${b.source} slug`); text(e.name, `${b.source} name`);
    if (e.score !== null) number(e.score, `${e.slug}.score`);
    if (b.source === 'aa' && slugs.has(normalize(e.slug))) throw Error(`Ambiguous AA slug: ${e.slug}`);
    slugs.add(normalize(e.slug));
  }
  return s;
}

async function readOptional(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}
async function fetchJson(url, headers, signal) {
  // Authenticated requests must not follow redirects: fetch keeps custom headers like x-api-key across origins.
  const response = await fetch(url, { headers, redirect: headers ? 'error' : 'follow', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`${url}: HTTP ${response.status}`);
  return response.json();
}
async function fetchAA(signal) {
  const aa = await fetchJson(sources.aa, { 'x-api-key': process.env.ARTIFICIAL_ANALYSIS_API_KEY }, signal);
  if (!Array.isArray(aa?.data)) throw Error('Unexpected Artificial Analysis response');
  return aa.data.map(b => ({ slug: b.slug, name: b.name, score: b.evaluations?.artificial_analysis_intelligence_index ?? null }));
}
// /rows is cached by Hugging Face; /filter can take >25 s or return 500, so filter the category here.
async function fetchArena(signal) {
  const page = offset => fetchJson(`${sources.arena}&offset=${offset}&length=100`, undefined, signal).then(p => {
    if (!Array.isArray(p?.rows) || !Number.isSafeInteger(p.num_rows_total)) throw Error('Unexpected LMArena response');
    return p;
  });
  const first = await page(0);
  const rest = await Promise.all(Array.from({ length: Math.ceil(first.num_rows_total / 100) - 1 }, (_, i) => page((i + 1) * 100)));
  return [first, ...rest].flatMap(p => p.rows).map(r => r.row).filter(r => r.category === 'overall')
    .map(r => ({ slug: r.model_name, name: r.model_name, score: r.rating }));
}
export async function loadSnapshot({ source = defaultSource(), cache = defaultCache(source), offline = false, refresh = false, signal } = {}) {
  if (offline && refresh) throw Error('offline and refresh cannot be combined');
  if (!(source in benchmarkSources)) throw Error(`Invalid source: ${source}`);
  let existing = refresh ? undefined : await readOptional(cache);
  if (existing?.version !== 2) existing = undefined;
  else if (validateSnapshot(existing).benchmarks.source !== source) existing = undefined;
  if (existing && (offline || Date.now() - Math.min(existing.pricingAt, existing.benchmarks.fetchedAt) < ttl)) return existing;
  if (offline) throw Error(`No offline ${source} snapshot at ${cache}; run copilot-value refresh first`);
  if (source === 'aa' && !process.env.ARTIFICIAL_ANALYSIS_API_KEY) throw Error('Source aa needs ARTIFICIAL_ANALYSIS_API_KEY (free at https://artificialanalysis.ai/data-api); omit --source to use LMArena without a key');
  const [catalog, entries] = await Promise.all([fetchJson(sources.pricing, undefined, signal), source === 'aa' ? fetchAA(signal) : fetchArena(signal)]);
  const models = catalog['github-copilot']?.models;
  if (!models || typeof models !== 'object' || Array.isArray(models)) throw Error('models.dev has no GitHub Copilot catalog');
  const snapshot = validateSnapshot({ version: 2, pricingAt: Date.now(), models: Object.values(models), benchmarks: { source, fetchedAt: Date.now(), entries } });
  await mkdir(dirname(cache), { recursive: true });
  const temp = `${cache}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(snapshot), { mode: 0o600 });
  await rename(temp, cache);
  return snapshot;
}

function match(entries, source, id, mapped) {
  const target = normalize(mapped ?? (source === 'aa' ? aliases[id] ?? id : id));
  const hits = entries.filter(e => {
    const n = normalize(e.slug);
    return mapped || source === 'aa' ? n === target : n.startsWith(target) && arenaVariant.test(n.slice(target.length));
  });
  return hits.filter(e => e.score !== null).sort((a, b) => b.score - a.score)[0] ?? hits[0];
}

export function rank(snapshot, raw = {}, { modelIds, mappings = {} } = {}) {
  validateSnapshot(snapshot);
  const o = options(raw);
  const { source, entries } = snapshot.benchmarks;
  if (source !== o.source) throw Error(`Snapshot has ${source} scores, not ${o.source}`);
  if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) throw Error('Mappings must be an object of Copilot ID to exact benchmark slug');
  for (const [id, slug] of Object.entries(mappings)) { text(id, 'mapping id'); text(slug, 'mapping slug'); }
  if (modelIds !== undefined && (!Array.isArray(modelIds) || modelIds.some(id => typeof id !== 'string'))) throw Error('modelIds must be an array of IDs');
  const allowed = modelIds && new Set(modelIds.map(id => id.replace(/^github-copilot\//, '')));
  const skipped = [], rows = [];
  for (const m of snapshot.models) {
    if (allowed && !allowed.has(m.id)) continue;
    const reject = reason => skipped.push({ id: m.id, reason });
    const found = match(entries, source, m.id, mappings[m.id]);
    if (!found) { reject(`No ${source} benchmark match${mappings[m.id] ? ` for mapping ${mappings[m.id]}` : '; supply --mapping'}`); continue; }
    const score = found.score;
    if (score === null) { reject(`No ${source} score for ${found.name}`); continue; }
    if (score < o.minScore) { reject(`Below minimum score ${o.minScore}`); continue; }
    if ((m.limit?.input && o.input > m.limit.input) || (m.limit?.context && o.input + o.output > m.limit.context) || (m.limit?.output && o.output > m.limit.output)) { reject('Workload exceeds model token limits'); continue; }
    let rates = m.cost, threshold = null;
    const tiers = [...(m.cost.tiers ?? [])].sort((a, b) => a.tier.size - b.tier.size);
    if (!tiers.length && m.cost.context_over_200k) { reject('Legacy long-context pricing has no exact threshold'); continue; }
    for (const tier of tiers) if (o.input > tier.tier.size) { rates = tier; threshold = tier.tier.size; }
    if (o.cachedInput && rates.cache_read === undefined) { reject('Missing cache-read rate'); continue; }
    if (o.cacheWrite && rates.cache_write === undefined) { reject('Missing cache-write rate'); continue; }
    const costUsd = ((o.input - o.cachedInput - o.cacheWrite) * rates.input + o.cachedInput * (rates.cache_read ?? 0) + o.cacheWrite * (rates.cache_write ?? 0) + o.output * rates.output) / 1e6;
    if (!Number.isFinite(costUsd) || costUsd <= 0) { reject('Non-positive or invalid workload cost'); continue; }
    rows.push({ id: m.id, dispatchId: `github-copilot/${m.id}`, benchmark: { slug: found.slug, name: found.name }, score, costUsd, aiCredits: costUsd * 100, rates: { input: rates.input, output: rates.output, cacheRead: rates.cache_read ?? null, cacheWrite: rates.cache_write ?? null, threshold } });
  }
  if (allowed) for (const id of allowed) if (!snapshot.models.some(m => m.id === id)) skipped.push({ id, reason: 'No Copilot pricing in catalog' });
  let models = rows;
  if (o.mode === 'best') rows.sort((a, b) => b.score - a.score || a.costUsd - b.costUsd || compare(a.id, b.id));
  else {
    rows.sort((a, b) => a.costUsd - b.costUsd || b.score - a.score || compare(a.id, b.id));
    models = [];
    for (const m of rows) if (m.score > (models.at(-1)?.score ?? -Infinity)) models.push(m);
  }
  skipped.sort((a, b) => compare(a.id, b.id));
  return {
    snapshotId: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
    sources, source: { id: source, ...benchmarkSources[source] },
    pricingAt: snapshot.pricingAt, benchmarksAt: snapshot.benchmarks.fetchedAt,
    stale: Date.now() - Math.min(snapshot.pricingAt, snapshot.benchmarks.fetchedAt) >= ttl,
    options: o, scope: allowed ? 'explicit-model-list' : 'published-copilot-catalog',
    caveats: [
      'Catalog membership is not account entitlement.',
      'Token-billed AI Credits only; not legacy premium-request plans.',
      benchmarkSources[source].caveat,
      ...(o.mode === 'value' ? ['Value lists the price/score frontier: each row costs more and scores higher than the previous one; every omitted model is beaten on both.'] : []),
    ],
    total: models.length, models: models.slice(0, o.top), skipped,
    dominated: rows.length - models.length,
  };
}

function formatVerbose(result) {
  const o = result.options;
  const lines = [
    `Copilot ${o.mode === 'value' ? 'value frontier (cheapest first)' : 'best models'} · ${result.source.name}`,
    `Input ${o.input} (cached ${o.cachedInput}, write ${o.cacheWrite}) · output ${o.output}`,
    `Prices ${new Date(result.pricingAt).toISOString()} · Scores ${new Date(result.benchmarksAt).toISOString()}${result.stale ? ' · STALE SNAPSHOT' : ''}`,
    result.eligibility
      ? `Subscription: ${result.eligibility.enabledCount} enabled · checked ${new Date(result.eligibility.fetchedAt).toISOString()}${result.eligibility.stale ? ' · STALE ELIGIBILITY' : ''}`
      : 'Scope: published catalog (account eligibility not checked)',
    '',
  ];
  const rows = [['#', 'MODEL', 'SCORE', 'USD', 'CREDITS'], ...result.models.map((m, i) => [String(i + 1), m.id, m.score.toFixed(1), m.costUsd.toFixed(4), m.aiCredits.toFixed(2)])];
  const widths = rows[0].map((_, col) => Math.max(...rows.map(row => row[col].length)));
  lines.push(...rows.map(row => row.map((cell, col) => col < 2 ? cell.padEnd(widths[col]) : cell.padStart(widths[col])).join('  ').trimEnd()));
  if (!result.models.length) lines.push('No rankable models.');
  lines.push('', 'Benchmark variants:', ...result.models.map(m => `  ${m.id}: ${m.benchmark.name}`));
  if (result.skipped.length) lines.push('', `Excluded (${result.skipped.length}):`, ...result.skipped.map(m => `  ${m.id}: ${m.reason}`));
  lines.push('', ...result.caveats, `Scores: ${result.source.url} · Prices: https://models.dev`);
  return lines.join('\n');
}

const k = n => `${n / 1000}k`;
// style defaults to plain text so tool/JSON consumers never get ANSI codes; the CLI passes util.styleText.
export function format(result, { verbose = false, style = (_, text) => text } = {}) {
  if (verbose) return formatVerbose(result);
  const o = result.options;
  const scope = result.eligibility ? `${result.eligibility.enabledCount} models on your plan` : 'published catalog';
  const lines = [`${style('bold', o.mode === 'value' ? 'Best value' : 'Best models')} ${style('dim', `· ${scope} · ${result.source.name}`)}`];
  if (o.mode === 'value') lines.push(style('dim', 'Each row scores higher and costs more than the one above; every unlisted model is beaten on both.'));
  if (result.stale || result.eligibility?.stale) lines.push(style('yellow', 'STALE cached data; run copilot-value refresh'));
  const rows = [['#', 'MODEL', 'SCORE', 'COST'], ...result.models.map((m, i) => [String(i + 1), m.id, m.score.toFixed(result.source.id === 'aa' ? 1 : 0), `$${m.costUsd.toFixed(3)}`])];
  const widths = rows[0].map((_, col) => Math.max(...rows.map(row => row[col].length)));
  const table = rows.map(row => row.map((cell, col) => col < 2 ? cell.padEnd(widths[col]) : cell.padStart(widths[col])));
  lines.push('', style('dim', table[0].join('  ').trimEnd()), ...table.slice(1).map(([rank, ...rest]) => `${style('dim', rank)}  ${rest.join('  ')}`.trimEnd()));
  if (!result.models.length) lines.push('No rankable models.');
  const cache = [o.cachedInput && `${k(o.cachedInput)} cached`, o.cacheWrite && `${k(o.cacheWrite)} cache write`].filter(Boolean).join(', ');
  const footer = [`Cost per task: ${k(o.input)} input${cache ? ` (${cache})` : ''}, ${k(o.output)} output.`];
  if (result.dominated) footer.push(`${result.dominated} more models omitted: each is beaten on price and score by a listed model (copilot-value best lists all).`);
  const unranked = result.skipped.filter(m => !m.reason.startsWith('Below minimum')).map(m => m.id);
  if (unranked.length) footer.push(`Not ranked: ${unranked.join(', ')} (--verbose for reasons).`);
  footer.push(`Scores: ${result.source.url} · Prices: https://models.dev`);
  lines.push('', ...footer.map(line => style('dim', line)));
  return lines.join('\n');
}
