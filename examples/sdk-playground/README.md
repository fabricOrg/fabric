# Fabric SDK Playground

A hosted-ready, server-side application for exercising every capability in `@fabric-messaging/sdk`.
Users provide only a sandbox API key; the SDK selects Fabric's deployed API automatically.

## Run

```bash
cd examples/sdk-playground
npm install
npm start
```

Local execution is only for maintainers. End users open the deployed playground and paste an
`sk_test_` key into the page; they never configure `FABRIC_BASE_URL`. Sandbox SMS appears in Dashboard → Virtual phone
without contacting a carrier. Live-key mutations are blocked unless `FABRIC_ALLOW_LIVE_WRITES=true`
is deliberately set.

The playground covers SMS and Email send/retrieve/list, Verify start/check, wallet retrieval, sender-ID
create/list, webhook create/list/delete, and local webhook signature verification. Its Virtual Phone
presets exercise carrier rejection, platform failure/refund, delayed delivery, and automatic STOP.
Open Dashboard → Virtual phone to see your stable `+999…` number and reply from the handset.
