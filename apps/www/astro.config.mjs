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
      customCss: ["./src/styles/global.css"],
      head: [
        {
          tag: "script",
          content: `const syncFabricTheme=()=>{document.documentElement.classList.toggle("dark",document.documentElement.dataset.theme==="dark")};syncFabricTheme();new MutationObserver(syncFabricTheme).observe(document.documentElement,{attributeFilter:["data-theme"]});`,
        },
      ],
      sidebar: [
        {
          label: "Get started",
          items: [{ slug: "docs/get-started" }],
        },
        {
          label: "Quickstarts",
          items: [
            { slug: "docs/quickstarts" },
            { slug: "docs/quickstarts/working-quickstart" },
          ],
        },
        {
          label: "Messaging",
          items: [{ slug: "docs/messaging" }],
        },
        {
          label: "Email",
          items: [{ slug: "docs/email" }],
        },
        {
          label: "Webhooks",
          items: [{ slug: "docs/webhooks" }],
        },
        {
          label: "SDKs & tools",
          items: [{ slug: "docs/sdks-tools" }],
        },
        {
          label: "Guides",
          items: [{ slug: "docs/guides" }],
        },
        {
          label: "API reference",
          items: [{ slug: "docs/api-reference" }],
        },
        {
          label: "Account",
          items: [{ slug: "docs/account" }],
        },
      ],
    }),
  ],
});
