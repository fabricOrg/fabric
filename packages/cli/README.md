# Fabric CLI

Generate a type-safe managed-message catalog for one application environment:

```sh
FABRIC_API_KEY=sk_test_... pnpm dlx @fabric-messaging/cli definitions generate
```

Commit `fabric.generated.ts`, then detect contract drift in CI:

```sh
FABRIC_API_KEY=sk_test_... pnpm dlx @fabric-messaging/cli definitions check
```

Use a least-privilege key with only `definitions:read`. The CLI never writes the key, message
content, sender/provider identifiers, or recipient data to generated output.
