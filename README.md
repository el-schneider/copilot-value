# copilot-value

Answers two questions about the models on your GitHub Copilot subscription: which one is best for coding, and which one is the best value for money. Useful because Copilot offers dozens of models, their prices span more than an order of magnitude, and the picker shows no quality signal.

```
$ copilot-value value

#  MODEL               SCORE     USD  CREDITS
1  gpt-6-luna         1583.3  0.0150     1.50
2  gemini-3.7-flash   1593.0  0.1125    11.25
3  grok-4.7           1636.3  0.2600    26.00
4  claude-sonnet-5.5  1698.8  0.3000    30.00
5  claude-opus-5.5    1820.3  0.6000    60.00
```

Each row costs more and scores higher than the one before. Every model not listed is beaten on both price and score by one that is.

No inference calls, no quota spent, nothing changed on your account.

## Install

Node.js 22.19+ and the [GitHub CLI](https://cli.github.com) logged in (`gh auth login`), or `GITHUB_TOKEN` set.

```sh
npm install -g copilot-value
```

## Use

```sh
copilot-value                        # best models for coding
copilot-value value                  # best value for money
copilot-value value --input 200000 --cached-input 150000 --output 8000   # your workload shape
copilot-value --models claude-opus-5.5,gpt-6-sol   # compare a shortlist
copilot-value --json                 # for scripts and agents
```

`--help` lists everything else. Scores are benchmarks, not your task, and cost is a token estimate, not a bill.

## Scores

Works without any key: scores come from the public [LMArena WebDev](https://lmarena.ai/leaderboard/webdev) leaderboard (human-preference Elo on coding tasks, [CC BY 4.0](https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset)).

Set `ARTIFICIAL_ANALYSIS_API_KEY` ([free](https://artificialanalysis.ai/data-api)) to use the [Artificial Analysis](https://artificialanalysis.ai) Intelligence Index instead. `--source aa|arena` picks one explicitly. Prices come from https://models.dev. Everything is cached for 6 hours; `copilot-value refresh` forces a fetch.

## Agents

Full JSON contract, caveats, and data sources: [skills/copilot-value/SKILL.md](skills/copilot-value/SKILL.md).

```sh
npx skills add el-schneider/copilot-value
```

Users of [pi](https://github.com/badlogic/pi-mono) get a `copilot_value` tool and `/gh-model` command with `pi install copilot-value`.

## License

[MIT](LICENSE)
