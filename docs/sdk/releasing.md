# Versioning and release process

The TypeScript SDK supports Node.js 22+ and modern ESM. It follows semantic versioning:

- patch: compatible bug fixes and documentation corrections;
- minor: backward-compatible resources, methods, options, error subclasses, and fields;
- major: removed/renamed public symbols, changed defaults with behavioral impact, or incompatible types.

Deprecations receive a TypeScript `@deprecated` annotation and migration guidance for at least one
minor release before removal in a future major. API v1 additive response fields are compatible;
removed/renamed fields or changed meaning require an API/SDK migration plan.

## Prerelease gate

Run the reproducible local gate first:

```bash
pnpm --filter fabric-messaging release:check
```

1. Run SDK typecheck, tests, build, example compilation, and `pnpm pack --dry-run`.
2. Inspect the tarball file list and exported declarations; no internal modules or secrets may leak.
3. Install the tarball into a clean ESM project. The gate performs this from a temporary directory.
4. Run contract tests against the API schema and sandbox smoke tests with `sk_test_` only.
5. Confirm the README quickstart verbatim and capture its request/message IDs.
6. Security-review webhook verification and write retry semantics.
7. Generate release notes and changelog from Conventional Commits.
8. Publish a beta with npm provenance, validate it, then promote the same artifact to stable.

Registry publication, tags, and external sandbox calls require explicit release authorization. CI
should use OIDC trusted publishing; it must not store a long-lived npm token.
