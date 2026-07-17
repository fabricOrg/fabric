const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema) => ({ "application/json": { schema } });
const response = (description, schema) => ({
  description,
  content: json(schema),
});
const errorResponses = {
  400: response("Invalid request", ref("ErrorEnvelope")),
  401: response("Invalid or missing API key", ref("ErrorEnvelope")),
  403: response("Insufficient scope", ref("ErrorEnvelope")),
  429: response("Rate limited", ref("ErrorEnvelope")),
  500: response("Platform error", ref("ErrorEnvelope")),
};

export const schemas = {
  Money: {
    type: "object",
    required: ["minor", "currency"],
    properties: {
      minor: { type: "string", pattern: "^-?\\d+$" },
      currency: { enum: ["GHS", "NGN", "USD"] },
    },
  },
  PreviewMessageRequest: {
    type: "object",
    required: ["key"],
    properties: {
      key: { type: "string" },
      data: { type: "object", additionalProperties: true },
      currency: { type: "string", minLength: 3, maxLength: 3 },
      to: { type: "string", pattern: String.raw`^\+[1-9]\d{7,14}$` },
      locale: { type: "string", pattern: "^[a-z]{2,3}(?:-[A-Z]{2})?$" },
    },
  },
  PreviewBlocker: {
    type: "object",
    required: ["path", "code"],
    properties: {
      path: { type: "string" },
      code: { type: "string" },
    },
  },
  SmsPreview: {
    type: "object",
    required: [
      "body",
      "encoding",
      "length",
      "segments",
      "cost_minor",
      "currency",
    ],
    properties: {
      body: { type: "string" },
      encoding: { enum: ["gsm7", "ucs2"] },
      length: { type: "integer" },
      segments: { type: "integer" },
      cost_minor: { type: "string", pattern: "^-?\\d+$" },
      currency: { type: "string" },
    },
  },
  PreviewMessageResponse: {
    type: "object",
    required: [
      "version_id",
      "environment",
      "resolved_locale",
      "blockers",
      "warnings",
      "eligible",
      "sender",
      "message_class",
      "preview",
      "request_id",
    ],
    properties: {
      version_id: { type: "string" },
      environment: { enum: ["sandbox", "live"] },
      resolved_locale: { type: "string" },
      blockers: { type: "array", items: ref("PreviewBlocker") },
      warnings: { type: "array", items: ref("PreviewBlocker") },
      eligible: { type: "boolean" },
      sender: {
        type: "object",
        required: ["sender_id", "status"],
        properties: {
          sender_id: { type: "string" },
          status: {
            enum: [
              "sandbox",
              "active",
              "pending",
              "rejected",
              "unregistered",
              "not_evaluated",
            ],
          },
        },
      },
      message_class: { enum: ["transactional", "promotional"] },
      preview: { oneOf: [ref("SmsPreview"), { type: "null" }] },
      request_id: { type: "string" },
    },
  },
  SendManagedMessageRequest: {
    type: "object",
    required: ["key", "to"],
    properties: {
      key: { type: "string" },
      to: { type: "string", pattern: "^\\+[1-9]\\d{7,14}$" },
      data: { type: "object", additionalProperties: true },
      locale: { type: "string", pattern: "^[a-z]{2,3}(?:-[A-Z]{2})?$" },
      channel: { enum: ["sms"] },
      currency: { type: "string", minLength: 3, maxLength: 3 },
      reference: { type: "string", maxLength: 100 },
      metadata: {
        type: "object",
        additionalProperties: {
          oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
        },
      },
      limits: {
        type: "object",
        required: ["max_cost"],
        properties: {
          max_cost: {
            type: "object",
            required: ["minor", "currency"],
            properties: {
              minor: { type: "string", pattern: "^\\d+$" },
              currency: { type: "string", minLength: 3, maxLength: 3 },
            },
          },
        },
      },
    },
  },
  MessageDeliveryAttempt: {
    type: "object",
    required: [
      "id",
      "ordinal",
      "channel",
      "message_id",
      "status",
      "cost",
      "error_code",
      "created_at",
      "updated_at",
    ],
    properties: {
      id: { type: "string", format: "uuid" },
      ordinal: { type: "integer", minimum: 1 },
      channel: { enum: ["sms"] },
      message_id: {
        oneOf: [{ type: "string", format: "uuid" }, { type: "null" }],
      },
      status: ref("MessageDeliveryStatus"),
      cost: ref("Money"),
      error_code: { oneOf: [{ type: "string" }, { type: "null" }] },
      created_at: { type: "string", format: "date-time" },
      updated_at: { type: "string", format: "date-time" },
    },
  },
  MessageDeliveryStatus: {
    enum: [
      "accepted",
      "processing",
      "sent",
      "delivered",
      "undelivered",
      "failed",
      "expired",
    ],
  },
  MessageDelivery: {
    type: "object",
    required: [
      "id",
      "key",
      "version_id",
      "environment",
      "locale",
      "channel",
      "status",
      "resource_version",
      "recipient",
      "reference",
      "metadata",
      "cost",
      "attempts",
      "created_at",
      "updated_at",
    ],
    properties: {
      id: { type: "string", format: "uuid" },
      key: { type: "string" },
      version_id: { type: "string", format: "uuid" },
      environment: { enum: ["sandbox", "live"] },
      locale: { type: "string" },
      channel: { enum: ["sms"] },
      status: ref("MessageDeliveryStatus"),
      resource_version: { type: "integer", minimum: 1 },
      recipient: { type: "string" },
      reference: { oneOf: [{ type: "string" }, { type: "null" }] },
      metadata: {
        type: "object",
        additionalProperties: {
          oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
        },
      },
      cost: ref("Money"),
      attempts: { type: "array", items: ref("MessageDeliveryAttempt") },
      created_at: { type: "string", format: "date-time" },
      updated_at: { type: "string", format: "date-time" },
    },
  },
  ManagedMessageResponse: {
    type: "object",
    required: ["delivery", "request_id"],
    properties: {
      delivery: ref("MessageDelivery"),
      request_id: { type: "string" },
    },
  },
  MessageDeliverySummary: {
    type: "object",
    required: [
      "id",
      "key",
      "version_id",
      "environment",
      "locale",
      "channel",
      "status",
      "resource_version",
      "reference",
      "metadata",
      "cost",
      "created_at",
      "updated_at",
    ],
    properties: {
      id: { type: "string", format: "uuid" },
      key: { type: "string" },
      version_id: { type: "string", format: "uuid" },
      environment: { enum: ["sandbox", "live"] },
      locale: { type: "string" },
      channel: { enum: ["sms"] },
      status: ref("MessageDeliveryStatus"),
      resource_version: { type: "integer", minimum: 1 },
      reference: { oneOf: [{ type: "string" }, { type: "null" }] },
      metadata: {
        type: "object",
        additionalProperties: {
          oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
        },
      },
      cost: ref("Money"),
      created_at: { type: "string", format: "date-time" },
      updated_at: { type: "string", format: "date-time" },
    },
  },
  ListMessageDeliveriesResponse: {
    type: "object",
    required: ["deliveries", "request_id"],
    properties: {
      deliveries: { type: "array", items: ref("MessageDeliverySummary") },
      request_id: { type: "string" },
    },
  },
  DefinitionCatalogManifest: {
    type: "object",
    additionalProperties: false,
    required: [
      "manifest_version",
      "minimum_sdk_contract_version",
      "minimum_cli_contract_version",
      "application",
      "environment",
      "compatibility_digest",
      "definitions",
    ],
    properties: {
      manifest_version: { type: "integer", enum: [1] },
      minimum_sdk_contract_version: { type: "integer", minimum: 1 },
      minimum_cli_contract_version: { type: "integer", minimum: 1 },
      application: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      },
      environment: {
        type: "object",
        required: ["id", "type"],
        properties: {
          id: { type: "string", format: "uuid" },
          type: { enum: ["sandbox", "live"] },
        },
      },
      compatibility_digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
      definitions: {
        type: "array",
        items: {
          type: "object",
          required: [
            "key",
            "version",
            "channels",
            "default_locale",
            "locales",
            "data_schema",
          ],
          properties: {
            key: { type: "string" },
            version: { type: "integer", minimum: 1 },
            channels: {
              type: "array",
              items: { enum: ["sms"] },
              minItems: 1,
              maxItems: 1,
            },
            default_locale: { type: "string" },
            locales: { type: "array", items: { type: "string" } },
            data_schema: { type: "object", additionalProperties: true },
          },
        },
      },
    },
  },
  MessageStatus: {
    enum: [
      "queued",
      "sending",
      "accepted",
      "sent",
      "delivered",
      "undelivered",
      "failed",
      "expired",
    ],
  },
  SendSmsRequest: {
    type: "object",
    additionalProperties: false,
    required: ["to", "sender_id", "body", "currency"],
    properties: {
      to: { type: "string", pattern: "^\\+[1-9]\\d{7,14}$" },
      sender_id: { type: "string", minLength: 1, maxLength: 11 },
      body: { type: "string", minLength: 1 },
      currency: { enum: ["GHS", "NGN", "USD"] },
      class: {
        enum: ["transactional", "promotional"],
        default: "transactional",
      },
    },
  },
  SendSmsResponse: {
    type: "object",
    required: ["id", "status", "encoding", "segments", "cost", "request_id"],
    properties: {
      id: { type: "string" },
      status: ref("MessageStatus"),
      encoding: { enum: ["gsm7", "ucs2"] },
      segments: { type: "integer", minimum: 1 },
      cost: ref("Money"),
      request_id: { type: "string" },
    },
  },
  SendSmsBatchRequest: {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["client_reference", "to", "sender_id", "body"],
          properties: {
            client_reference: {
              type: "string",
              minLength: 1,
              maxLength: 100,
            },
            to: { type: "string", pattern: "^\\+[1-9]\\d{7,14}$" },
            sender_id: { type: "string", minLength: 1, maxLength: 11 },
            body: { type: "string", minLength: 1 },
            currency: {
              enum: ["GHS", "NGN", "USD"],
              default: "GHS",
            },
            class: {
              enum: ["transactional", "promotional"],
              default: "transactional",
            },
          },
        },
      },
    },
  },
  SmsBatch: {
    type: "object",
    required: [
      "id",
      "status",
      "total_count",
      "accepted_count",
      "failed_count",
      "items",
      "request_id",
    ],
    properties: {
      id: { type: "string", format: "uuid" },
      status: { enum: ["processing", "completed"] },
      total_count: { type: "integer", minimum: 1 },
      accepted_count: { type: "integer", minimum: 0 },
      failed_count: { type: "integer", minimum: 0 },
      items: {
        type: "array",
        items: {
          type: "object",
          required: ["client_reference", "message_id", "status", "error_code"],
          properties: {
            client_reference: { type: "string" },
            message_id: { type: ["string", "null"], format: "uuid" },
            status: ref("MessageStatus"),
            error_code: { type: ["string", "null"] },
          },
        },
      },
      request_id: { type: "string" },
    },
  },
  SendEmailRequest: {
    type: "object",
    additionalProperties: false,
    required: ["to", "from", "subject"],
    anyOf: [{ required: ["text"] }, { required: ["html"] }],
    properties: {
      to: { type: "string", format: "email", maxLength: 320 },
      from: { type: "string", format: "email", maxLength: 320 },
      subject: { type: "string", minLength: 1, maxLength: 998 },
      text: { type: "string", minLength: 1, maxLength: 1000000 },
      html: { type: "string", minLength: 1, maxLength: 2000000 },
      reply_to: { type: "string", format: "email", maxLength: 320 },
    },
  },
  SendEmailResponse: {
    type: "object",
    required: ["id", "status", "request_id"],
    properties: {
      id: { type: "string", format: "uuid" },
      status: ref("MessageStatus"),
      request_id: { type: "string" },
    },
  },
  EmailMessage: {
    type: "object",
    required: [
      "id",
      "status",
      "to",
      "from",
      "subject",
      "provider",
      "created_at",
      "error_code",
    ],
    properties: {
      id: { type: "string", format: "uuid" },
      status: ref("MessageStatus"),
      to: { type: "string" },
      from: { type: "string" },
      subject: { type: "string" },
      provider: { type: "string" },
      created_at: { type: "string", format: "date-time" },
      error_code: { type: ["string", "null"] },
    },
  },
  MessageSummary: {
    type: "object",
    required: [
      "id",
      "to",
      "status",
      "encoding",
      "segments",
      "cost",
      "provider",
      "createdAt",
    ],
    properties: {
      id: { type: "string" },
      to: { type: "string", description: "Masked recipient" },
      status: ref("MessageStatus"),
      encoding: { enum: ["gsm7", "ucs2"] },
      segments: { type: "integer", minimum: 1 },
      cost: ref("Money"),
      provider: { type: "string" },
      deliveryMode: { enum: ["live", "virtual"], default: "live" },
      createdAt: { type: "string", format: "date-time" },
    },
  },
  MessageDetail: {
    allOf: [
      ref("MessageSummary"),
      {
        type: "object",
        required: ["senderId", "redacted", "timeline"],
        properties: {
          senderId: { type: "string" },
          body: { type: "string" },
          redacted: { type: "boolean" },
          timeline: {
            type: "array",
            items: {
              type: "object",
              required: ["status", "at"],
              properties: {
                status: ref("MessageStatus"),
                at: { type: "string", format: "date-time" },
                note: { type: "string" },
              },
            },
          },
          failureReason: { type: "string" },
          requestId: { type: "string" },
        },
      },
    ],
  },
  VerifyStartRequest: {
    type: "object",
    additionalProperties: false,
    required: ["to"],
    properties: {
      to: { type: "string", pattern: "^\\+[1-9]\\d{7,14}$" },
      sender_id: { type: "string", minLength: 1, maxLength: 11 },
    },
  },
  VerifyStartResponse: {
    type: "object",
    required: ["id", "status", "to", "channel", "expires_in"],
    properties: {
      id: { type: "string", format: "uuid" },
      status: { enum: ["pending", "verified", "failed", "expired"] },
      to: { type: "string" },
      channel: { const: "sms" },
      expires_in: { type: "integer", minimum: 1 },
      debug_code: { type: "string", description: "Sandbox only" },
    },
  },
  VerifyCheckRequest: {
    type: "object",
    additionalProperties: false,
    required: ["id", "code"],
    properties: {
      id: { type: "string", format: "uuid" },
      code: { type: "string", pattern: "^\\d{4,8}$" },
    },
  },
  VerifyCheckResponse: {
    type: "object",
    required: ["id", "status", "verified_at"],
    properties: {
      id: { type: "string", format: "uuid" },
      status: { enum: ["pending", "verified", "failed", "expired"] },
      verified_at: { type: ["string", "null"], format: "date-time" },
    },
  },
  Sender: {
    type: "object",
    required: [
      "id",
      "sender_id",
      "country",
      "type",
      "use_case",
      "status",
      "rejection_reason",
      "created_at",
    ],
    properties: {
      id: { type: "string", format: "uuid" },
      sender_id: { type: "string" },
      country: { enum: ["GH", "NG"] },
      type: { enum: ["alphanumeric", "short-code"] },
      use_case: { type: "string" },
      status: { enum: ["pending", "active", "rejected"] },
      rejection_reason: { type: ["string", "null"] },
      created_at: { type: "string", format: "date-time" },
    },
  },
  CreateSenderRequest: {
    type: "object",
    additionalProperties: false,
    required: ["sender_id", "country", "use_case"],
    properties: {
      sender_id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9 ]{0,10}$" },
      country: { enum: ["GH", "NG"] },
      type: { enum: ["alphanumeric", "short-code"], default: "alphanumeric" },
      use_case: { type: "string", minLength: 10, maxLength: 500 },
    },
  },
  WebhookEndpoint: {
    type: "object",
    required: [
      "id",
      "url",
      "status",
      "description",
      "env",
      "secret_prefix",
      "created_at",
      "health",
    ],
    properties: {
      id: { type: "string", format: "uuid" },
      url: { type: "string", format: "uri" },
      status: { enum: ["active", "disabled"] },
      description: { type: ["string", "null"] },
      env: { enum: ["sandbox", "live"] },
      secret_prefix: { type: "string" },
      created_at: { type: "string", format: "date-time" },
      health: {
        type: "object",
        required: ["pending", "dead", "last_delivered_at"],
        properties: {
          pending: { type: "integer", minimum: 0 },
          dead: { type: "integer", minimum: 0 },
          last_delivered_at: { type: ["string", "null"], format: "date-time" },
        },
      },
    },
  },
  CreateWebhookRequest: {
    type: "object",
    additionalProperties: false,
    required: ["url"],
    properties: {
      url: { type: "string", format: "uri" },
      description: { type: "string", maxLength: 200 },
      application_id: { type: "string", format: "uuid" },
      env: { enum: ["sandbox", "live"] },
    },
  },
  WebhookDelivery: {
    type: "object",
    required: [
      "id",
      "endpoint_id",
      "event_id",
      "event_type",
      "state",
      "attempts",
      "next_attempt_at",
      "last_attempt_at",
      "delivered_at",
      "last_error_category",
      "last_http_status",
      "created_at",
    ],
    properties: {
      id: { type: "string", format: "uuid" },
      endpoint_id: { type: "string", format: "uuid" },
      event_id: { type: "string", format: "uuid" },
      event_type: { type: "string" },
      state: { enum: ["pending", "delivering", "delivered", "dead"] },
      attempts: { type: "integer", minimum: 0 },
      next_attempt_at: { type: "string", format: "date-time" },
      last_attempt_at: { type: ["string", "null"], format: "date-time" },
      delivered_at: { type: ["string", "null"], format: "date-time" },
      last_error_category: { type: ["string", "null"] },
      last_http_status: { type: ["integer", "null"] },
      created_at: { type: "string", format: "date-time" },
    },
  },
  ErrorEnvelope: {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["type", "code", "message"],
        properties: {
          type: {
            enum: [
              "api_error",
              "auth_error",
              "invalid_request_error",
              "not_found_error",
              "idempotency_error",
              "rate_limit_error",
              "insufficient_funds_error",
            ],
          },
          code: { type: "string" },
          message: { type: "string" },
          param: { type: "string" },
          doc_url: { type: "string", format: "uri" },
        },
      },
      request_id: { type: "string" },
    },
  },
};

