import type { ReactNode } from "react";

/**
 * ADR-0008 split-panel auth layout (Relay/Stripe-style): a branded hero on the left, the form
 * column on the right. The hero collapses on small screens so the form always leads. Presentational
 * + server-safe; the interactive form is passed in as `children`.
 */
export function AuthShell({
  heading,
  subheading,
  children,
}: {
  heading: string;
  subheading: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen bg-background">
      {/* Brand hero — hidden below lg so the form leads on mobile. */}
      <aside className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-primary/5 p-12 lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.4] [background-image:radial-gradient(circle,var(--color-primary)_0.5px,transparent_0.5px)] [background-size:16px_16px]"
          aria-hidden="true"
        />
        <div className="relative flex items-center gap-2.5">
          <div
            className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground"
            aria-hidden="true"
          >
            F
          </div>
          <span className="font-display text-lg font-semibold">Fabric</span>
        </div>

        <div className="relative max-w-md">
          <h2 className="font-display text-3xl font-semibold leading-tight tracking-tight">
            Messaging infrastructure your team can trust.
          </h2>
          <p className="mt-4 text-sm text-muted-foreground">
            Manage applications, environments, and delivery across SMS and email
            — one workspace, built for West Africa.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            {["Double-entry wallet", "RLS tenancy", "SSO & SAML"].map(
              (chip) => (
                <span
                  key={chip}
                  className="rounded-full border bg-background/60 px-3 py-1 text-xs font-medium text-muted-foreground"
                >
                  {chip}
                </span>
              ),
            )}
          </div>
        </div>
      </aside>

      {/* Form column */}
      <section className="flex w-full flex-col items-center justify-center px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-[380px] duration-200 animate-in fade-in">
          {/* Compact logo for the mobile layout where the hero is hidden. */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div
              className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground"
              aria-hidden="true"
            >
              F
            </div>
            <span className="font-display text-lg font-semibold">Fabric</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
            <p className="text-sm text-muted-foreground">{subheading}</p>
          </div>

          <div className="mt-8">{children}</div>
        </div>
      </section>
    </main>
  );
}
