import { useMemo, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Skeleton } from "@/components/ui/skeleton";
import { CollectionActionSheet } from "@/components/shared/CollectionActionSheet";
import {
  useRadiantCollection,
  useToggleCollection,
  type RadiantCard,
  type RadiantSet,
} from "@/hooks/useRadiantCollection";
import { useCards, useCreateCard } from "@/hooks/useCards";

export default function Collection() {
  const { data, isLoading, error } = useRadiantCollection();
  const toggle = useToggleCollection();
  const createCard = useCreateCard();
  const { data: watchedCards } = useCards();
  const [activeCard, setActiveCard] = useState<RadiantCard | null>(null);

  // Map of "<cardId>|<variant>" → true for fast already-watching lookups
  // when the action sheet renders. cardId on a WatchedCard corresponds to
  // the pokemontcg.io card id, same shape as RadiantCard.id (e.g. "g1-RC1").
  const watchedIndex = useMemo(() => {
    const set = new Set<string>();
    if (!watchedCards) return set;
    for (const w of watchedCards) {
      set.add(`${w.pokemonTcgId}|${w.variant}`);
    }
    return set;
  }, [watchedCards]);

  function isAlreadyWatching(card: RadiantCard | null): boolean {
    if (!card) return false;
    const variant =
      card.variants.includes("holofoil") ? "holofoil" : card.variants[0];
    if (!variant) return false;
    return watchedIndex.has(`${card.id}|${variant}`);
  }

  function handleToggleCollected(cardId: string) {
    toggle.mutate(cardId);
    setActiveCard(null);
  }

  function handleAddToWatchlist(card: RadiantCard, variant: string) {
    createCard.mutate(
      {
        pokemonTcgId: card.id,
        variant,
        cardName: card.name,
        setName: card.setName,
        cardNumber: card.number,
      },
      { onSettled: () => setActiveCard(null) },
    );
  }

  return (
    <PageShell>
      <div className="space-y-8">
        <header className="space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[#F5C518]" />
            <h1 className="text-2xl font-bold tracking-tight">Radiant Collection</h1>
          </div>
          <p className="text-sm text-slate-400">
            Tap a card to mark it as collected or add it to your watchlist. Greyed-out cards aren&apos;t in your collection yet.
          </p>
          {data && <ProgressBar collected={data.collected} total={data.total} />}
        </header>

        {error && (
          <div className="rounded-md border border-amber-700 bg-amber-950/40 p-4 text-sm text-amber-300">
            Couldn&apos;t load the collection. Refresh to try again.
          </div>
        )}

        {isLoading && (
          <div className="space-y-8">
            {[1, 2].map((i) => (
              <section key={i} className="space-y-3">
                <Skeleton className="h-6 w-48" />
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 md:grid-cols-6">
                  {Array.from({ length: 12 }).map((_, j) => (
                    <Skeleton key={j} className="aspect-[5/7] w-full rounded-md" />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {data?.sets.map((set) => (
          <SetSection
            key={set.setId}
            set={set}
            onSelect={(card) => setActiveCard(card)}
          />
        ))}
      </div>

      <CollectionActionSheet
        card={activeCard}
        alreadyWatching={isAlreadyWatching(activeCard)}
        isToggling={toggle.isPending}
        isAdding={createCard.isPending}
        onToggleCollected={handleToggleCollected}
        onAddToWatchlist={handleAddToWatchlist}
        onClose={() => setActiveCard(null)}
      />
    </PageShell>
  );
}

function ProgressBar({ collected, total }: { collected: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((collected / total) * 100);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-slate-300">
          <span className="text-lg font-bold text-white">{collected}</span>
          <span className="text-slate-400"> / {total} collected</span>
        </span>
        <span className="text-slate-400">{pct}%</span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-slate-800"
        role="progressbar"
        aria-valuenow={collected}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label="Collection completion"
      >
        <div
          className="h-full rounded-full bg-[#F5C518] transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function SetSection({
  set,
  onSelect,
}: {
  set: RadiantSet;
  onSelect: (card: RadiantCard) => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">{set.setName}</h2>
        <span className="text-sm text-slate-400">
          {set.collected} / {set.total}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 md:grid-cols-6">
        {set.cards.map((card) => (
          <CardTile key={card.id} card={card} onSelect={onSelect} />
        ))}
      </div>
    </section>
  );
}

function CardTile({
  card,
  onSelect,
}: {
  card: RadiantCard;
  onSelect: (card: RadiantCard) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(card)}
      aria-pressed={card.collected}
      aria-label={`${card.name} (${card.number}). ${card.collected ? "Collected. Tap for options." : "Not collected. Tap for options."}`}
      data-testid="radiant-card-tile"
      data-collected={card.collected ? "true" : "false"}
      className="group relative block aspect-[5/7] w-full overflow-hidden rounded-md border border-slate-800 bg-slate-900 transition-transform active:scale-95"
    >
      {card.imageSmall ? (
        <img
          src={card.imageSmall}
          alt={card.name}
          loading="lazy"
          className={[
            "h-full w-full object-cover transition-all duration-200",
            card.collected ? "" : "grayscale opacity-40 group-hover:opacity-60",
          ].join(" ")}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center px-2 text-center text-xs text-slate-500">
          {card.name}
          <br />
          {card.number}
        </div>
      )}
      {card.collected && (
        <span
          className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#F5C518] text-slate-900 shadow"
          aria-hidden
        >
          <Check className="h-4 w-4" strokeWidth={3} />
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1 text-[11px] font-medium text-slate-200">
        {card.number}
      </span>
    </button>
  );
}
