#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { format, querySchema } from '../src/index.js';
import { query as getRankings } from '../src/query.js';

const names = { minScore: 'min-score', cachedInput: 'cached-input', cacheWrite: 'cache-write' };
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    ...Object.fromEntries(Object.keys(querySchema.properties).map(key => [names[key] ?? key, { type: 'string' }])),
    all: { type: 'boolean' }, host: { type: 'string' },
    json: { type: 'boolean' }, offline: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    cache: { type: 'string' }, 'aa-cache': { type: 'string' }, mapping: { type: 'string' }, models: { type: 'string' },
  } });
  if (values.help) {
    console.log(`copilot-value [rank|refresh] [options]

Ranks models enabled on your Copilot subscription using your gh CLI login.
No inference calls. --all ranks the published catalog without authentication.
Pretty output by default; --json emits one JSON object. No login needed for --help.

CHOOSE A RANKING
  "Leading / strongest models"  Sort by intelligence or coding; limit with --top.
  "Best deal"                   Sort by value (score per estimated workload USD).
  "Cheapest strong model"       Sort by price after setting a --min-score floor.
  "Compare my shortlist"        Use --models with exact IDs from an earlier result.

EXAMPLES
  Top 5 enabled models by general intelligence, with prices alongside:
    copilot-value --sort intelligence --top 5

  Top 10 enabled models by coding score:
    copilot-value --sort coding --top 10

  Intelligence leaders as JSON for an agent or script:
    copilot-value --sort intelligence --top 10 --json

  Best coding score per estimated dollar (can favor smaller models):
    copilot-value --sort value --metric coding --top 5

  Cheapest models with intelligence score at least 50:
    copilot-value --sort price --metric intelligence --min-score 50

  Best intelligence score per dollar among models scoring at least 50:
    copilot-value --sort value --metric intelligence --min-score 50

  Cheapest models with coding score at least 70, as JSON:
    copilot-value --sort price --metric coding --min-score 70 --json

  Compare a shortlist by intelligence; subscription filtering still applies:
    copilot-value --models gpt-6-astra,claude-opus-5 --sort intelligence

  Compare costs for 100k total input, including 80k cache reads, and 5k output:
    copilot-value --sort price --metric intelligence --min-score 50 --input 100000 --cached-input 80000 --output 5000

  Explore the published catalog instead of your subscription:
    copilot-value --all --sort intelligence --top 10

  Reuse cached data without network calls (stale data is marked):
    copilot-value --offline --sort intelligence --top 5 --json

  Force refresh of eligibility, prices, and benchmarks:
    copilot-value refresh

INTERPRET RESULTS
  Scores are Artificial Analysis indices, not definitive model capability.
  "Frontier" has no automatic cutoff. List leaders or ask for a quality floor;
  50 intelligence / 70 coding above are examples, not recommended thresholds.
  --top limits rows AFTER ranking/filtering; it does not mean "cheapest of top N".
  --min-score applies to the selected metric. Use --metric with value or price;
  coding/intelligence sorts select their own metric.
  Costs assume 100k uncached input + 10k output unless overridden. Cache mix,
  output length, and reasoning-token usage can change the price comparison.
  JSON models[] includes id, dispatchId, benchmark variant, score, costUsd,
  aiCredits, value, and rates. Check scope, eligibility timestamps, stale,
  eligibility.stale, and skipped. --all does not prove account eligibility.
  Recommendations do not switch models, launch workers, or authorize spending.

OPTIONS
  --sort coding|intelligence|value|price    Default: coding
  --metric coding|intelligence             Metric for value/price; default: coding
  --min-score N                           Exclude scores below N
  --input N                               Total input, including cache; default: 100000
  --cached-input N                        Cache-read subset; default: 0
  --cache-write N                         Cache-write subset; default: 0
  --output N                              Output tokens; default: 10000
  --top N                                 1–100; default: 10
  --all                                   Published catalog instead of subscription
  --host HOST                             github.com or *.ghe.com (or GH_HOST); token from GITHUB_TOKEN or gh auth token
  --models id,id                          Narrow scope to exact IDs; never bypass eligibility
  --mapping FILE                          JSON object: Copilot ID -> exact AA slug
  --cache FILE                            Snapshot path (or COPILOT_VALUE_CACHE)
  --aa-cache FILE                         Existing pi AA cache (or AA_MODEL_CACHE)
  --offline                               Use snapshot without network, even if stale
  --json                                  Machine-readable result

refresh fetches Copilot eligibility, models.dev and AA (or imports a fresh pi AA cache).
ARTIFICIAL_ANALYSIS_API_KEY enables direct AA refresh.
Cache TTL: 15 minutes for eligibility; 6 hours for prices and benchmarks.
Exit codes: 0 = results, 1 = error (stderr), 2 = no rankable models.
Value is score per workload dollar, not task success per dollar.`);
  } else {
    const command = positionals[0] ?? 'rank';
    if (positionals.length > 1 || !['rank', 'refresh'].includes(command)) throw Error('Expected rank or refresh; see --help');
    const query = Object.fromEntries(Object.entries(querySchema.properties).flatMap(([key, schema]) => {
      const value = values[names[key] ?? key];
      return value === undefined ? [] : [[key, schema.type === 'string' ? value : value.trim() ? Number(value) : NaN]];
    }));
    const mappings = values.mapping ? JSON.parse(await readFile(values.mapping, 'utf8')) : {};
    const modelIds = values.models?.split(',').map(id => id.trim());
    if (modelIds?.some(id => !id)) throw Error('--models cannot contain empty IDs');
    const result = await getRankings(query, { cache: values.cache, aaCache: values['aa-cache'], host: values.host, offline: values.offline, refresh: command === 'refresh', all: values.all, mappings, modelIds });
    console.log(values.json ? JSON.stringify(result, null, 2) : format(result));
    if (!result.total) process.exitCode = 2;
  }
} catch (error) {
  console.error(`copilot-value: ${error.message}`);
  process.exitCode = 1;
}
