# copilot-value

Get the most out of your GitHub Copilot subscription.

- Which model gives me the most for my AI credits? `copilot-value`
- Which model is strongest for coding? `copilot-value best`

Copilot offers about 30 models. The same task can cost 100× more on one than on another, and the model picker shows no quality score. copilot-value ranks the models your plan enables by benchmark score and token cost.

```
$ copilot-value
Best value · 30 models on your plan · LMArena WebDev Elo
Each numbered row scores higher and costs more than the one above. Indented: alternatives within 50 points in the same price tier.

#  MODEL               SCORE    COST
1  gpt-6-luna           1583  $0.015
2  gemini-3.7-flash     1593  $0.113
     gemini-3.8-flash   1581  $0.113
3  grok-4.7             1636  $0.260
4  claude-sonnet-5.5    1699  $0.300
     gpt-6-sol          1692  $0.300
     kimi-k3            1659  $0.450
5  claude-opus-5.5      1820  $0.600

Cost per task: 100k input, 10k output.
18 more models omitted: each is beaten on price and score by a listed model (copilot-value best lists all).
Not ranked: claude-opus-4.8-fast, gpt-5-mini, gpt-6.1-sol, mai-code-1.1-flash (--verbose for reasons).
Scores: https://lmarena.ai/leaderboard/webdev · Prices: https://models.dev
```

Read-only: no inference calls, no quota spent, nothing changed on your account.

## Install

Node.js 22.19+ and the [GitHub CLI](https://cli.github.com) logged in (`gh auth login`), or `GITHUB_TOKEN` set.

Token order: `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`, then the gh login. Copilot accepts gh OAuth tokens and [fine-grained PATs](https://github.com/settings/personal-access-tokens/new) with the **Copilot Requests** permission, but no classic PATs (`ghp_...`). A classic PAT in `GH_TOKEN` or `GITHUB_TOKEN` is skipped with a notice. `--all` ranks the published catalog and needs no token.

```sh
npm install -g copilot-value
```

## Use

```sh
copilot-value                        # best value for money
copilot-value best                   # best models for coding
copilot-value --input 200000 --cached-input 150000 --output 8000   # your workload shape
copilot-value --margin 0             # strict frontier, no alternatives
copilot-value --all-versions         # include older models of a listed family
copilot-value best --models claude-opus-5.5,gpt-6-sol   # compare a shortlist
copilot-value --verbose              # plus benchmark variants, exclusion reasons, timestamps
copilot-value --json                 # for scripts and agents
```

`--help` lists everything else. Scores are benchmarks, not your task, and cost is a token estimate, not a bill.

## Scores

Works without any key: scores come from the public [LMArena WebDev](https://lmarena.ai/leaderboard/webdev) leaderboard (human-preference Elo on coding tasks, [CC BY 4.0](https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset)).

Set `ARTIFICIAL_ANALYSIS_API_KEY` ([free](https://artificialanalysis.ai/data-api)) to use the [Artificial Analysis](https://artificialanalysis.ai) Intelligence Index instead. Arena then acts as a second opinion: a model it rates close to the frontier also shows up as an alternative, tagged `arena`. `--source aa|arena` picks the ranking source explicitly. Prices come from https://models.dev. Everything is cached for 6 hours; `copilot-value refresh` forces a fetch.

## Agents

Full JSON contract, caveats, and data sources: [skills/copilot-value/SKILL.md](skills/copilot-value/SKILL.md).

```sh
npx skills add el-schneider/copilot-value
```

Users of [pi](https://github.com/badlogic/pi-mono) get a `copilot_value` tool and `/gh-model` command with `pi install copilot-value`.

## License

[MIT](LICENSE)
