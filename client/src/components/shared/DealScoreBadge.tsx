import { DEAL_TIER_CONFIG } from "@/types";
import type { DealTier } from "@/types";

interface DealScoreBadgeProps {
  tier: DealTier;
  score: number;
}

/**
 * Colored badge showing the deal tier emoji + score percentage.
 * Uses the DEAL_TIER_CONFIG lookup from types for consistent labels/colors.
 */
export function DealScoreBadge({ tier, score }: DealScoreBadgeProps) {
  const cfg = DEAL_TIER_CONFIG[tier];
  const scoreStr = score > 0 ? `+${score}%` : `${score}%`;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums"
      style={{
        backgroundColor: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.border}`,
      }}
    >
      {cfg.label.split(" ")[0]} {scoreStr}
    </span>
  );
}
