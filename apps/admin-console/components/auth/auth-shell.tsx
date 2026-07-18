import type { ReactNode } from "react";

/**
 * ADR-0008 auth layout: a single centred form card on a soft branded canvas, with the Fabric logo
 * pinned top-left. No marketing panel — the form is the whole surface. Presentational + server-safe.
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
    <main className="flex min-h-screen flex-col bg-[color-mix(in_srgb,var(--color-primary)_4%,var(--color-background))]">
      <header className="px-6 py-6 sm:px-10">
        <div className="flex items-center gap-2.5">
          <div
            className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground"
            aria-hidden="true"
          >
            F
          </div>
          <span className="font-display text-lg font-semibold">Fabric</span>
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center px-6 pb-16">
        <div className="w-full max-w-[420px] duration-200 animate-in fade-in">
          <div className="rounded-2xl border bg-card p-8 shadow-sm sm:p-10">
            <div className="flex flex-col gap-1.5">
              <h1 className="text-2xl font-semibold tracking-tight">
                {heading}
              </h1>
              <p className="text-sm text-muted-foreground">{subheading}</p>
            </div>
            <div className="mt-8">{children}</div>
          </div>
        </div>
      </div>
    </main>
  );
}
