import { loadSnapshot, rank, options, defaultCache } from './index.js';
import { loadEligibility } from './copilot.js';

export async function query(raw = {}, { all = false, modelIds, registryModelIds, mappings, ...sourceOptions } = {}) {
  const rankingOptions = options(raw);
  const cache = sourceOptions.cache ?? defaultCache();
  let eligible, allowed = modelIds;
  if (!all) {
    eligible = await loadEligibility({ ...sourceOptions, cache: `${cache}.eligibility.json` });
    allowed = eligible.modelIds.filter(id => (!modelIds || modelIds.some(m => m.replace(/^github-copilot\//, '') === id)) && (!registryModelIds || registryModelIds.includes(id)));
  }
  const snapshot = await loadSnapshot({ ...sourceOptions, cache });
  const result = rank(snapshot, rankingOptions, { modelIds: allowed, mappings });
  if (!all) {
    result.scope = 'copilot-subscription';
    result.eligibility = { fetchedAt: eligible.fetchedAt, stale: eligible.stale, source: `${eligible.endpoint}/models`, selection: eligible.selection, enabledCount: eligible.modelIds.length };
    result.caveats[0] = 'Availability comes from the current GitHub token; cached eligibility can change. No remaining-quota check.';
  }
  return result;
}
