# copilot-value

Ranks the models available on your GitHub Copilot subscription by [Artificial Analysis](https://artificialanalysis.ai) benchmark score and by estimated token cost for a given workload. Useful for choosing between the dozens of Copilot models, whose prices span more than an order of magnitude and whose picker shows no quality signal.

```
$ copilot-value --all --top 5

#  MODEL             SCORE     USD  CREDITS  SCORE/$
1  claude-fable-5.1   81.6  1.5000   150.00     54.4
2  claude-opus-5      78.0  0.7500    75.00    104.0
3  gpt-5.6-sol        77.4  0.6000    60.00    129.0
4  gpt-6-astra        76.9  1.5000   150.00     51.3
5  grok-4.6           76.8  0.2600    26.00    295.4
```

Without `--all` the list contains only models enabled on your subscription.

No inference calls, no quota spent, nothing changed on your account.

## Install

Node.js 22.19+ and the [GitHub CLI](https://cli.github.com) logged in (`gh auth login`), or `GITHUB_TOKEN` set.

```sh
npm install -g copilot-value
```

## Use

```sh
copilot-value                                    # coding score, top 10
copilot-value --sort value                       # score per dollar
copilot-value --sort price --min-score 70        # cheapest above a quality bar
copilot-value --input 200000 --cached-input 150000 --output 8000   # your workload shape
copilot-value --models gpt-6-astra,claude-opus-5 # compare a shortlist
copilot-value --json                             # for scripts and agents
```

`--help` lists everything else. Prices come from https://models.dev, scores from Artificial Analysis; both cache for 6 hours (`refresh` forces it). Scores are benchmarks, not your task, and cost is a token estimate, not a bill.

## Agents

Full JSON contract, caveats, and data sources: [skills/copilot-value/SKILL.md](skills/copilot-value/SKILL.md).

```sh
npx skills add el-schneider/copilot-value
```

Users of [pi](https://github.com/badlogic/pi-mono) get a `copilot_value` tool and `/gh-model` command with `pi install copilot-value`.

## License

[MIT](LICENSE)
