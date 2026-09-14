import { format, querySchema } from '../src/index.js';
import { query as getRankings } from '../src/query.js';

export default function (pi) {
  async function query(params, ctx, signal) {
    const available = ctx.modelRegistry.getAvailable().filter(m => m.provider === 'github-copilot');
    const { all = false, offline = false, ...ranking } = params;
    if (!all && !available.length) throw Error('No authenticated Copilot models in pi. Use /login first.');
    return getRankings(ranking, { all, offline, signal, registryModelIds: available.map(m => m.id) });
  }

  pi.registerTool({
    name: 'copilot_value', label: 'Copilot Value',
    description: 'Rank subscription-enabled GitHub Copilot models by AA scores or estimated token cost, using pi OAuth login and Copilot /models. Default scope also intersects pi registry. all=true shows published catalog instead. Returns dispatchId; does not switch models, launch workers, or spend inference credits. offline=true permits timestamped stale data. Top 10 by default (max 100).',
    promptSnippet: 'Find a GitHub Copilot model by benchmark score or workload value.',
    promptGuidelines: [
      'Use copilot_value when the user explicitly requests GitHub Copilot model recommendations or workers.',
      'copilot_value returns recommendations, not authorization to spend Copilot credits. Use returned dispatchId only after user approval to use Copilot.',
      'copilot_value value means score per estimated workload dollar; price means cheapest above minScore. Report benchmark variant and token assumptions.',
    ],
    parameters: { ...querySchema, properties: { ...querySchema.properties, all: { type: 'boolean', default: false }, offline: { type: 'boolean', default: false } } },
    async execute(_id, params, signal, _update, ctx) {
      const result = await query(params, ctx, signal);
      return { content: [{ type: 'text', text: format(result) }], details: result };
    },
  });

  pi.registerCommand('gh-model', {
    description: 'Pick a Copilot model for this session: /gh-model [coding|intelligence|value|price]',
    getArgumentCompletions(prefix) {
      return ['coding', 'intelligence', 'value', 'price'].filter(s => s.startsWith(prefix)).map(value => ({ value, label: value }));
    },
    async handler(args, ctx) {
      if (!ctx.hasUI) throw Error('/gh-model requires interactive UI or RPC dialogs');
      await ctx.waitForIdle();
      const result = await query({ sort: args.trim() || 'coding' }, ctx, ctx.signal);
      if (!result.models.length) { ctx.ui.notify(format(result), 'warning'); return; }
      const labels = result.models.map(m => `${m.id} · ${m.score} ${m.metric} · $${m.costUsd.toFixed(4)} · ${m.benchmark.name}`);
      const selected = await ctx.ui.select(`Copilot · ${result.options.sort} · 100k input / 10k output, uncached`, labels);
      if (selected === undefined) return;
      const winner = result.models[labels.indexOf(selected)];
      if (!winner) throw Error('Unknown model selection');
      if (!await ctx.ui.confirm('Use Copilot for this session?', `${winner.dispatchId}\nAA: ${winner.benchmark.name}\nEstimated workload: $${winner.costUsd.toFixed(4)} (${winner.aiCredits.toFixed(2)} AI credits).\nBenchmark effort may differ from session thinking. This changes no startup default.`)) return;
      const model = ctx.modelRegistry.find('github-copilot', winner.id);
      if (!model || !await pi.setModel(model)) throw Error(`Cannot select ${winner.dispatchId}; check Copilot authentication`);
      ctx.ui.notify(`Selected ${winner.dispatchId}. Thinking: ${pi.getThinkingLevel()}. AA variant: ${winner.benchmark.name}`, 'info');
    },
  });
}
