import { cn } from "@app/ui/lib/utils";
import { Slot } from "radix-ui";
import type * as React from "react";

/**
 * Standard page header, shared across all Fabric apps (dashboard, admin-console, dev-portal).
 * Fully composable — a page assembles the pieces it needs:
 *
 *   <PageHeader>
 *     <PageHeaderHeading>
 *       <PageHeaderBack asChild><Link href="/x"><ArrowLeft className="size-4" />Back</Link></PageHeaderBack>
 *       <PageHeaderTitle>Campaigns</PageHeaderTitle>
 *       <PageHeaderDescription>…</PageHeaderDescription>
 *     </PageHeaderHeading>
 *     <PageHeaderActions><Button>New</Button></PageHeaderActions>
 *   </PageHeader>
 *
 * The back link is `asChild` so each app supplies its own router link (next/link etc.) without this
 * shared package depending on any framework.
 */
function PageHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page-header"
      className={cn(
        "flex flex-wrap items-start justify-between gap-3",
        className,
      )}
      {...props}
    />
  );
}

function PageHeaderHeading({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page-header-heading"
      className={cn("flex min-w-0 flex-col gap-1", className)}
      {...props}
    />
  );
}

function PageHeaderTitle({ className, ...props }: React.ComponentProps<"h1">) {
  return (
    <h1
      data-slot="page-header-title"
      className={cn(
        "font-display text-2xl font-semibold tracking-tight",
        className,
      )}
      {...props}
    />
  );
}

function PageHeaderDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="page-header-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function PageHeaderActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page-header-actions"
      className={cn("flex flex-wrap items-center gap-2", className)}
      {...props}
    />
  );
}

/** Back affordance above the title. Pass `asChild` and supply your router's Link (with an icon). */
function PageHeaderBack({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"a"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "a";
  return (
    <Comp
      data-slot="page-header-back"
      className={cn(
        "mb-1 inline-flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-4",
        className,
      )}
      {...props}
    />
  );
}

export {
  PageHeader,
  PageHeaderHeading,
  PageHeaderTitle,
  PageHeaderDescription,
  PageHeaderActions,
  PageHeaderBack,
};
