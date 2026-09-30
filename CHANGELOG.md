# Changelog

## 0.2.0

- Intelligence is now the default metric for `--sort` and `--metric`. Artificial Analysis often has no coding score for new models, so the old coding default dropped them from the ranking.
- Results show the other score in a secondary column. JSON rows include `scores: {intelligence, coding}`, with `null` when a score is not published.

## 0.1.1

Automated npm publishing via GitHub releases.

## 0.1.0

Initial release.
