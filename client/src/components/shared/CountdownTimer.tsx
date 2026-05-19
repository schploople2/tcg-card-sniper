import { useCountdown } from "@/hooks/useCountdown";
import { isEndingSoon } from "@/lib/utils";
import { Clock } from "lucide-react";

interface CountdownTimerProps {
  endTime: string | null | undefined;
}

/**
 * Live countdown chip for auction end times.
 * Turns red when the auction ends within 1 hour.
 * Returns null if endTime is not provided.
 */
export function CountdownTimer({ endTime }: CountdownTimerProps) {
  const label = useCountdown(endTime);

  if (!label || !endTime) return null;

  const urgent = isEndingSoon(new Date(endTime));

  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-mono font-medium",
        urgent
          ? "bg-red-900/40 text-red-400 border border-red-700/50 animate-pulse"
          : "bg-slate-800 text-slate-300 border border-slate-700",
      ].join(" ")}
    >
      <Clock className="h-3 w-3 shrink-0" />
      {label}
    </span>
  );
}
