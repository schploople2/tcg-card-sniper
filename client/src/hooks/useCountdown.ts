import { useState, useEffect } from "react";
import { formatCountdown } from "../lib/utils";

/**
 * Live countdown hook — re-renders every second until the target time.
 * Returns a formatted string like "1h 02m 45s" or null if endTime is null.
 */
export function useCountdown(endTime: string | null | undefined): string | null {
  const [label, setLabel] = useState<string | null>(() => {
    if (!endTime) return null;
    return formatCountdown(new Date(endTime));
  });

  useEffect(() => {
    if (!endTime) return;
    const update = () => setLabel(formatCountdown(new Date(endTime)));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [endTime]);

  return label;
}