const operation = (operationId, summary, success, requestSchema) => ({
  operationId,
  summary,
  ...(requestSchema
    ? { requestBody: { required: true, content: json(requestSchema) } }
    : {}),
  responses: { ...success, ...errorResponses },
});
const idParameter = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string" },
};

export const paths = {
  "/v1/sms/messages": {
    post: operation(
      "sendSms",
      "Send an SMS",
      {
        201: response("Accepted", ref("SendSmsResponse")),
        409: response("Idempotency conflict", ref("ErrorEnvelope")),
      },
      ref("SendSmsRequest"),
    ),
  },
  "/v1/sms/send": {
    post: {
      ...operation(
        "sendSmsLegacy",
        "Send an SMS (deprecated compatibility alias)",
        {
          201: response("Accepted", ref("SendSmsResponse")),
          409: response("Idempotency conflict", ref("ErrorEnvelope")),
        },
        ref("SendSmsRequest"),
      ),
      deprecated: true,
    },
  },
  "/v1/messages": {
    get: operation("listMessages", "List recent messages", {
      200: response("Messages", {
        type: "object",
        required: ["messages", "request_id"],
        properties: {
          messages: { type: "array", items: ref("MessageSummary") },
          request_id: { type: "string" },
        },
      }),
    }),
  },
  "/v1/messages/preview": {
    post: operation(
      "previewMessage",
      "Preview a released message definition (no side effects)",
      { 200: response("Preview", ref("PreviewMessageResponse")) },
      ref("PreviewMessageRequest"),
    ),
  },
  "/v1/message-deliveries": {
    get: operation(
      "listManagedMessages",
      "List recent managed deliveries for the key's environment (summaries, no recipient)",
      {
        200: response(
          "Managed deliveries",
          ref("ListMessageDeliveriesResponse"),
        ),
      },
    ),
    post: {
      ...operation(
        "sendManagedMessage",
        "Send a released message definition by stable key (idempotent)",
        {
          202: response("Delivery accepted", ref("ManagedMessageResponse")),
          409: response("Idempotency conflict", ref("ErrorEnvelope")),
        },
        ref("SendManagedMessageRequest"),
      ),
      parameters: [
        {
          name: "Idempotency-Key",
          in: "header",
          required: true,
          schema: { type: "string", minLength: 1, maxLength: 255 },
          description:
            "Required. A replay with the same key returns the same delivery; a different payload under the same key is rejected.",
        },
      ],
    },
  },
  "/v1/message-deliveries/{id}": {
    get: {
      ...operation("retrieveManagedMessage", "Retrieve a managed delivery", {
        200: response("Managed delivery", ref("ManagedMessageResponse")),
        404: response("Not found", ref("ErrorEnvelope")),
      }),
      parameters: [idParameter],
    },
  },
  "/v1/definitions/catalog": {
    get: operation(
      "readDefinitionCatalog",
      "Read the released definition contract for this API key environment",
      { 200: response("Definition catalog", ref("DefinitionCatalogManifest")) },
    ),
  },
  "/v1/sms/batches": {
    post: operation(
      "sendSmsBatch",
      "Send an SMS batch",
      {
        201: response("Batch completed", ref("SmsBatch")),
        409: response("Idempotency conflict", ref("ErrorEnvelope")),
      },
      ref("SendSmsBatchRequest"),
    ),
  },
  "/v1/sms/batches/{id}": {
    get: {
      ...operation("retrieveSmsBatch", "Retrieve an SMS batch", {
        200: response("SMS batch", ref("SmsBatch")),
        404: response("Not found", ref("ErrorEnvelope")),
      }),
      parameters: [idParameter],
    },
  },
  "/v1/email/messages": {
    post: operation(
      "sendEmail",
      "Send an Email",
      {
        201: response("Accepted", ref("SendEmailResponse")),
        409: response("Idempotency conflict", ref("ErrorEnvelope")),
      },
      ref("SendEmailRequest"),
    ),
    get: operation("listEmailMessages", "List Email messages", {
      200: response("Email messages", {
        type: "object",
        required: ["messages", "request_id"],
        properties: {
          messages: { type: "array", items: ref("EmailMessage") },
          request_id: { type: "string" },
        },
      }),
    }),
  },
  "/v1/email/messages/{id}": {
    get: {
      ...operation("retrieveEmail", "Retrieve an Email message", {
        200: response("Email message", {
          type: "object",
          required: ["message", "request_id"],
          properties: {
            message: ref("EmailMessage"),
            request_id: { type: "string" },
          },
        }),
        404: response("Not found", ref("ErrorEnvelope")),
      }),
      parameters: [idParameter],
    },
  },
  "/v1/sms/{id}": {
    get: {
      ...operation("retrieveSms", "Retrieve message status", {
        200: response("Message", {
          type: "object",
          required: ["message", "request_id"],
          properties: {
            message: ref("MessageDetail"),
            request_id: { type: "string" },
          },
        }),
        404: response("Not found", ref("ErrorEnvelope")),
      }),
      parameters: [idParameter],
    },
  },
  "/v1/verify": {
    post: operation(
      "startVerification",
      "Start an SMS verification",
      { 201: response("Verification started", ref("VerifyStartResponse")) },
      ref("VerifyStartRequest"),
    ),
  },
  "/v1/verify/check": {
    post: operation(
      "checkVerification",
      "Check a verification code",
      { 201: response("Verification checked", ref("VerifyCheckResponse")) },
      ref("VerifyCheckRequest"),
    ),
  },
  "/v1/wallet": {
    get: operation("retrieveWallet", "Retrieve wallet balances and ledger", {
      200: response("Wallet snapshot", {
        type: "object",
        required: ["balances", "ledger", "request_id"],
        properties: {
          balances: {
            type: "array",
            items: {
              type: "object",
              required: ["balance"],
              properties: {
                balance: ref("Money"),
                lowBalanceThreshold: ref("Money"),
              },
            },
          },
          ledger: { type: "array", items: { type: "object" } },
          request_id: { type: "string" },
        },
      }),
    }),
  },
  "/v1/senders": {
    get: operation("listSenderIds", "List sender IDs", {
      200: response("Sender IDs", {
        type: "object",
        required: ["senders"],
        properties: { senders: { type: "array", items: ref("Sender") } },
      }),
    }),
    post: operation(
      "createSenderId",
      "Register a sender ID",
      { 201: response("Sender ID submitted", ref("Sender")) },
      ref("CreateSenderRequest"),
    ),
  },
  "/v1/webhooks": {
    get: operation("listWebhookEndpoints", "List webhook endpoints", {
      200: response("Webhook endpoints", {
        type: "object",
        required: ["endpoints", "request_id"],
        properties: {
          endpoints: { type: "array", items: ref("WebhookEndpoint") },
          request_id: { type: "string" },
        },
      }),
    }),
    post: operation(
      "createWebhookEndpoint",
      "Create a webhook endpoint",
      {
        201: response("Endpoint and once-only secret", {
          allOf: [
            ref("WebhookEndpoint"),
            {
              type: "object",
              required: ["secret"],
              properties: { secret: { type: "string" } },
            },
          ],
        }),
      },
      ref("CreateWebhookRequest"),
    ),
  },
  "/v1/webhooks/{id}": {
    delete: {
      ...operation("disableWebhookEndpoint", "Disable a webhook endpoint", {
        204: { description: "Disabled; delivery history retained" },
      }),
      parameters: [idParameter],
    },
  },
  "/v1/webhooks/{id}/deliveries": {
    get: {
      ...operation("listWebhookDeliveries", "List endpoint deliveries", {
        200: response("Webhook deliveries", {
          type: "object",
          required: ["deliveries", "request_id"],
          properties: {
            deliveries: { type: "array", items: ref("WebhookDelivery") },
            request_id: { type: "string" },
          },
        }),
      }),
      parameters: [
        idParameter,
        {
          name: "state",
          in: "query",
          schema: { enum: ["pending", "delivering", "delivered", "dead"] },
        },
      ],
    },
  },
  "/v1/webhooks/{id}/deliveries/{deliveryId}/replay": {
    post: {
      ...operation("replayWebhookDelivery", "Replay a dead delivery", {
        200: response("Delivery queued for replay", {
          type: "object",
          required: ["delivery", "request_id"],
          properties: {
            delivery: ref("WebhookDelivery"),
            request_id: { type: "string" },
          },
        }),
      }),
      parameters: [
        idParameter,
        {
          name: "deliveryId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
    },
  },
};
