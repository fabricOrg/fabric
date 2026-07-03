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
