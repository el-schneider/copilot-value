---
name: copilot-value
description: Pick the best or cheapest GitHub Copilot model for a task. Use when choosing a Copilot model, comparing model cost vs. benchmark score, or picking a model for a subagent or worker on a Copilot subscription.
---

# copilot-value

Ranks models enabled on the user's Copilot subscription by Artificial Analysis benchmark score and estimated token cost. Read-only: no inference, no quota use, no account changes.

Requires `copilot-value` on PATH (`npm install -g copilot-value`) and `gh auth login` or `GITHUB_TOKEN`.

## Commands

Always use `--json`. One object on stdout; errors as `{"error": "..."}` on stderr. Exit `0` results, `1` error, `2` nothing rankable.

```sh
copilot-value --json --top 5                         # strongest coding models
copilot-value --json --sort intelligence --top 5     # general intelligence
copilot-value --json --sort value                    # best score per dollar
copilot-value --json --sort price --min-score 70     # cheapest model above a quality floor
copilot-value --json --input 200000 --cached-input 150000 --output 8000   # workload shape
copilot-value --json --models gpt-6-astra,claude-opus-5                   # compare a shortlist
copilot-value --json --all                           # published catalog, ignores eligibility
copilot-value --json --offline                       # no network; accepts stale snapshot
copilot-value refresh                                # force-refresh every source
```

Options: `--sort coding|intelligence|value|price`, `--metric coding|intelligence` (score used by `value`/`price`), `--min-score N`, `--top 1..100`, `--input/--cached-input/--cache-write/--output N` (cached and write are subsets of input), `--models a,b`, `--mapping FILE` (JSON `{copilotId: aaSlug}` to fix a benchmark match), `--host corp.ghe.com`, `--cache FILE`, `--aa-cache FILE`.

## Reading the result

- `models[]`: ranked. `id` is the Copilot ID; `dispatchId` is `github-copilot/<id>` for tools taking a provider/model string.
- `models[].score`, `costUsd`, `aiCredits` (USD × 100), `value` (score per USD), `rates` (per-million-token prices), `metric`.
- `models[].benchmark.name`: the exact AA variant scored, including reasoning effort. Quote it with the score.
- `skipped[]`: excluded models and why (no price, no benchmark match, workload exceeds limits). Never guess for these; a `--mapping` can fix a missing match.
- `eligibility`: `enabledCount`, `fetchedAt`, `selection` (`model-picker` or `enabled-policy`).
- `stale: true`: snapshot older than 6 h. Run `copilot-value refresh` unless offline is required.
- `snapshotId`: SHA-256 of the data; same snapshot plus same options gives the same order.

## Rules

- Only `models[]` from a non-`--all` run are usable on this account. `--all` output and `skipped[]` are not.
- Scores measure benchmarks, not task success. Token cost is an estimate, not a bill; it ignores subscription fees, included allowances, and remaining quota.
- Default workload is 100k input / 10k output, no cache hits. Pass the real shape when known.
- Rankings do not fall back to the catalog on auth errors. On `{"error": ...}` mentioning the token, tell the user to run `gh auth login`.

## Data

- Eligibility: Copilot `/models` (internal endpoint), cached 15 min, keyed to the token. Disabled, unconfigured, non-picker, and non-tool-calling models are excluded.
- Prices: https://models.dev/api.json, `github-copilot` provider. Community-maintained; billing reference at https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing. Long-context rates apply above the published threshold.
- Benchmarks: https://artificialanalysis.ai/api/v2/data/llms/models. Direct fetch needs `ARTIFICIAL_ANALYSIS_API_KEY`; otherwise a pi cache (`~/.pi/agent/aa-models-cache.json`, `AA_MODEL_CACHE`, or `--aa-cache FILE`) is imported. Subject to https://artificialanalysis.ai/data-api; do not redistribute snapshots.
- Matching: exact IDs after normalizing `.`/`_` to `-`, plus explicit aliases for a few Claude reasoning variants. No fuzzy matching.
- Cost: `(uncached × input + cached × cacheRead + writes × cacheWrite + output × output) / 1e6` USD.
- Snapshot: `$XDG_CACHE_HOME/copilot-value/snapshot.json` (or `COPILOT_VALUE_CACHE`), eligibility sidecar `.eligibility.json` beside it. Both mode 0600; tokens are never written.

## pi extension

`pi install copilot-value` registers a `copilot_value` tool (same options as the CLI in camelCase: `sort`, `metric`, `minScore`, `input`, `cachedInput`, `cacheWrite`, `output`, `top`, `all`, `offline`) and a `/gh-model [sort]` command that ranks, then asks before switching the session model. The tool intersects eligibility with pi's registered models and returns `dispatchId`s; it never dispatches anything itself.
