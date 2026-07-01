import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class names, resolving conflicts left-to-right (shadcn convention).
 * The single class-composition helper every `@app/ui` component uses.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
