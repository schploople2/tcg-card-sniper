import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes — used by shadcn/ui components */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Format a number as USD currency */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

/**
 * Format milliseconds remaining as a human-readable countdown.
 * e.g. 3723000 → "1h 2m 03s"
 */
export function formatCountdown(endTime: Date): string {
  const ms = Math.max(0, endTime.getTime() - Date.now());
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  if (h > 0) return `${h}h ${m}m ${String(s).padStart(2, "0")}s`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/** True when an auction ends within the next hour */
export function isEndingSoon(endTime: Date): boolean {
  return endTime.getTime() - Date.now() < 60 * 60 * 1000;
}
