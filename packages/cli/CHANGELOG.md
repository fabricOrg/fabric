# Changelog

## 0.1.0-beta.6

- Version-aligned with `@fabric-messaging/sdk` — the CLI's generated catalog imports
  `DefinitionCatalog` from the SDK, so the two halves of the typed-catalog story now move
  together. Going forward the CLI adopts the SDK's version on every SDK release, even when the
  CLI itself is unchanged.
- No functional changes since `0.1.0-beta.1`.

## 0.1.0-beta.1

- First release: `fabric definitions generate` (typed catalog from the definitions manifest) and
  `fabric definitions check` (compatibility-digest drift guard).
