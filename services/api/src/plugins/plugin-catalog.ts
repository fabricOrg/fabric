import type { NewPluginInstance } from "@app/db";

/**
 * The PLATFORM PROVIDER CATALOG — the rows every environment starts with, seeded idempotently on
 * first list. Split from the registry service for the file-length guard.
 *
 * All catalog entries are SANDBOX. A live instance is never seeded: it is created deliberately
 * (`createLiveInstance`), given its own credentials, and activated explicitly — because a seeded
 * live row would be a provider nobody chose to put on a real carrier.
 */
export const CATALOG: NewPluginInstance[] = [
  {
    capability: "sms",
    vendor: "fakeprovider",
    label: "FakeProvider",
    enabled: true,
    isDefault: true,
    mode: "sandbox",
    status: "connected",
    priority: 0,
  },
  {
    capability: "sms",
    vendor: "arkesel",
    label: "Arkesel",
    enabled: false,
    isDefault: false,
    mode: "sandbox",
    status: "available",
    priority: 100,
  },
  {
    capability: "sms",
    vendor: "africas-talking",
    label: "Africa's Talking",
    enabled: false,
    isDefault: false,
    mode: "sandbox",
    status: "available",
    priority: 100,
  },
  {
    capability: "sms",
    vendor: "hubtel",
    label: "Hubtel",
    enabled: false,
    isDefault: false,
    mode: "sandbox",
    status: "available",
    priority: 100,
  },
  {
    capability: "whatsapp",
    vendor: "meta-cloud",
    label: "WhatsApp Business Cloud",
    enabled: false,
    isDefault: false,
    mode: "sandbox",
    status: "available",
    priority: 100,
  },
  {
    capability: "payment",
    vendor: "paystack",
    label: "Paystack",
    enabled: false,
    isDefault: false,
    mode: "sandbox",
    status: "available",
    priority: 0,
  },
  {
    capability: "payment",
    vendor: "flutterwave",
    label: "Flutterwave",
    enabled: false,
    isDefault: false,
    mode: "sandbox",
    status: "available",
    priority: 100,
  },
  {
    capability: "identity",
    vendor: "workos",
    label: "WorkOS AuthKit",
    enabled: true,
    isDefault: true,
    mode: "sandbox",
    status: "connected",
    priority: 0,
  },
];
