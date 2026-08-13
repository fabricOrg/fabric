import { Card, CardContent, CardHeader } from "@app/ui/components/ui/card";
import { ProductMark } from "@app/ui/components/ui/product-mark";
import type { ReactNode } from "react";

/**
 * Shared auth layout for Fabric apps. The form remains the main surface, with just enough brand
 * structure to make customer and staff entry points feel related.
 */
export function AuthShell({
  heading,
  subheading,
  children,
  product = "Dashboard",
}: {
  heading: string;
  subheading: string;
  children: ReactNode;
  product?: "Dashboard" | "Admin" | "Developer";
}) {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[linear-gradient(to_right,color-mix(in_srgb,var(--color-border)_44%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_srgb,var(--color-border)_44%,transparent)_1px,transparent_1px)] bg-[size:52px_52px]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,color-mix(in_srgb,var(--color-primary)_7%,var(--color-background))_0%,var(--color-background)_72%)]"
      />
      <header className="relative px-6 py-6 sm:px-10">
        <ProductMark
          product={product}
          showBadge={product !== "Dashboard"}
          className="px-0 py-0"
        />
      </header>

      <div className="relative flex flex-1 items-center justify-center px-6 pb-16">
        <Card className="w-full max-w-[420px] shadow-md duration-200 animate-in fade-in">
          <CardHeader className="gap-1.5 p-8 pb-0 sm:p-10 sm:pb-0">
            <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
            <p className="text-sm text-muted-foreground">{subheading}</p>
          </CardHeader>
          <CardContent className="p-8 pt-8 sm:p-10 sm:pt-8">
            {children}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
