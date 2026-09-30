import { loadSnapshot, rank, options, defaultCache } from './index.js';
import { loadEligibility } from './copilot.js';

export async function query(raw = {}, { all = false, modelIds, registryModelIds, mappings, ...sourceOptions } = {}) {
  const rankingOptions = options(raw);
  const cache = sourceOptions.cache ?? defaultCache(rankingOptions.source);
  let eligible, allowed = modelIds;
  if (!all) {
    eligible = await loadEligibility({ ...sourceOptions, cache: `${cache}.eligibility.json` });
    allowed = eligible.modelIds.filter(id => (!modelIds || modelIds.some(m => m.replace(/^github-copilot\//, '') === id)) && (!registryModelIds || registryModelIds.includes(id)));
  }
  const snapshot = await loadSnapshot({ ...sourceOptions, cache, source: rankingOptions.source });
  // Arena needs no key, so it can always second-guess AA; AA can back up Arena only when a key is set.
  const other = rankingOptions.source === 'aa' ? 'arena' : process.env.ARTIFICIAL_ANALYSIS_API_KEY ? 'aa' : null;
  const secondary = rankingOptions.mode === 'value' && rankingOptions.margin && other
    ? await loadSnapshot({ ...sourceOptions, source: other, cache: sourceOptions.cache ? `${cache}.${other}.json` : defaultCache(other), optional: true })
    : undefined;
  const result = rank(snapshot, rankingOptions, { modelIds: allowed, mappings, secondary });
  if (!all) {
    result.scope = 'copilot-subscription';
    result.eligibility = { fetchedAt: eligible.fetchedAt, stale: eligible.stale, source: `${eligible.endpoint}/models`, selection: eligible.selection, enabledCount: eligible.modelIds.length };
    result.caveats[0] = 'Availability comes from the current GitHub token; cached eligibility can change. No remaining-quota check.';
  }
  return result;
}
