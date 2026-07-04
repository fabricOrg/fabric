import { resolve } from "node:path";
import type { NextConfig } from "next";

/**
 * Fabric customer dashboard (apps/dashboard, sms.*) — the customer-realm product surface.
 * transpilePackages: only @app/ui, which ships raw .tsx/.ts source (shadcn components + theme) with
 * NO NodeNext `.js` import specifiers, so Turbopack transpiles it in-app. @app/contracts and
 * @app/domain use NodeNext `.js` specifiers (they're runtime-consumed by node services), which
 * Turbopack (moduleResolution: bundler) can't map .js→.ts — so they ship a real built `dist` via
 * their `default` export condition and are resolved as normal prebuilt packages, NOT transpiled here.
 */
const nextConfig: NextConfig = {
  devIndicators: false,
  output: "standalone",
  outputFileTracingRoot: resolve(import.meta.dirname, "../.."),
  transpilePackages: ["@app/ui"],
};

export default nextConfig;
