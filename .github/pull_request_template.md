## Summary

<!-- What changed and why? Keep this outcome-focused. -->

## Risk

<!-- Failure modes, affected boundaries, migrations, compatibility, and rollback/mitigation. -->

## Verification

<!-- Commands, tests, screenshots, or manual scenarios executed. -->

- [ ] `pnpm verify`
- [ ] `pnpm verify:full` or not applicable

## Independent review (REQUIRED — CLAUDE.md §5)

<!-- MACHINE-CHECKED. `Pull Request Policy` fails without a `Reviewed-by:` line naming someone other
     than you. Replacing this template with a custom body does not skip it — that is exactly how the
     gate was missed before.

     Codex unavailable (quota, outage)? A SUBAGENT review is the required fallback, not a waiver.
     Say what was found, what you verified against the code, and what you changed. A clean review is
     a finding too — reviewers miss things, so record that it was clean rather than staying silent. -->

Reviewed-by:

- [ ] Reviewed by someone other than the author, and the findings were verified against the code.

## Review Checklist

- [ ] The pull-request title follows Conventional Commits.
- [ ] Tests cover changed behavior and important failure paths.
- [ ] No secrets, raw PII, or credentials are committed or logged.
- [ ] Tenant isolation, authorization, and money invariants were considered.
- [ ] Documentation and environment examples reflect the change.

### If this touches UI

- [ ] Every user-supplied value was traced to where it is consumed (a field can be policy, not taste).
- [ ] Least effort: nothing is asked that could be derived or defaulted, and no state is a dead end.
- [ ] Consistent: shared `@app/ui` primitives and existing copy voice, not a new local variant.
- [ ] Reusable: a pattern now appearing twice was extracted rather than copied.
- [ ] One state per view — exactly one of loading / error / empty, and empty keeps the same layout.
