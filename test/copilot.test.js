import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadEligibility, parseEligibility, eligibilityTtl } from '../src/copilot.js';
import { query } from '../src/query.js';

const endpoint = 'https://api.githubcopilot.com';
const m = (id, picker, state) => ({ id, model_picker_enabled: picker, policy: { state }, capabilities: { supports: { tool_calls: true } } });
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'cv-auth-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cache = join(dir, 'snapshot.json');
  await writeFile(cache, JSON.stringify({ version: 1, pricingAt: Date.now(), benchmarksAt: Date.now(), models: ['allowed', 'disabled'].map(id => ({ id, cost: { input: 1, output: 2 } })), benchmarks: ['allowed', 'disabled'].map((slug, i) => ({ slug, name: slug, evaluations: { artificial_analysis_coding_index: 50 + i * 30 } })) }));
  return { dir, cache, token: 'fake-github-token' };
}

test('picker/policy parsing excludes disabled, unconfigured and non-tool models', () => {
  const data = [m('allowed', true, 'enabled'), m('disabled', true, 'disabled'), m('unconfigured', true, 'unconfigured'), m('hidden', false, 'enabled'), { ...m('no-tools', true, 'enabled'), capabilities: { supports: { tool_calls: false } } }];
  assert.deepEqual(parseEligibility({ data }).modelIds, ['allowed']);
  assert.deepEqual(parseEligibility({ data: [m('allowed', false, 'enabled'), m('disabled', false, 'disabled')] }).modelIds, ['allowed']);
  assert.throws(() => parseEligibility({}), /Invalid Copilot/);
});

test('default query intersects account eligibility; --all bypasses authentication only explicitly', async t => {
  const { cache, token } = await setup(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls++;
    assert.equal(url, `${endpoint}/models`);
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    assert.equal(init.redirect, 'error');
    return new Response(JSON.stringify({ data: [m('allowed', true, 'enabled'), m('disabled', true, 'disabled')] }));
  });
  const result = await query({}, { token, cache });
  assert.equal(result.scope, 'copilot-subscription');
  assert.deepEqual(result.models.map(m => m.id), ['allowed']);
  assert.equal(calls, 1);
  assert.equal((await query({}, { token, cache, modelIds: ['disabled'] })).total, 0);
  assert.equal((await query({}, { token, cache, offline: true })).models[0].id, 'allowed');
  assert.equal(calls, 1);
  assert(!(await readFile(`${cache}.eligibility.json`, 'utf8')).includes('fake-'));
  const publicRank = await query({}, { token: undefined, cache, all: true, offline: true });
  assert.equal(publicRank.models[0].id, 'disabled');
  const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
  const run = spawnSync(process.execPath, [cli, '--cache', cache, '--offline', '--json'], { encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: token } });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).models[0].id, 'allowed');
  assert.equal(run.stdout.includes('fake-github'), false);
});

test('cache is token-bound and offline is network-free', async t => {
  const { dir, token } = await setup(t);
  const cache = join(dir, 'account.json');
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ data: [m('allowed', true, 'enabled')] })));
  const e = await loadEligibility({ token, cache });
  await writeFile(cache, JSON.stringify({ ...e, fetchedAt: Date.now() - eligibilityTtl - 1000 }));
  assert.equal((await loadEligibility({ token, cache, offline: true })).stale, true);
  await assert.rejects(loadEligibility({ token: 'other-token', cache, offline: true }), /No matching offline eligibility/);
  assert.equal(fetch.mock.callCount(), 1);
});

test('enterprise host routes to copilot-api and rejects other domains', async t => {
  const { cache, token } = await setup(t);
  t.mock.method(globalThis, 'fetch', async url => { assert.equal(url, 'https://copilot-api.corp.ghe.com/models'); return new Response(JSON.stringify({ data: [] })); });
  await loadEligibility({ token, host: 'corp.ghe.com', cache, refresh: true });
  await assert.rejects(loadEligibility({ token, host: 'evil.example', cache, refresh: true }), /Unsupported Copilot enterprise host/);
});

test('authorization failures never fall back to the published catalog', async t => {
  const { cache, token } = await setup(t);
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 403 }));
  await assert.rejects(query({}, { token, cache }), /HTTP 403/);
  await assert.rejects(query({}, { token: 'fake-secret', cache }), error => !error.message.includes('fake-secret'));
});
