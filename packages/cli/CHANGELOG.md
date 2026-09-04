# Changelog

## 0.1.0-beta.8

- Manifest contract version 2. `channels` accepts `whatsapp`, which the platform has sent since the
  channel went live, and definition keys are parsed with the SAME rule the API enforces
  (`packages/contracts`): dot-separated lowercase segments with hyphens, at most eight of them, and
  no reserved `fabric.` prefix. The previous local regex accepted underscores the API rejects, so a
  manifest could pass `fabric definitions generate` and then fail on publish.
- Version-aligned with `@fabric-messaging/sdk@0.1.0-beta.8` per the policy below. There is no CLI
  `0.1.0-beta.7`: that release carried SDK changes only.

## 0.1.0-beta.6

- Version-aligned with `@fabric-messaging/sdk` — the CLI's generated catalog imports
  `DefinitionCatalog` from the SDK, so the two halves of the typed-catalog story now move
  together. Going forward the CLI adopts the SDK's version on every SDK release, even when the
  CLI itself is unchanged.
- No functional changes since `0.1.0-beta.1`.

## 0.1.0-beta.1

- First release: `fabric definitions generate` (typed catalog from the definitions manifest) and
  `fabric definitions check` (compatibility-digest drift guard).
