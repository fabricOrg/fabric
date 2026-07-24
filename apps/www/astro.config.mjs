import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [
    starlight({
      title: "Fabric Docs",
      description:
        "Build reliable SMS and email workflows with Fabric's TypeScript SDK, zero-gate sandbox, and signed webhooks.",
      customCss: ["./src/styles/global.css"],
      head: [
        {
          tag: "script",
          content: `const syncFabricTheme=()=>{document.documentElement.classList.toggle("dark",document.documentElement.dataset.theme==="dark")};syncFabricTheme();new MutationObserver(syncFabricTheme).observe(document.documentElement,{attributeFilter:["data-theme"]});`,
        },
      ],
      sidebar: [
        {
          label: "Start",
          collapsed: false,
          items: [
            { label: "Get started", slug: "docs/get-started" },
            {
              label: "Sandbox & test keys",
              slug: "docs/get-started/sandbox-and-keys",
            },
            {
              label: "Authentication",
              slug: "docs/get-started/authentication",
            },
          ],
        },
        {
          label: "Quickstarts",
          collapsed: false,
          items: [
            { label: "Overview", slug: "docs/quickstarts" },
            { label: "Node.js", slug: "docs/quickstarts/working-quickstart" },
            { label: "Next.js", slug: "docs/quickstarts/nextjs" },
            { label: "CLI", slug: "docs/quickstarts/cli" },
          ],
        },
        {
          label: "Messaging",
          items: [
            { label: "Overview", slug: "docs/messaging" },
            { label: "Direct SMS", slug: "docs/messaging/sms" },
            { label: "Sender IDs", slug: "docs/messaging/sender-ids" },
            {
              label: "Delivery reports",
              slug: "docs/messaging/delivery-reports",
            },
            {
              label: "Message definitions",
              slug: "docs/messaging/message-definitions",
            },
          ],
        },
        {
          label: "Email",
          items: [
            { label: "Overview", slug: "docs/email" },
            { label: "Domains & DNS", slug: "docs/email/domains-dns" },
            { label: "Templates", slug: "docs/email/templates" },
            { label: "Deliverability", slug: "docs/email/deliverability" },
          ],
        },
        {
          label: "Webhooks",
          items: [
            { label: "Overview", slug: "docs/webhooks" },
            { label: "Events", slug: "docs/webhooks/events" },
            { label: "Signatures", slug: "docs/webhooks/signatures" },
            {
              label: "Retries & idempotency",
              slug: "docs/webhooks/retries-idempotency",
            },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Overview", slug: "docs/guides" },
            { label: "One-time verification", slug: "docs/guides/otp" },
            {
              label: "Transactional delivery",
              slug: "docs/guides/transactional",
            },
            { label: "Broadcast", slug: "docs/guides/broadcast" },
            { label: "Two-way & keywords", slug: "docs/guides/two-way" },
          ],
        },
        {
          label: "SDKs & tools",
          items: [
            { label: "Overview", slug: "docs/sdks-tools" },
            { label: "Node.js SDK", slug: "docs/sdks-tools/node" },
            { label: "CLI", slug: "docs/sdks-tools/cli" },
          ],
        },
        {
          label: "Account",
          items: [
            { label: "Account & platform", slug: "docs/account" },
            { label: "Wallet & billing", slug: "docs/account/wallet-billing" },
            { label: "Rate limits", slug: "docs/account/rate-limits" },
            { label: "Going live", slug: "docs/account/going-live" },
            { label: "Compliance", slug: "docs/account/compliance" },
          ],
        },
      ],
    }),
  ],
});
