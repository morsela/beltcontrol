# Instructions for AI assistants

## Commits and pull requests: Conventional Commits, always

Every commit message and every pull request title MUST follow
[Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/):

```
type(scope): description
```

- **Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`,
  `ci`, `chore`, `revert`.
- **Scope** is optional but encouraged. Use the area of the app the change lives in:
  `connection`, `session`, `drivers`, `telemetry`, `analytics`, `ui`, `history`,
  `backup`.
- **Description** in the imperative mood, lower case, no trailing period:
  `fix(connection): retry a start the belt refuses`.
- **Breaking changes:** append `!` after the type/scope and add a
  `BREAKING CHANGE:` footer explaining what broke and what to do about it.
- **PR titles use the same format as commit subjects.** PRs are squash-merged, so
  the PR title becomes the commit on `main` — it must be conventional even when
  intermediate commits on the branch are not.

The *body* of a commit or PR is where this repo's existing style lives on: explain
why the change exists and what constraint shaped it, not just what it does. The
convention governs the subject line; it does not shorten the explanation.
