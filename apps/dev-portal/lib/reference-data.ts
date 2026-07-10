// Static API-reference content for the dev portal (stands in for an OpenAPI-driven reference until
// the BFF serves the real spec). Code samples carry a {{TEST_KEY}} placeholder the page replaces with
// the developer's own test key (fetched fresh per session, never cached).

export type SampleLang = "curl" | "node" | "python";

export interface ApiParam {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly description: string;
}

export interface ApiEndpoint {
  readonly id: string;
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly summary: string;
  readonly params: readonly ApiParam[];
  readonly samples: Readonly<Record<SampleLang, string>>;
  readonly response: string;
}

export const REFERENCE_ENDPOINTS: readonly ApiEndpoint[] = [
  {
    id: "verify-start",
    method: "POST",
    path: "/v1/verify",
    summary:
      "Start a verification: sends a 6-digit OTP over SMS (5-min expiry, 30s resend throttle). Sandbox workspaces get debug_code back so you can complete the flow without a real phone.",
    params: [
      {
        name: "to",
        type: "string",
        required: true,
        description: "Recipient in E.164, e.g. +233545227189.",
      },
      {
        name: "sender_id",
        type: "string",
        required: false,
        description:
          "Sender id on the OTP SMS (defaults to the platform sender).",
      },
    ],
    samples: {
      curl: `curl https://api.fabric.africa/v1/verify \
  -H "Authorization: Bearer {{TEST_KEY}}" \
  -H "Content-Type: application/json" \
  -d '{"to":"+233545227189"}'`,
      node: `import Fabric from "@fabric/sdk";
const fabric = new Fabric("{{TEST_KEY}}");
const v = await fabric.verify.start({ to: "+233545227189" });
// sandbox workspaces: v.debug_code holds the OTP`,
      python: `import fabric
client = fabric.Client("{{TEST_KEY}}")
v = client.verify.start(to="+233545227189")
# sandbox workspaces: v.debug_code holds the OTP`,
    },
    response: `{
  "id": "1f0e2d3c-…",
  "status": "pending",
  "to": "+23354•••7189",
  "channel": "sms",
  "expires_in": 300,
  "debug_code": "482915"
}`,
  },
  {
    id: "verify-check",
    method: "POST",
    path: "/v1/verify/check",
    summary:
      "Check the code the user typed. 5 attempts, then the verification burns; structured errors: verification_invalid_code / _exhausted / _expired.",
    params: [
      {
        name: "id",
        type: "string",
        required: true,
        description: "The verification id from the start call.",
      },
      {
        name: "code",
        type: "string",
        required: true,
        description: "The 4-8 digit code the user entered.",
      },
    ],
    samples: {
      curl: `curl https://api.fabric.africa/v1/verify/check \
  -H "Authorization: Bearer {{TEST_KEY}}" \
  -H "Content-Type: application/json" \
  -d '{"id":"1f0e2d3c-…","code":"482915"}'`,
      node: `const result = await fabric.verify.check({ id: v.id, code: "482915" });
// result.status === "verified"`,
      python: `result = client.verify.check(id=v.id, code="482915")
# result.status == "verified"`,
    },
    response: `{
  "id": "1f0e2d3c-…",
  "status": "verified",
  "verified_at": "2026-07-10T08:00:00.000Z"
}`,
  },
  {
    id: "send-sms",
    method: "POST",
    path: "/v1/sms/send",
    summary:
      "Send an SMS to one or more E.164 recipients. Charges the wallet on accept.",
    params: [
      {
        name: "to",
        type: "string",
        required: true,
        description: "Recipient in E.164, e.g. +233201234567.",
      },
      {
        name: "from",
        type: "string",
        required: true,
        description: "A provisioned sender ID.",
      },
      {
        name: "body",
        type: "string",
        required: true,
        description: "Message text. Segments computed server-side.",
      },
    ],
    samples: {
      curl: `curl https://api.fabric.africa/v1/sms/send \\
  -H "Authorization: Bearer {{TEST_KEY}}" \\
  -H "Content-Type: application/json" \\
  -d '{"to":"+233201234567","from":"Fabric","body":"Hello"}'`,
      node: `import Fabric from "@fabric/sdk";
const fabric = new Fabric("{{TEST_KEY}}");
await fabric.sms.send({ to: "+233201234567", from: "Fabric", body: "Hello" });`,
      python: `import fabric
client = fabric.Client("{{TEST_KEY}}")
client.sms.send(to="+233201234567", **{"from": "Fabric"}, body="Hello")`,
    },
    response: `{
  "id": "msg_01H8",
  "status": "accepted",
  "segments": 1,
  "cost": { "currency": "GHS", "minor": "3" }
}`,
  },
  {
    id: "get-message",
    method: "GET",
    path: "/v1/sms/:id",
    summary:
      "Fetch a message's status + delivery timeline. Returns 404 for an unknown id.",
    params: [
      {
        name: "id",
        type: "string",
        required: true,
        description: "The message id (path).",
      },
    ],
    samples: {
      curl: `curl https://api.fabric.africa/v1/sms/msg_01H8 \\
  -H "Authorization: Bearer {{TEST_KEY}}"`,
      node: `const message = await fabric.sms.get("msg_01H8");`,
      python: `message = client.sms.get("msg_01H8")`,
    },
    response: `{
  "id": "msg_01H8",
  "status": "delivered",
  "segments": 1,
  "cost": { "currency": "GHS", "minor": "3" }
}`,
  },
  {
    id: "get-wallet",
    method: "GET",
    path: "/v1/wallet",
    summary: "Current wallet balances per currency (exact minor units).",
    params: [],
    samples: {
      curl: `curl https://api.fabric.africa/v1/wallet \\
  -H "Authorization: Bearer {{TEST_KEY}}"`,
      node: `const wallet = await fabric.wallet.get();`,
      python: `wallet = client.wallet.get()`,
    },
    response: `{
  "balances": [{ "currency": "GHS", "minor": "120403" }]
}`,
  },
];
