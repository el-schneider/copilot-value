#!/usr/bin/env node
import { parseArgs, styleText } from 'node:util';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { format, querySchema } from '../src/index.js';
import { query as getRankings } from '../src/query.js';

const names = { minScore: 'min-score', cachedInput: 'cached-input', cacheWrite: 'cache-write' };
const flags = Object.keys(querySchema.properties).filter(key => key !== 'mode');
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    ...Object.fromEntries(flags.map(key => [names[key] ?? key, { type: 'string' }])),
    all: { type: 'boolean' }, host: { type: 'string' },
    json: { type: 'boolean' }, verbose: { type: 'boolean' }, offline: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
    cache: { type: 'string' }, mapping: { type: 'string' }, models: { type: 'string' },
  } });
  if (values.version) {
    console.log(createRequire(import.meta.url)('../package.json').version);
  } else if (values.help) {
    console.log(`copilot-value [value|best|refresh] [options]

  value    Best value for money (default): the price/score frontier, cheapest first.
           Each row costs more and scores higher than the one before;
           every model left out is beaten on both. Indented rows are close
           alternatives: within --margin points, same price tier, newest per family.
  best     Strongest models on your Copilot subscription, cost alongside
  refresh  Re-fetch eligibility, prices and scores

Uses your gh CLI login; no inference calls. --all ranks the published catalog without login.

SCORES
  With ARTIFICIAL_ANALYSIS_API_KEY set: Artificial Analysis Intelligence Index.
  Without a key: LMArena WebDev Elo (public, coding-focused, no signup).
  --source aa|arena overrides. Scales differ; --min-score uses the active one.

EXAMPLES
  Best value for money:
    copilot-value

  Best models for coding:
    copilot-value best

  Cheapest model above a quality floor (first row):
    copilot-value --min-score 1600 --source arena

  Your workload: 200k input, 150k of it cache reads, 8k output:
    copilot-value --input 200000 --cached-input 150000 --output 8000

  Compare a shortlist, as JSON:
    copilot-value best --models claude-opus-5.5,gpt-6-sol --json

  Published catalog instead of your subscription:
    copilot-value best --all --top 5

  Cached data only, no network (stale data is marked):
    copilot-value --offline --json

OPTIONS
  --source aa|arena        Score source; default aa if a key is set, else arena
  --min-score N            Exclude scores below N
  --margin N               Alternatives within N points; default 5 (aa) or 50 (arena); 0 = none
  --input N                Total input, including cache; default 100000
  --cached-input N         Cache-read subset; default 0
  --cache-write N          Cache-write subset; default 0
  --output N               Output tokens; default 10000
  --top N                  1–100; default 10
  --models id,id           Narrow to exact IDs; never bypasses eligibility
  --all                    Published catalog instead of subscription
  --host HOST              github.com or *.ghe.com (or GH_HOST); token from GITHUB_TOKEN or gh auth token
  --mapping FILE           JSON object: Copilot ID -> exact benchmark slug
  --cache FILE             Snapshot path (or COPILOT_VALUE_CACHE)
  --offline                Use cached snapshot without network, even if stale
  --verbose                Also show timestamps, benchmark variants, exclusion reasons, caveats
  --json                   One JSON object on stdout

Scores are benchmarks, not your task; cost is a token estimate, not a bill.
Cache: 15 minutes for eligibility, 6 hours for prices and scores.
Exit codes: 0 = results, 1 = error (stderr), 2 = no rankable models.`);
  } else {
    const command = positionals[0] ?? 'value';
    if (positionals.length > 1 || !['value', 'best', 'refresh'].includes(command)) throw Error('Expected value, best or refresh; see --help');
    const query = Object.fromEntries(flags.flatMap(key => {
      const value = values[names[key] ?? key];
      return value === undefined ? [] : [[key, querySchema.properties[key].type === 'string' ? value : value.trim() ? Number(value) : NaN]];
    }));
    if (command !== 'refresh') query.mode = command;
    const mappings = values.mapping ? JSON.parse(await readFile(values.mapping, 'utf8')) : {};
    const modelIds = values.models?.split(',').map(id => id.trim());
    if (modelIds?.some(id => !id)) throw Error('--models cannot contain empty IDs');
    const result = await getRankings(query, { cache: values.cache, host: values.host, offline: values.offline, refresh: command === 'refresh', all: values.all, mappings, modelIds });
    console.log(values.json ? JSON.stringify(result, null, 2) : format(result, { verbose: values.verbose, style: styleText }));
    if (!result.total) process.exitCode = 2;
  }
} catch (error) {
  console.error(process.argv.includes('--json') ? JSON.stringify({ error: error.message }) : `copilot-value: ${error.message}`);
  process.exitCode = 1;
}
