import { Check, Plus, BookMarked } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { RadiantCard } from "@/hooks/useRadiantCollection";

/**
 * cxu — Action sheet shown when the user taps a card on /collection.
 * Exposes two actions: toggle collected, and add the card to the
 * watchlist at the default variant. Pre-flight: if the user already
 * watches the card+variant pair, the Add button is disabled and labeled
 * "Already in watchlist".
 *
 * Variant default rule: holofoil if present, else the first variant in
 * the array. Empty array means no TCGPlayer pricing — Add is disabled
 * with a "No TCGPlayer variants" label.
 */
export function pickDefaultVariant(variants: string[]): string | null {
  if (variants.length === 0) return null;
  if (variants.includes("holofoil")) return "holofoil";
  return variants[0];
}

type Props = {
  card: RadiantCard | null;
  alreadyWatching: boolean;
  isToggling: boolean;
  isAdding: boolean;
  onToggleCollected: (cardId: string) => void;
  onAddToWatchlist: (card: RadiantCard, variant: string) => void;
  onClose: () => void;
};

export function CollectionActionSheet({
  card,
  alreadyWatching,
  isToggling,
  isAdding,
  onToggleCollected,
  onAddToWatchlist,
  onClose,
}: Props) {
  const variant = card ? pickDefaultVariant(card.variants) : null;

  const addLabel = !variant
    ? "No TCGPlayer variants"
    : alreadyWatching
      ? "Already in watchlist"
      : `Add to watchlist (${variant})`;
  const addDisabled = !variant || alreadyWatching || isAdding;

  return (
    <Dialog open={!!card} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="bg-[#0f172a] border-slate-800 text-slate-100 max-w-sm"
        data-testid="collection-action-sheet"
      >
        {card && (
          <>
            <div className="flex items-center gap-3 pr-6">
              {card.imageSmall && (
                <img
                  src={card.imageSmall}
                  alt=""
                  className="h-20 w-auto rounded border border-slate-800"
                />
              )}
              <div className="min-w-0">
                <DialogTitle className="truncate">{card.name}</DialogTitle>
                <DialogDescription className="truncate">
                  {card.setName} · {card.number}
                </DialogDescription>
              </div>
            </div>

            <div className="mt-2 grid gap-2">
              <Button
                type="button"
                onClick={() => onToggleCollected(card.id)}
                disabled={isToggling}
                className={
                  card.collected
                    ? "justify-start bg-slate-800 hover:bg-slate-700 text-slate-100"
                    : "justify-start bg-[#F5C518] hover:bg-[#e0b416] text-slate-900"
                }
                data-testid="action-toggle-collected"
              >
                <Check className="h-4 w-4 mr-2" />
                {card.collected ? "Mark as not collected" : "Mark as collected"}
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={() => variant && onAddToWatchlist(card, variant)}
                disabled={addDisabled}
                className="justify-start border-slate-700 bg-slate-900/40 hover:bg-slate-800 text-slate-100"
                data-testid="action-add-watchlist"
              >
                {alreadyWatching ? (
                  <BookMarked className="h-4 w-4 mr-2" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                {addLabel}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
