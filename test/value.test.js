import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rank, loadSnapshot, sources, ttl } from '../src/index.js';
import extension from '../extensions/copilot-value.js';

const now = Date.now();
const benchmark = (slug, score, name = slug) => ({ slug, name, evaluations: { artificial_analysis_coding_index: score, artificial_analysis_intelligence_index: 20 } });
const model = (id, cost = { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 }) => ({ id, cost, limit: { context: 1000000, output: 100000 } });
const fixture = () => ({ version: 1, pricingAt: now, benchmarksAt: now, models: [model('alpha'), model('beta', { input: 1, output: 2 })], benchmarks: [benchmark('alpha', 80), benchmark('beta', 40)] });

async function temp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'copilot-value-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('ranking uses workload dollars, keeps stable ties, and filters minimum quality', () => {
  const s = fixture();
  assert.equal(rank(s).models[0].id, 'alpha');
  assert.equal(rank(s, { sort: 'value' }).models[0].id, 'beta');
  assert.equal(rank(s, { sort: 'price', minScore: 60 }).models[0].id, 'alpha');
  const a = rank(s, { input: 100000, cachedInput: 70000, cacheWrite: 10000, output: 10000 }).models[0];
  assert.equal(a.costUsd, 0.179);
  assert.equal(a.aiCredits, 17.9);
  s.models.push(model('aardvark'));
  s.benchmarks.push(benchmark('aardvark', 80));
  assert.equal(rank(s).models[0].id, 'aardvark');
  assert.deepEqual(rank(s).models, rank({ ...s, models: [...s.models].reverse() }).models);
});

test('context tiers use total input and strict threshold, not the legacy 200k alias', () => {
  const s = fixture();
  s.models[0].cost.tiers = [{ tier: { type: 'context', size: 272000 }, input: 4, output: 15, cache_read: 0.4, cache_write: 5 }];
  assert.equal(rank(s, { input: 272000 }).models[0].rates.threshold, null);
  const row = rank(s, { input: 272001, cachedInput: 270000 }).models[0];
  assert.equal(row.rates.threshold, 272000);
  assert.equal(row.costUsd, (2001 * 4 + 270000 * 0.4 + 10000 * 15) / 1e6);
  assert.equal(rank(s, { input: 999999 }).total, 0);
  s.models[0].limit.input = 168000;
  const capped = rank(s, { input: 190000 });
  assert.equal(capped.models.some(m => m.id === 'alpha'), false);
  assert.match(capped.skipped.find(m => m.id === 'alpha').reason, /token limits/);
});

test('matching never borrows a prefix score and exposes deliberate reasoning aliases', () => {
  const s = fixture();
  s.models = [model('alpha-mini'), model('claude-sonnet-4.6')];
  s.benchmarks.push(benchmark('claude-sonnet-4-6-adaptive', 70, 'Sonnet (Max Effort)'));
  const result = rank(s);
  assert.equal(result.total, 1);
  assert.equal(result.models[0].benchmark.name, 'Sonnet (Max Effort)');
  assert.match(result.skipped[0].reason, /No exact AA match/);
  assert.equal(rank(s, {}, { mappings: { 'alpha-mini': 'beta' } }).total, 2);
  assert.equal(rank(s, {}, { modelIds: [] }).total, 0);
  assert.match(rank(s, {}, { modelIds: ['missing'] }).skipped[0].reason, /No Copilot pricing/);
});

test('bad inputs fail loudly; absent scores/rates are excluded, never invented', () => {
  const s = fixture();
  for (const raw of [{ input: -1 }, { input: NaN }, { top: 0 }, { top: 1.5 }, { sort: 'oops' }, { cachedInput: 100001 }, { output: Infinity }, { input: 0, output: 0 }, { minScore: null }]) assert.throws(() => rank(s, raw));
  assert.equal(rank(s, { cachedInput: 10 }).skipped[0].id, 'beta');
  s.benchmarks[0].evaluations.artificial_analysis_coding_index = null;
  assert.equal(rank(s).models[0].id, 'beta');
  s.models[0].cost.input = '2';
  assert.throws(() => rank(s), /Invalid alpha.input/);
});

