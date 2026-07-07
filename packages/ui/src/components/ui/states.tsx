import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@app/ui/components/ui/alert";
import { Button } from "@app/ui/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@app/ui/components/ui/empty";
import { Skeleton } from "@app/ui/components/ui/skeleton";
import { cn } from "@app/ui/lib/utils";
import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

/**
 * First-class async-state primitives, shared across all apps so every screen renders loading / error /
 * empty the same way. A data view early-returns one of these before rendering content:
 *
 *   if (query.isPending) return <LoadingRows />;
 *   if (query.isError) return <ErrorState message={parseApiError(query.error).message} onRetry={...} />;
 *   if (data.length === 0) return <EmptyState title="Nothing yet" .../>;
 */

/** Standard error panel — message + optional support requestId + retry. */
export function ErrorState({
  title = "Something went wrong",
  message,
  requestId,
  onRetry,
  className,
}: {
  title?: string;
  message: string;
  requestId?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <Alert variant="destructive" className={className}>
      <TriangleAlert />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{message}</p>
        {requestId && (
          <p>
            Contact support with <code className="font-mono">{requestId}</code>.
          </p>
        )}
        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={onRetry}
          >
            Try again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** Standard empty state — icon + title + description + optional action (wraps the Empty primitive). */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Empty className={cn("mx-auto max-w-2xl", className)}>
      <EmptyHeader>
        {icon && <EmptyMedia variant="icon">{icon}</EmptyMedia>}
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

/** Standard loading placeholder — N full-width skeleton rows. */
export function LoadingRows({
  rows = 5,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length static skeleton list.
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
