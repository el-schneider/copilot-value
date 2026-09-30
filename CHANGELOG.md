# Changelog

## Unreleased

Breaking: simpler commands, and works without an API key.

- `copilot-value` shows the best models; `copilot-value value` shows the price/score frontier (each row costs more and scores higher; every other model is beaten on both). Replaces `--sort` and `--metric`, and the score-per-dollar ratio, which always favoured the cheapest model.
- Without `ARTIFICIAL_ANALYSIS_API_KEY`, scores come from the public LMArena WebDev leaderboard. With the key, the Artificial Analysis Intelligence Index is used. `--source aa|arena` overrides.
- Removed `--aa-cache` and the pi AA cache import.
- JSON rows no longer have `value`, `metric` or `scores`; the result has `source`.

## 0.2.0

- Intelligence is now the default metric for `--sort` and `--metric`. Artificial Analysis often has no coding score for new models, so the old coding default dropped them from the ranking.
- Results show the other score in a secondary column. JSON rows include `scores: {intelligence, coding}`, with `null` when a score is not published.

## 0.1.1

Automated npm publishing via GitHub releases.

## 0.1.0

Initial release.
