import { Check, Sparkles } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useRadiantCollection,
  useToggleCollection,
  type RadiantCard,
  type RadiantSet,
} from "@/hooks/useRadiantCollection";

export default function Collection() {
  const { data, isLoading, error } = useRadiantCollection();
  const toggle = useToggleCollection();

  return (
    <PageShell>
      <div className="space-y-8">
        <header className="space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[#F5C518]" />
            <h1 className="text-2xl font-bold tracking-tight">Radiant Collection</h1>
          </div>
          <p className="text-sm text-slate-400">
            Tap a card to mark it as collected. Greyed-out cards aren&apos;t in your collection yet.
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
            onToggle={(cardId) => toggle.mutate(cardId)}
            pendingId={toggle.isPending ? toggle.variables : null}
          />
        ))}
      </div>
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
  onToggle,
  pendingId,
}: {
  set: RadiantSet;
  onToggle: (cardId: string) => void;
  pendingId: string | null;
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
          <CardTile
            key={card.id}
            card={card}
            onToggle={onToggle}
            pending={pendingId === card.id}
          />
        ))}
      </div>
    </section>
  );
}

function CardTile({
  card,
  onToggle,
  pending,
}: {
  card: RadiantCard;
  onToggle: (cardId: string) => void;
  pending: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(card.id)}
      aria-pressed={card.collected}
      aria-label={`${card.name} (${card.number}). ${card.collected ? "Collected. Tap to mark as not collected." : "Not collected. Tap to mark as collected."}`}
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
            pending ? "opacity-70" : "",
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
