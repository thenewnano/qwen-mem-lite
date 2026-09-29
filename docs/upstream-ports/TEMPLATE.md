# Port record: <slug>

- Date: <YYYY-MM-DD>
- Upstream range: `<last-ported-sha>`..`<upstream-main-sha>`
- Upstream version(s) covered: <vX.Y.Z, ...>
- Branch: `port/<slug>`
- Status: in progress | merged | abandoned
- Gates: vitest <pass/fail> - coverage <pass/fail> - lint+format <pass/fail> - manifests <pass/fail>

## Commits

| upstream | subject | tier | disposition | adaptation commit | notes |
|---|---|---|---|---|---|
| `<sha>` | `<subject>` | 1 | picked | - | clean |
| `<sha>` | `<subject>` | 2 | adapted | `<sha> port(<area>): adapt <sha> ...` | env prefix |
| `<sha>` | `<subject>` | - | skipped | - | upstream docs-only |

## Fork deviations introduced

- <one line per adaptation commit: which invariant, what changed>

## Deferred / follow-ups

- <sha or area, with the reason and where it is tracked>