---
name: copilot-value
description: Pick the best or best-value GitHub Copilot model for a task. Use when choosing a Copilot model, comparing model cost vs. benchmark score, or picking a model for a subagent or worker on a Copilot subscription.
---

# copilot-value

Ranks models enabled on the user's Copilot subscription by benchmark score and estimated token cost. Read-only: no inference, no quota use, no account changes.

Requires `copilot-value` on PATH (`npm install -g copilot-value`) and `gh auth login` or `GITHUB_TOKEN`.

## Commands

Always use `--json`. One object on stdout; errors as `{"error": "..."}` on stderr. Exit `0` results, `1` error, `2` nothing rankable.

```sh
copilot-value --json                       # best value: price/score frontier, cheapest first
copilot-value best --json                  # best models for coding, strongest first
copilot-value --json --min-score N         # first row = cheapest model at or above N
copilot-value --json --input 200000 --cached-input 150000 --output 8000   # workload shape
copilot-value best --json --models claude-opus-5.5,gpt-6-sol   # compare a shortlist
copilot-value best --json --all            # published catalog, ignores eligibility
copilot-value --json --offline             # no network; accepts stale snapshot
copilot-value refresh                      # force-refresh every source
```

Options: `--source aa|arena`, `--min-score N`, `--margin N` (value alternatives; default 5 for aa, 50 for arena; 0 = none), `--all-versions` (keep older family members as alternatives), `--top 1..100`, `--input/--cached-input/--cache-write/--output N` (cached and write are subsets of input), `--models a,b`, `--mapping FILE` (JSON `{copilotId: benchmarkSlug}` to fix a match), `--host corp.ghe.com`, `--cache FILE`.

## Score sources

- `aa`: Artificial Analysis Intelligence Index, scale ~0–70. Default when `ARTIFICIAL_ANALYSIS_API_KEY` is set.
- `arena`: LMArena WebDev Elo (human preference on web-app coding tasks), scale ~1300–1850. Default without a key; needs no signup.

`source` in the result names the active one. In `value` mode the other source, when available (Arena always; AA only with a key), acts as a second opinion for alternatives: `hedge` names it and its margin, scaled from `--margin` (5 AA ↔ 50 Elo). Offline without its cached data, `hedge` is `null`. Scales differ: never compare scores across sources, and pick `--min-score` for the active scale.

## Reading the result

- `models[]`: ranked. `id` is the Copilot ID; `dispatchId` is `github-copilot/<id>` for tools taking a provider/model string.
- `models[].score`, `costUsd`, `aiCredits` (USD × 100), `rates` (per-million-token prices).
- `models[].benchmark.name`: the exact variant scored, including reasoning effort. Quote it with the score.
- In `value` mode (the default), `models[]` is the frontier plus close alternatives. Frontier rows: each costs more and scores higher than the previous one. Rows with `alternativeTo: <id>` follow that frontier row: they score within `margin` of it (or, when `hedge` is set, within `hedge.margin` on the second source), cost less than the next frontier row, and have no newer same-family model listed (models.dev `family`; `--all-versions` keeps them). At most 3 per row. `closeOn` lists the sources (`aa`, `arena`) that put the model close; quote it. `total` counts frontier rows; `--top` limits frontier rows. Models not listed are beaten on both; `dominated` counts them, and they are not in `skipped[]`.
- `skipped[]`: excluded models and why (no price, no benchmark match, workload exceeds limits). Never guess for these; a `--mapping` can fix a missing match.
- `eligibility`: `enabledCount`, `fetchedAt`, `selection` (`model-picker` or `enabled-policy`).
- `stale: true`: snapshot older than 6 h. Run `copilot-value refresh` unless offline is required.
- `snapshotId`: SHA-256 of the data; same snapshot plus same options gives the same order.

## Rules

- Only `models[]` from a non-`--all` run are usable on this account. `--all` output and `skipped[]` are not.
- Scores measure benchmarks, not task success. Token cost is an estimate, not a bill; it ignores subscription fees, included allowances, and remaining quota.
- Default workload is 100k input / 10k output, no cache hits. Pass the real shape when known.
- Rankings do not fall back to the catalog on auth errors. On `{"error": ...}` mentioning the token, tell the user to run `gh auth login` or set `COPILOT_GITHUB_TOKEN` to a fine-grained PAT with the Copilot Requests permission. Copilot rejects classic PATs (`ghp_`); one in `GH_TOKEN`/`GITHUB_TOKEN` is skipped and reported in `eligibility.skippedTokens`.

## Data

- Eligibility: Copilot `/models` (internal endpoint), cached 15 min, keyed to the token. Disabled, unconfigured, non-picker, and non-tool-calling models are excluded.
- Prices: https://models.dev/api.json, `github-copilot` provider. Community-maintained; billing reference at https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing. Long-context rates apply above the published threshold.
- Scores come from [model-frontier](https://github.com/el-schneider/model-frontier), cached 24 h in `$XDG_CACHE_HOME/model-frontier/` and shared with its CLI.
- AA: https://artificialanalysis.ai/api/v2/language/models/free with `ARTIFICIAL_ANALYSIS_API_KEY`. Subject to https://artificialanalysis.ai/data-api; do not redistribute snapshots.
- Arena: `webdev` config, `latest` split, `overall` category of https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset (CC BY 4.0).
- Matching: IDs normalized (`.`/`_` to `-`). AA: exact slug, plus explicit aliases for a few Claude reasoning variants. Arena: exact name or name plus effort/date/harness suffix (`-high`, `-max`, `-20251001`, ` (codex-harness)`); the best-scoring variant wins. No fuzzy matching.
- Cost: `(uncached × input + cached × cacheRead + writes × cacheWrite + output × output) / 1e6` USD.
- Snapshot: `$XDG_CACHE_HOME/copilot-value/snapshot-<source>.json` (or `COPILOT_VALUE_CACHE`), eligibility sidecar `.eligibility.json` beside it (`.eligibility-pi-login.json` for the pi extension). Both mode 0600; tokens and keys are never written.

## pi extension

`pi install copilot-value` registers a `copilot_value` tool (options in camelCase: `mode` (`value` default, or `best`), `source`, `minScore`, `margin`, `allVersions`, `input`, `cachedInput`, `cacheWrite`, `output`, `top`, `all`, `offline`) and a `/gh-model [value|best]` command that ranks, then asks before switching the session model. Eligibility comes from pi's Copilot login (`tokenSource: "pi login"`), not from gh or token variables. A matching result is reused for 15 minutes and expires when pi's token rotates; `offline` requires `all`. On an auth error, tell the user to run `/login` in pi. The tool intersects eligibility with pi's registered models and returns `dispatchId`s; it never dispatches anything itself.
