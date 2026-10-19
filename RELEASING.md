# qwen-mem-lite - Releasing

Maintainer runbook, written so an agent session can execute a release without
re-deriving any of it. Budget ~15 minutes, most of it waiting on the workflow.

Read first (60 seconds): the top of `CHANGELOG.md` (the last release, and the
entry style), `git tag --sort=v:refname | tail -3`, and - when a port is pending -
the `docs/upstream-ports/` record: it is what the release summary is written from.

The whole thing: **pick the version → bump five files → add the CHANGELOG entry →
commit → tag → push → watch the workflow → verify the release object.**

## 1. Pick the version

Fork releases are `vX.Y.Z` tags on this repository. Upstream's `6.x` tags are not
release triggers here, and every fork release bumps at least one segment above the
last tag.

| Bump | When |
|---|---|
| patch `v7.1.1` | fixes: advisories, a defect in the previous release, or repairing a release whose workflow went red |
| minor `v7.2.0` | a port of upstream content ("synced with upstream through v6.25.3"); exactly one bump per sync |
| major | a breaking change to the store, the data-directory layout, or the hook contract |

When a port is pending, the README already carries an `Upgrading to vX.Y.Z
(upstream sync)` section - that section names the version to cut.

    git status            # clean, or only known-modified files
    git pull              # release from the freshest main
    head -20 CHANGELOG.md # top entry = the last released version

## 2. The five version surfaces

One bump touches exactly these files, in one commit:

| File | To change |
|---|---|
| `package.json` | `"version"` (once) |
| `package-lock.json` | `"version"` (twice: root and `packages[""]`) |
| `.claude-plugin/plugin.json` | `"version"` (once) |
| `.claude-plugin/marketplace.json` | `"version"` (once) |
| `CLAUDE.md` | the `**Version**:` line - replace only the number; the line itself says "Do not reformat this line" |

`CLAUDE.md`'s line is a **release guard**: `tests/install-e2e.test.mjs` and the
workflow's "Verify version consistency" step both fail if the five disagree, or if
the tag disagrees with `package.json`.

**Dash discipline.** Authored text carries no em-dashes - write `-` from the
start (invariant 6, `PORTING.md` section 2). In practice a PostToolUse hook
(azure-lm) rewrites em/en dashes to `-` across the *whole* file whenever an
Edit/Write-tool write touches it: correct for text you are authoring, but
unrelated churn on legacy files (3,000+ em-dashes in the older `CHANGELOG.md`
history), and it can rewrite a file you only meant to splice. Prepare the release
edits as scripted splices that assert occurrence counts, then verify with
`git diff --stat` (exactly these five files, plus `CHANGELOG.md` from step 3):

    const s = fs.readFileSync(file, 'utf8');
    const n = s.split(needle).length - 1;   // e.g. needle = '"version": "7.2.0"'
    if (n !== expected) throw new Error(`${file}: ${needle} x${n}`);
    fs.writeFileSync(file, s.split(needle).join(replacement));

If `CLAUDE.md` is already dirty: it also carries the auto-managed memory steering
block, which SessionStart syncs can refresh on their own. Stash those edits (or
commit them separately) first, so the release commit stays a pure bump.

## 3. The CHANGELOG entry

Insert a new section directly above the previous release's heading (the file is
reverse-chronological):

    ## vX.Y.Z - <tagline>

    <1-3 sentences: what this release is / carries; for a sync, the upstream
    range and commit count.>

    - **<theme>** - what changed, citing `D#NN` / `#NN` as the history does.
    ...

    No schema change, no data move and no configuration change.   <- keep when true

House style: ASCII hyphens; for ports, describe the incoming work by upstream's
own labels; say what a user could notice. The existing entries are the style guide.

## 4. Commit, tag, push

    git add package.json package-lock.json .claude-plugin/plugin.json \
            .claude-plugin/marketplace.json CLAUDE.md CHANGELOG.md
    git commit -m "release: vX.Y.Z, <lowercase tagline>"
    git tag -a vX.Y.Z -m "vX.Y.Z - <tagline>"
    git push origin main && git push origin vX.Y.Z

Conventions: subject `release: vX.Y.Z, <tagline>`; annotated (not lightweight)
tag; the tag message repeats the CHANGELOG tagline. A release commit carries only
the bump and the entry - no code.

The commit runs the repo hook (`.githooks/pre-commit` -> `scripts/pre-commit.sh`):
version sync, guards, eslint, format check and the full test suite (or a cached
green stamp). Let it run - it is the gate you want.

Two checks the hook does not run (the workflow does), worth running before the tag:

    npm audit --omit=dev     # must be 0 - advisories have stranded a release before
    npm run validate:manifests

Pushing is a publish action: an agent session should get the user's explicit
go-ahead for the push, not just for the commit.

## 5. Watch the release

The tag push starts the `Release` workflow (`.github/workflows/publish.yml` - the
executable spec; if this doc and the workflow disagree, the workflow wins). Find
and watch the run:

    gh run list --repo thenewnano/qwen-mem-lite --event push --branch vX.Y.Z
    gh run watch <run-id> --repo thenewnano/qwen-mem-lite --exit-status

`--repo` is not optional: the checkout carries two remotes (`origin` and
`upstream`), so bare `gh` fails with "no default remote". The main-branch run
that also starts is the regular CI workflow; the tag run is the release.

Roughly: validate ~5-6 minutes (version consistency, lint, `npm run test:coverage`,
security audit, shrinkwrap, tarball smoke, `benchmark/ci-gate.mjs --strict`),
publish ~30 seconds (manifest signing, then the GitHub release). Do not poll with
short sleeps - workflow startup latency varies; `gh run watch` is authoritative.

Verify the deliverable:

    gh release view vX.Y.Z --repo thenewnano/qwen-mem-lite

Expect: not a draft, with `release-manifest.json` and `release-manifest.json.sig`
attached.

## 6. When it goes red

- **The tag stays where it is.** Never delete or move a pushed tag; the red run is
  part of the history.
- Read the failure: `gh run view <run-id> --log-failed`.
- Fix the cause on `main` and cut a patch release (step 1). Precedent: v7.1.0's
  workflow died at the security audit, and the fix shipped as v7.1.1 - not a
  re-tag.

## 7. Don't

- Don't bump the version in a pull request; releases are maintainer-only.
- Don't set `NPM_PUBLISH`: this fork ships GitHub releases, not npm publishes.
  The "Publish to npm" step showing `-` (skipped) in a green run is correct.