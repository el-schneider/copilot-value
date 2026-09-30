# copilot-value

Ranks the models available on your GitHub Copilot subscription by [Artificial Analysis](https://artificialanalysis.ai) benchmark score and by estimated token cost for a given workload. Useful for choosing between the dozens of Copilot models, whose prices span more than an order of magnitude and whose picker shows no quality signal.

```
$ copilot-value --all --top 5

#  MODEL              SCORE  CODING     USD  CREDITS  SCORE/$
1  claude-opus-5.5     57.6       -  0.6000    60.00     96.0
2  claude-sonnet-5.5   56.0       -  0.3000    30.00    186.7
3  claude-fable-5.1    53.4    81.6  1.5000   150.00     35.6
4  gpt-6-astra         52.7    76.9  1.5000   150.00     35.1
5  gpt-6.1-sol         51.8       -  0.3000    30.00    172.7
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
copilot-value                                    # intelligence score, top 10
copilot-value --sort coding                      # coding score; only models AA scored for coding
copilot-value --sort value                       # score per dollar
copilot-value --sort price --min-score 45        # cheapest above a quality bar
copilot-value --input 200000 --cached-input 150000 --output 8000   # your workload shape
copilot-value --models gpt-6-astra,claude-opus-5 # compare a shortlist
copilot-value --json                             # for scripts and agents
```

`--help` lists everything else. Prices come from https://models.dev, scores from Artificial Analysis; both cache for 6 hours (`refresh` forces it). Scores are benchmarks, not your task, and cost is a token estimate, not a bill.

Intelligence is the default metric because Artificial Analysis publishes it for nearly every model. Coding scores often lag for new releases, so `--sort coding` lists those models under "Excluded" instead of ranking them.

## Agents

Full JSON contract, caveats, and data sources: [skills/copilot-value/SKILL.md](skills/copilot-value/SKILL.md).

```sh
npx skills add el-schneider/copilot-value
```

Users of [pi](https://github.com/badlogic/pi-mono) get a `copilot_value` tool and `/gh-model` command with `pi install copilot-value`.

## License

[MIT](LICENSE)
