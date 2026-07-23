import type { DefinitionCatalog } from "./catalog.js";
import type { Fabric } from "./client.js";

interface CheckoutCatalog extends DefinitionCatalog {
  readonly generated: true;
  readonly environment: "sandbox";
  readonly messages: {
    readonly "order.shipped": {
      readonly data: { readonly name: string; readonly count?: number };
      readonly channels: "sms";
      readonly locales: "en" | "fr";
    };
    readonly "receipt.emailed": {
      readonly data: { readonly name: string };
      readonly channels: "email";
      readonly locales: "en";
    };
  };
}

declare const fabric: Fabric<CheckoutCatalog>;

export function compileCatalogTypes() {
  void fabric.messages.preview("order.shipped", {
    data: { name: "Ada", count: 2 },
    locale: "fr",
  });
  // @ts-expect-error Generated catalogs reject unknown stable keys.
  void fabric.messages.preview("order.cancelled", { data: { name: "Ada" } });
  // @ts-expect-error The required name variable cannot be omitted.
  void fabric.messages.preview("order.shipped", { data: {} });
  void fabric.messages.preview("order.shipped", {
    data: {
      name: "Ada",
      // @ts-expect-error Inline extra variables are rejected.
      secret: true,
    },
  });
  void fabric.messages.preview("order.shipped", {
    data: { name: "Ada" },
    // @ts-expect-error Locales are constrained by the released definition.
    locale: "es",
  });

  // Channel narrowing (SDK-004-AC02 / SDK-007 AC04): each key permits only its released channel.
  void fabric.messages.preview("order.shipped", {
    data: { name: "Ada" },
    channel: "sms",
  });
  void fabric.messages.preview("order.shipped", {
    data: { name: "Ada" },
    // @ts-expect-error order.shipped is an SMS key — email is not a supported channel.
    channel: "email",
  });
  void fabric.messages.send("receipt.emailed", {
    to: "ada@example.com",
    data: { name: "Ada" },
    idempotencyKey: "r-1",
    channel: "email",
  });
  void fabric.messages.send("receipt.emailed", {
    to: "ada@example.com",
    data: { name: "Ada" },
    idempotencyKey: "r-2",
    // @ts-expect-error receipt.emailed is an Email key — sms is not a supported channel.
    channel: "sms",
  });
}
