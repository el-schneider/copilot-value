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
copilot-value --json --input 200000 --cached-input 150000 --output 8000   # your workload shape
copilot-value --json --models gpt-6-astra,claude-opus-5                   # compare a shortlist
```

## Reading the result

- `models[].id`: Copilot model ID. `models[].dispatchId`: `github-copilot/<id>`, ready for tools that take a provider/model string.
- `models[].score`, `costUsd`, `aiCredits` (USD × 100), `value` (score per USD).
- `models[].benchmark.name`: the exact AA variant scored, including reasoning effort. Report it when quoting a score.
- `skipped[]`: models excluded and why (no price, no benchmark match). Do not guess for these.
- `stale: true`: snapshot older than 6 h; run `copilot-value refresh` unless offline.

## Rules

- Scores measure benchmarks, not task success. Cheap token estimates do not guarantee a cheap completed task.
- Only models in `models[]` are enabled for this account. Never suggest one from `skipped[]` or `--all` output as usable.
- Default workload is 100k input / 10k output. Pass the real shape when known.
