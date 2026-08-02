import { BlueprintCorners } from "@app/ui/components/ui/blueprint";
import { cn } from "@app/ui/lib/utils";
import type * as React from "react";

/**
 * The standard surface. Carries the blueprint registration marks — a "+" hairline at each corner,
 * drawn just OUTSIDE the border — so every card in every app reads as a drafted object rather than
 * a floating rounded panel. It only works because the app is a squared-corner system
 * (`--radius: 0`); the marks are defined in theme.css and rendered by `BlueprintCorners`.
 *
 * Pass `corners={false}` where they cannot survive: inside a clipped parent (`overflow-hidden`),
 * flush against a viewport edge, or in a dense grid whose gap is under ~1rem, since adjacent marks
 * would collide. Grids of cards generally want `gap-6` or wider.
 */
function Card({
  className,
  corners = true,
  children,
  ...props
}: React.ComponentProps<"div"> & { corners?: boolean }) {
  return (
    <div
      data-slot="card"
      className={cn(
        "relative flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground shadow-sm",
        corners && "blueprint",
        className,
      )}
      {...props}
    >
      {corners ? <BlueprintCorners /> : null}
      {children}
    </div>
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("leading-none font-semibold", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className,
      )}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-6", className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-6 [.border-t]:pt-6", className)}
      {...props}
    />
  );
}

export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
};
