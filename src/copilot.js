import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { defaultCache } from './index.js';

export const eligibilityTtl = 15 * 60 * 1000;
const headers = {
  Accept: 'application/json',
  'User-Agent': 'GitHubCopilotChat/0.35.0',
  'Editor-Version': 'vscode/1.107.0',
  'Editor-Plugin-Version': 'copilot-chat/0.35.0',
  'Copilot-Integration-Id': 'vscode-chat',
  'X-GitHub-Api-Version': '2026-06-01',
};

// A plain GitHub token (gh auth login) is enough for the /models catalog; no Copilot session-token exchange needed.
export async function resolveToken({ token = process.env.GITHUB_TOKEN, host } = {}) {
  if (token) return token;
  try {
    return (await promisify(execFile)('gh', ['auth', 'token', ...(host ? ['--hostname', host] : [])], { encoding: 'utf8', timeout: 10000 })).stdout.trim();
  } catch (error) {
    throw Error(`No GitHub token: set GITHUB_TOKEN or run gh auth login (${error.code === 'ENOENT' ? 'gh CLI not found' : (error.stderr || error.message).trim()})`);
  }
}
export function endpointFor(host = process.env.GH_HOST) {
  if (!host || host === 'github.com') return 'https://api.githubcopilot.com';
  if (!/^[a-z0-9.-]+\.ghe\.com$/.test(host)) throw Error('Unsupported Copilot enterprise host; expected github.com or *.ghe.com');
  return `https://copilot-api.${host}`;
}

async function jsonFile(path, optional = false) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if (optional && error.code === 'ENOENT') return undefined;
    throw Error(`Cannot read ${path}: ${error instanceof SyntaxError ? 'invalid JSON' : error.code ?? 'read failed'}`);
  }
}
async function get(url, token, signal) {
  const response = await fetch(url, {
    headers: { ...headers, Authorization: `Bearer ${token}` }, redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error(`Copilot ${new URL(url).pathname}: HTTP ${response.status}${[401, 403].includes(response.status) ? '; token rejected or no Copilot access, run gh auth login' : ''}`);
  return response.json();
}

export function parseEligibility(raw) {
  if (!Array.isArray(raw?.data)) throw Error('Invalid Copilot model catalog: expected data array');
  const candidates = raw.data.map(m => {
    if (!m || typeof m.id !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(m.id)) throw Error('Invalid Copilot model ID');
    return m;
  }).filter(m => m.capabilities?.supports?.tool_calls !== false);
  // Individual accounts can have every picker flag false while policies explicitly enable models.
  const policyOnly = !candidates.some(m => m.model_picker_enabled === true && m.policy?.state !== 'disabled');
  const enabled = candidates.filter(m => {
    if (m.policy?.state === 'disabled' || m.policy?.state === 'unconfigured') return false;
    return policyOnly ? m.policy?.state === 'enabled' : m.model_picker_enabled === true && (m.policy?.state === undefined || m.policy?.state === 'enabled');
  });
  return { modelIds: [...new Set(enabled.map(m => m.id))].sort(), selection: policyOnly ? 'enabled-policy' : 'model-picker' };
}

export async function loadEligibility({ token, host, cache = `${defaultCache()}.eligibility.json`, offline = false, refresh = false, signal } = {}) {
  if (offline && refresh) throw Error('offline and refresh cannot be combined');
  const endpoint = endpointFor(host);
  token = await resolveToken({ token, host });
  const accountHash = createHash('sha256').update(`${endpoint}\0${token}`).digest('hex');
  const saved = refresh ? undefined : await jsonFile(cache, true);
  if (saved) {
    if (saved.version !== 1 || !Number.isFinite(saved.fetchedAt) || saved.fetchedAt <= 0 || saved.fetchedAt > Date.now() + 60000 || !Array.isArray(saved.modelIds) || saved.modelIds.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(id))) throw Error(`Invalid eligibility cache ${cache}; run refresh`);
    if (saved.accountHash === accountHash && (offline || Date.now() - saved.fetchedAt < eligibilityTtl)) return { ...saved, stale: Date.now() - saved.fetchedAt >= eligibilityTtl };
  }
  if (offline) throw Error('No matching offline eligibility cache for current GitHub token; run copilot-value refresh');
  const parsed = parseEligibility(await get(`${endpoint}/models`, token, signal));
  const result = { version: 1, accountHash, fetchedAt: Date.now(), endpoint, ...parsed };
  await mkdir(dirname(cache), { recursive: true });
  const temp = `${cache}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(result), { mode: 0o600 });
  await rename(temp, cache);
  return { ...result, stale: false };
}
