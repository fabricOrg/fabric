# Fabric SDK Playground

A local, server-side application for exercising every capability in `@fabric-messaging/sdk`.
The API key stays in the Node process and is never sent to browser JavaScript.

## Run

```bash
cd examples/sdk-playground
npm install
copy .env.example .env
# Put a sandbox key in .env, then:
npm start
```

Open `http://localhost:3400`. Use an `sk_test_` key so SMS appears in Dashboard → Virtual phone
without contacting a carrier. Live-key mutations are blocked unless `FABRIC_ALLOW_LIVE_WRITES=true`
is deliberately set.

The playground covers SMS send/retrieve/list, Verify start/check, wallet retrieval, sender-ID
create/list, webhook create/list/delete, and local webhook signature verification. Its Virtual Phone
presets exercise carrier rejection, platform failure/refund, delayed delivery, and automatic STOP.
Open Dashboard → Virtual phone to see your stable `+999…` number and reply from the handset.
