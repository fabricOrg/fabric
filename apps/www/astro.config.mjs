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
        "Build reliable SMS and email workflows with Fabric's API, TypeScript SDK, sandbox, and webhooks.",
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
            { label: "Quickstarts", slug: "docs/quickstarts" },
            {
              label: "Node.js quickstart",
              slug: "docs/quickstarts/working-quickstart",
            },
          ],
        },
        {
          label: "Build",
          collapsed: false,
          items: [
            { label: "Messaging", slug: "docs/messaging" },
            { label: "Email", slug: "docs/email" },
            { label: "Webhooks", slug: "docs/webhooks" },
          ],
        },
        {
          label: "Resources",
          items: [
            { label: "SDKs & tools", slug: "docs/sdks-tools" },
            { label: "Guides", slug: "docs/guides" },
            { label: "API reference", slug: "docs/api-reference" },
          ],
        },
        {
          label: "Platform",
          items: [{ label: "Account & wallet", slug: "docs/account" }],
        },
      ],
    }),
  ],
});
