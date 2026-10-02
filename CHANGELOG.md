# Changelog

## 0.5.0

- Scores come from [model-frontier](https://github.com/el-schneider/model-frontier), which moves Artificial Analysis to its v2 free endpoint (`/api/v2/language/models/free`). The old endpoint retires before 4 November 2026. Scores are cached 24 hours and shared with the `model-frontier` CLI.
- The attribution line names the LMArena dataset and links its CC BY 4.0 license, in text and in JSON (`source.attribution`).

## 0.4.1

- Token lookup: `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`, then the gh login. A classic PAT (`ghp_`) in `GH_TOKEN` or `GITHUB_TOKEN` is skipped with a notice, because Copilot rejects classic PATs. Rejected tokens produce an error with Copilot's reason and the next step (#1).
- `--all-versions` keeps older models of a family as value alternatives, even when a newer model of the family is listed.

## 0.4.0

- `value` shows up to 3 close alternatives under each frontier row, dimmed and indented. An alternative scores within `--margin` of the frontier model (default 5 AA points or 50 Arena Elo), costs less than the next frontier row, and is dropped when a newer model of its family is listed. `--margin 0` shows the strict frontier.
- With an AA key, Arena scores act as a second opinion: a model Arena rates close to the frontier also qualifies as an alternative. A tag after each alternative (`aa`, `arena`, `aa+arena`) shows which source put it close. The second source's margin scales with `--margin`.
- JSON: alternative rows carry `alternativeTo` and `closeOn`; the result has `hedge`; `total` counts frontier rows.

## 0.3.1

README and npm description lead with the two main questions.

## 0.3.0

Breaking: simpler commands, and works without an API key.

- `copilot-value` shows the best value: the price/score frontier (each row costs more and scores higher; every other model is beaten on both, and the footer counts them). `copilot-value best` shows the strongest models. Replaces `--sort` and `--metric`, and the score-per-dollar ratio, which always favoured the cheapest model.
- Without `ARTIFICIAL_ANALYSIS_API_KEY`, scores come from the public LMArena WebDev leaderboard. With the key, the Artificial Analysis Intelligence Index is used. `--source aa|arena` overrides.
- Removed `--aa-cache` and the pi AA cache import.
- Shorter default output: score and cost per task, one line of unranked models. `--verbose` shows benchmark variants, exclusion reasons, timestamps and caveats. Subtle color in terminals; off when piped or with `NO_COLOR`.
- The AA API key is never sent after a redirect.
- JSON rows no longer have `value`, `metric` or `scores`. The result has `source`, and `dominated` (models left off the value frontier).

## 0.2.0

- Intelligence is now the default metric for `--sort` and `--metric`. Artificial Analysis often has no coding score for new models, so the old coding default dropped them from the ranking.
- Results show the other score in a secondary column. JSON rows include `scores: {intelligence, coding}`, with `null` when a score is not published.

## 0.1.1

Automated npm publishing via GitHub releases.

## 0.1.0

Initial release.
