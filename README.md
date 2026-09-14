# copilot-value

Rank models enabled on your GitHub Copilot subscription by Artificial Analysis benchmarks and estimated token cost. The CLI uses your GitHub CLI login (`gh auth login`) or `GITHUB_TOKEN`, prints a table by default, and supports JSON. It makes no inference calls and never enables models.

Requires Node.js 22.19 or newer. This package is local-only and has a publish guard.

```sh
npm link --ignore-scripts
copilot-value refresh
copilot-value
copilot-value --sort value
copilot-value --all                     # Published catalog, without account filtering
copilot-value --sort price --min-score 70
copilot-value --sort value --metric intelligence --json
copilot-value --input 100000 --cached-input 80000 --output 5000
copilot-value --models gpt-5.5,claude-sonnet-4.6 --offline
```

## Data and rankings

- Availability: the authenticated Copilot `/models` endpoint, using pi's OAuth login. Disabled, unconfigured, non-picker, and explicitly non-tool models are excluded. Individual accounts with no usable picker flags use explicitly enabled policies, matching pi's account-specific handling. Availability is cached for 15 minutes and timestamped. This internal endpoint can change independently of the package.
- Prices: https://models.dev/api.json (`github-copilot`). This is a community-maintained catalog. Verify billing at https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing.
- Benchmarks: https://artificialanalysis.ai/api/v2/data/llms/models. Attribution: Artificial Analysis, https://artificialanalysis.ai.
- `coding` and `intelligence` sort by the corresponding AA index. `value` sorts by index score divided by estimated workload USD. `price` sorts by estimated workload USD; `--min-score` excludes weaker models. Ties use cost, then model ID in lexical order.
- Defaults: 100,000 total input tokens and 10,000 output tokens, with no cache hits or writes. `--input` includes `--cached-input` and `--cache-write`; those subsets must not overlap. Cost is `(uncached × input rate + cached × read rate + writes × write rate + output × output rate) / 1,000,000`. AI credits equal USD × 100.
- Long-context pricing activates when total input exceeds the published threshold. Workloads exceeding catalog input/context/output limits are excluded. Missing scores, matches, or required cache rates are listed under exclusions, never guessed.
- These estimates apply to token-billed Copilot plans, not legacy premium requests. They exclude subscription fees, included allowances, discounts, and account-specific promotions. Remaining quota is not queried.
- AA evaluates particular reasoning/effort settings. Each result shows the full benchmark variant. Scores do not measure pi task success, Copilot latency, or model-specific token consumption. A cheap token estimate does not guarantee a cheap completed task.

Matching uses exact IDs after normalizing dots/underscores to hyphens, plus four explicit aliases for Claude Sonnet 4, Sonnet 4.6, Opus 4.6, and Haiku 4.5 reasoning variants. No prefix or fuzzy matching. Override a variant with `--mapping FILE`, where the JSON object maps a Copilot ID to an exact AA slug. The result includes the resolved benchmark name and slug.

## Cache and credentials

Requirement: a GitHub token with Copilot access. The CLI takes `GITHUB_TOKEN` if set, otherwise runs `gh auth token`, so `gh auth login` is all the setup needed. `--host HOST` (or `GH_HOST`) selects a `*.ghe.com` enterprise account and passes the host to `gh`; other enterprise domains fail explicitly. The token is only sent to the Copilot `/models` endpoint and is never written anywhere.

The default scope is subscription-enabled models. `--models` narrows that scope; it never bypasses eligibility. `--all` explicitly selects the published catalog and needs no Copilot login. Authentication/API errors never fall back to the catalog. Neither scope checks remaining credits or guarantees future access.

Set `ARTIFICIAL_ANALYSIS_API_KEY` for direct AA fetches. Alternatively, use `--aa-cache FILE` or `AA_MODEL_CACHE` to import a fresh pi benchmark cache (`{"time": <epoch-ms>, "data": [...]}`). Without a key or explicit path, the CLI reads `aa-models-cache.json` in `PI_CODING_AGENT_DIR`, or `~/.pi/agent`.

Snapshots live at `$XDG_CACHE_HOME/copilot-value/snapshot.json`, defaulting to `~/.cache/copilot-value/snapshot.json`. Override with `--cache FILE` or `COPILOT_VALUE_CACHE`.

The eligibility cache is stored beside the snapshot with an `.eligibility.json` suffix and bound to a hash of the current token. Another token cannot reuse it. `--offline` still requires that matching token unless `--all` is set.

Prices and benchmarks have a six-hour freshness limit. Expired snapshots refresh on the next query. Refresh errors fail instead of returning stale rankings. `--offline` makes no network calls and permits stale snapshots, marked in output. `refresh` repairs corrupt caches and forces an eligibility fetch (unless `--all`), a price fetch, and a direct AA fetch or fresh pi-cache import. Source timestamps survive imports.

For repeatable comparisons, preserve a snapshot and its eligibility sidecar, then use `--cache FILE --offline` with the same GitHub token. Use `--all --offline` to compare the catalog without eligibility. JSON includes a snapshot SHA-256, source timestamps, workload, rates, exclusions, and dispatch IDs. Ranking order is deterministic for the same snapshot, mappings, and options; the stale flag changes as time passes.

AA keys and downloaded data are not bundled. AA API access and redistribution are subject to https://artificialanalysis.ai/data-api. Use your own authorized key or local cache; do not redistribute free-tier benchmark snapshots.

Exit codes: `0` for results, `1` for errors, `2` when no model can be ranked. Errors go to stderr; JSON stdout contains one result object. Run `copilot-value --help` for all options.

## Optional pi extension

Tested with pi 0.85.0. From the package directory:

```sh
pi -e "$PWD"
# Persist the package when ready:
pi install "$PWD"
```

- `/gh-model coding`: shows ranked models, then confirms a session-only switch. Default sort is `coding`; `intelligence`, `value`, and `price` are also supported. The first entry is the winner, but you can choose another. The command uses the default workload above. It does not change startup defaults or force a thinking level; pi may clamp thinking to model capabilities.
- `copilot_value`: read-only tool accepting `sort`, `metric`, `minScore`, `input`, `cachedInput`, `cacheWrite`, `output`, `top`, `all`, and `offline`. It returns `github-copilot/<model-id>` dispatch IDs. It neither launches subagents nor authorizes quota use.

The extension intersects subscription-enabled models with pi's authenticated registry, including models outside the current cycling scope. `all: true` queries the published catalog instead and does not promise that returned IDs are usable by pi. `/gh-model` always uses subscription scope. `offline: true` is available on the tool for explicitly accepting stale snapshots.

Example instruction: “Use copilot_value to find the cheapest Copilot model with coding score at least 70. Use its dispatchId for implementation workers only.” Your subagent tool still controls dispatch and permissions. CLI mapping-file overrides are not used by the extension.

## Local verification

```sh
npm test
npm run test:pi
npm pack --ignore-scripts
```

`test:pi` needs pi on PATH, `gh auth login`, and a fresh snapshot. It invokes the registered tool without an LLM, verifies cancel/confirm behavior through real RPC dialogs, and checks that inference tokens and cost remain zero. It runs in a temporary, non-persistent session and does not change your active session.

The package has no runtime dependencies or build step. Tests use Node's built-in runner and synthetic fixtures; local benchmark data stays outside the package.