test('refresh -> disk -> offline preserves provenance and never calls network offline', async t => {
  const dir = await temp(t), cache = join(dir, 'cache.json'), aaCache = join(dir, 'aa.json');
  const s = fixture();
  await writeFile(aaCache, JSON.stringify({ time: now, data: s.benchmarks }));
  const fetches = [];
  t.mock.method(globalThis, 'fetch', async url => {
    fetches.push(url);
    return new Response(JSON.stringify({ 'github-copilot': { models: Object.fromEntries(s.models.map(m => [m.id, m])) } }));
  });
  await writeFile(cache, '{broken');
  const fresh = await loadSnapshot({ cache, aaCache, refresh: true });
  assert.deepEqual(fetches, [sources.pricing]);
  assert.equal(fresh.benchmarksAt, now);
  assert.deepEqual(await loadSnapshot({ cache, offline: true }), fresh);
  assert.equal(fetches.length, 1);
  const stale = { ...fresh, pricingAt: now - ttl - 1000 };
  await writeFile(cache, JSON.stringify(stale));
  assert.equal(rank(await loadSnapshot({ cache, offline: true })).stale, true);
  assert.equal(fetches.length, 1);
  await assert.rejects(loadSnapshot({ cache: join(dir, 'missing'), offline: true }), /No offline snapshot/);
  await writeFile(aaCache, JSON.stringify({ time: now - ttl - 1000, data: s.benchmarks }));
  await assert.rejects(loadSnapshot({ cache, aaCache, refresh: true }), /AA cache is stale/);
  assert.deepEqual(JSON.parse(await readFile(cache, 'utf8')), stale);
});

test('CLI pretty, JSON, failure and empty-result exits work as subprocesses', async t => {
  const dir = await temp(t), cache = join(dir, 'snapshot.json');
  await writeFile(cache, JSON.stringify(fixture()));
  const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, '--cache', cache, '--offline', '--all', ...args], { encoding: 'utf8' });
  const pretty = run();
  assert.equal(pretty.status, 0, pretty.stderr);
  assert.match(pretty.stdout, /MODEL\s+SCORE\s+USD/);
  const json = run('--json', '--sort', 'value');
  assert.equal(json.status, 0, json.stderr);
  assert.equal(JSON.parse(json.stdout).models[0].dispatchId, 'github-copilot/beta');
  assert.equal(run('--json', '--models', 'missing').status, 2);
  const invalid = run('--input=-1', '--json');
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, '');
  assert.match(invalid.stderr, /Invalid input/);
});

test('help works without credentials and its ranking examples execute against a snapshot', async t => {
  const dir = await temp(t), cache = join(dir, 'snapshot.json');
  await writeFile(cache, JSON.stringify(fixture()));
  const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
  const help = spawnSync(process.execPath, [cli, '--help', '--cache', join(dir, 'missing-cache.json')], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /"Frontier" has no automatic cutoff/);
  const examples = [...help.stdout.matchAll(/^    copilot-value (.+)$/gm)].map(match => match[1]);
  assert(examples.some(example => example === '--sort intelligence --top 5'));
  assert(examples.some(example => example.includes('--sort price --metric intelligence --min-score')));
  for (const example of examples.filter(example => example !== 'refresh')) {
    const result = spawnSync(process.execPath, [cli, ...example.split(/\s+/), '--cache', cache, '--offline', '--all'], { encoding: 'utf8' });
    assert([0, 2].includes(result.status), `${example}: ${result.stderr}`);
    if (example.includes('--json')) assert(Array.isArray(JSON.parse(result.stdout).models));
  }
});

test('pi tool ranks only authenticated Copilot models; command requires selection and consent', async t => {
  const dir = await temp(t), cache = join(dir, 'snapshot.json');
  await writeFile(cache, JSON.stringify(fixture()));
  const previous = process.env.COPILOT_VALUE_CACHE;
  const previousToken = process.env.GITHUB_TOKEN;
  process.env.COPILOT_VALUE_CACHE = cache;
  process.env.GITHUB_TOKEN = 'test-token';
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ data: [{ id: 'alpha', model_picker_enabled: true, policy: { state: 'enabled' } }] })));
  t.after(() => {
    if (previous === undefined) delete process.env.COPILOT_VALUE_CACHE; else process.env.COPILOT_VALUE_CACHE = previous;
    if (previousToken === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previousToken;
  });
  let tool, command, selectedModel, confirm = false;
  extension({ registerTool: t => { tool = t; }, registerCommand: (_, c) => { command = c; }, setModel: async m => { selectedModel = m; return true; }, getThinkingLevel: () => 'high' });
  const alpha = { provider: 'github-copilot', id: 'alpha' };
  const ctx = { hasUI: true, waitForIdle: async () => {}, modelRegistry: { getAvailable: () => [alpha, { provider: 'other', id: 'beta' }], find: () => alpha }, ui: { select: async (_, rows) => rows[0], confirm: async () => confirm, notify: () => {} } };
  const result = await tool.execute('test', { sort: 'value' }, undefined, undefined, ctx);
  assert.equal(result.details.total, 1);
  assert.equal(result.details.models[0].id, 'alpha');
  assert.equal(selectedModel, undefined);
  await command.handler('coding', ctx);
  assert.equal(selectedModel, undefined);
  confirm = true;
  await command.handler('coding', ctx);
  assert.equal(selectedModel, alpha);
  await assert.rejects(command.handler('coding', { ...ctx, hasUI: false }), /requires interactive/);
});
