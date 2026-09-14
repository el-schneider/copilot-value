import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(join(tmpdir(), 'copilot-value-pi-'));
const extensionPath = resolve(process.argv[2] ?? 'extensions/copilot-value.js');
const probe = join(dir, 'probe.js');
await writeFile(probe, `import install from ${JSON.stringify(pathToFileURL(extensionPath).href)};
export default function(pi) {
  let tool;
  install(new Proxy(pi, { get(target, key) {
    if (key === 'registerTool') return definition => { tool = definition; pi.registerTool(definition); };
    return target[key];
  }}));
  pi.on('before_provider_request', () => { throw Error('Inference forbidden in smoke test'); });
  pi.registerCommand('cv-smoke', { handler: async (_, ctx) => {
    const result = await tool.execute('smoke', {sort:'value',top:3}, undefined, undefined, ctx);
    pi.sendMessage({customType:'cv-smoke',content:JSON.stringify(result.details),display:true});
  }});
}`);
const child = spawn(process.env.PI_BIN ?? 'pi', ['--mode', 'rpc', '--no-session', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files', '-e', probe], {
  cwd: dir, env: { ...process.env, PI_OFFLINE: '1', PI_TELEMETRY: '0' }, stdio: ['pipe', 'pipe', 'pipe'],
});
let buffer = '', stderr = '', seq = 0, choose, fatal;
const pending = new Map();
const send = msg => child.stdin.write(`${JSON.stringify(msg)}\n`);
const fail = error => { fatal = error; for (const p of pending.values()) p.reject(error); pending.clear(); };
child.on('error', fail);
child.stderr.setEncoding('utf8');
child.stderr.on('data', chunk => { stderr += chunk; });
child.on('exit', code => fail(Error(`pi exited ${code}: ${stderr}`)));
child.stdout.setEncoding('utf8');
child.stdout.on('data', chunk => {
  buffer += chunk;
  while (buffer.includes('\n')) {
    const end = buffer.indexOf('\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e.type === 'agent_start') throw Error('Smoke command unexpectedly started inference');
      if (e.type === 'extension_error') throw Error(e.error);
      if (e.type === 'extension_ui_request') {
        if (e.method === 'select') { choose = e.options[0].split(' · ')[0]; send({ type: 'extension_ui_response', id: e.id, value: e.options[0] }); }
        if (e.method === 'confirm') send({ type: 'extension_ui_response', id: e.id, confirmed: consent });
        if (e.method === 'notify' && e.notifyType === 'error') throw Error(e.message);
      }
      if (e.type === 'response' && pending.has(e.id)) {
        const p = pending.get(e.id); pending.delete(e.id);
        if (e.success) p.resolve(e.data); else p.reject(Error(e.error));
      }
    } catch (error) { fail(error); }
  }
});
function request(type, data = {}) {
  if (fatal) return Promise.reject(fatal);
  const id = String(++seq);
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); send({ id, type, ...data }); });
}
let consent = false;
const timeout = setTimeout(() => { fail(Error(`RPC timeout: ${stderr}`)); child.kill('SIGKILL'); }, 45000);
try {
  const commands = await request('get_commands');
  assert(commands.commands.some(c => c.name === 'gh-model'));
  await request('prompt', { message: '/cv-smoke' });
  const messages = await request('get_messages');
  const report = JSON.parse(messages.messages.find(m => m.customType === 'cv-smoke').content);
  assert(report.models.length > 0);
  assert.equal(report.scope, 'copilot-subscription');
  assert(report.eligibility.enabledCount >= report.total);
  assert(report.models.every(m => m.dispatchId.startsWith('github-copilot/')));
  const before = await request('get_state');
  await request('prompt', { message: '/gh-model value' });
  const cancelled = await request('get_state');
  assert.equal(cancelled.model.id, before.model.id);
  consent = true;
  await request('prompt', { message: '/gh-model value' });
  const after = await request('get_state');
  assert.equal(after.model.provider, 'github-copilot');
  assert.equal(after.model.id, choose);
  const stats = await request('get_session_stats');
  assert.equal(stats.tokens.total, 0);
  assert.equal(stats.cost, 0);
  console.log(`pi RPC passed: tool ranked ${report.total} models; cancel preserved session; consent selected ${after.model.id}; zero inference tokens.`);
} finally {
  clearTimeout(timeout); child.kill('SIGTERM');
  await rm(dir, { recursive: true, force: true });
}
