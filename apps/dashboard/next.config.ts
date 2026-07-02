import type { NextConfig } from "next";

/**
 * Fabric customer dashboard (apps/dashboard, sms.*) — the customer-realm product surface.
 * transpilePackages: @app/ui ships raw .tsx/.ts source (shadcn components + theme), and @app/contracts
 * ships zod DTOs; Next compiles them in-app rather than expecting a prebuilt dist.
 */
const nextConfig: NextConfig = {
  transpilePackages: ["@app/ui", "@app/contracts"],
};

export default nextConfig;
