import { cn } from "@app/ui/lib/utils";
import type { ComponentProps, ElementType, ReactNode } from "react";

/**
 * Blueprint frame — the "technical drawing" surface treatment: a hairline box with registration
 * marks at each corner, drawn OUTSIDE the border so the box reads as a drafted object rather than a
 * rounded UI card. Pairs with the app-wide squared-corner system (`--radius: 0`).
 *
 * This module owns the treatment so a screen never hand-rolls it. The marks and the ruled fill are
 * real CSS in `theme.css` (`.blueprint`, `.bp-corner`, `.bp-ruled`) because each mark is a pair of
 * ::before/::after hairlines that utilities cannot express.
 *
 * Grids of these need a wider gap than usual: the marks sit 6px outside each border, so adjacent
 * frames collide at the default spacing.
 */

/**
 * The four registration marks alone. Use inside anything that already carries the `blueprint` class
 * and its own border — a `<button>`, say, which cannot be wrapped without losing its semantics.
 */
export function BlueprintCorners({ className }: { className?: string }) {
  return (
    <>
      {(["tl", "tr", "bl", "br"] as const).map((corner) => (
        <i
          key={corner}
          aria-hidden="true"
          className={cn("bp-corner", corner, className)}
        />
      ))}
    </>
  );
}

/**
 * A framed surface. Renders a `div` by default; pass `as` for the right semantics — `as="article"`
 * for a card in a list, `as="section"` for a labelled region.
 */
export function Blueprint<T extends ElementType = "div">({
  as,
  className,
  cornerClassName,
  children,
  ...props
}: {
  as?: T;
  className?: string;
  /** Tint for the marks — e.g. a light colour when the frame sits on a filled button. */
  cornerClassName?: string;
  children?: ReactNode;
} & Omit<ComponentProps<T>, "as" | "className" | "children">) {
  const Comp = (as ?? "div") as ElementType;
  return (
    <Comp
      className={cn("blueprint relative border bg-card", className)}
      {...props}
    >
      <BlueprintCorners className={cornerClassName} />
      {children}
    </Comp>
  );
}

/** Ruled fill for the leftover space under a spec table. Decorative, hidden from assistive tech. */
export function BlueprintRuledFill({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("bp-ruled min-h-0 flex-1", className)}
    />
  );
}
