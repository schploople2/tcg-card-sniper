import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, RefreshCw, TrendingUp, ChevronDown, Search, Check } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { DealScoreBadge } from "@/components/shared/DealScoreBadge";
import { PriceBar } from "@/components/shared/PriceBar";
import { CardDetailDrawer } from "@/components/shared/CardDetailDrawer";
import {
  useCards,
  useCreateCard,
  useUpdateCard,
  useDeleteCard,
} from "@/hooks/useCards";
import { useRefreshListings } from "@/hooks/useListings";
import { useCatalogSearch } from "@/hooks/useCatalog";
import { formatCurrency } from "@/lib/utils";
import {
  getMarketForVariant,
  variantLabel,
  type WatchedCard,
  type CatalogCard,
} from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ─── Debounce hook (local) ────────────────────────────────────────────────────

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

// ─── Catalog picker (search + results) ────────────────────────────────────────

interface CatalogPickerProps {
  selected: CatalogCard | null;
  onSelect: (card: CatalogCard | null) => void;
}

function CatalogPicker({ selected, onSelect }: CatalogPickerProps) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 300);
  const { data: results, isFetching, isError } = useCatalogSearch(debouncedQuery);

  // Once the user picks a card, hide results and show the selection card
  if (selected) {
    return (
      <div className="rounded-lg border border-[#F5C518]/40 bg-slate-800/40 p-3 flex gap-3">
        {selected.imageSmall ? (
          <img
            src={selected.imageSmall}
            alt={selected.name}
            className="h-20 w-14 object-contain rounded shrink-0 bg-slate-900"
          />
        ) : (
          <div className="h-20 w-14 rounded bg-slate-900 flex items-center justify-center text-xl shrink-0">
            🃏
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-100 text-sm truncate">
            {selected.name}{" "}
            <span className="text-slate-500 font-normal">#{selected.number}</span>
          </p>
          <p className="text-xs text-slate-500 mt-0.5 truncate">{selected.setName}</p>
          {selected.rarity && (
            <Badge className="mt-1.5 text-[10px] bg-slate-800 text-slate-400 border border-slate-700">
              {selected.rarity}
            </Badge>
          )}
          {selected.previewMarket != null && (
            <p className="mt-1 text-xs text-slate-400">
              TCGPlayer market:{" "}
              <span className="text-[#F5C518] font-medium">
                {formatCurrency(selected.previewMarket)}
              </span>
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-slate-400 hover:text-slate-200 self-start"
          onClick={() => onSelect(null)}
        >
          Change
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <Input
          autoFocus
          placeholder="Search Pokémon cards…"
          className="pl-8 bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* Results list */}
      <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-800 bg-slate-900/40">
        {query.trim().length < 2 ? (
          <div className="px-3 py-6 text-center text-xs text-slate-500">
            Type a card name to search the pokemontcg.io catalog.
          </div>
        ) : isFetching ? (
          <div className="px-3 py-3 space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-14 w-full bg-slate-800 rounded" />
            ))}
          </div>
        ) : isError ? (
          <div className="px-3 py-6 text-center text-xs text-red-400">
            Catalog search failed — try again in a moment.
          </div>
        ) : !results?.length ? (
          <div className="px-3 py-6 text-center text-xs text-slate-500">
            No matches for &ldquo;{debouncedQuery}&rdquo;.
          </div>
        ) : (
          <ul className="divide-y divide-slate-800">
            {results.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelect(c)}
                  className="w-full px-3 py-2 flex gap-3 items-center hover:bg-slate-800/60 transition-colors text-left"
                >
                  {c.imageSmall ? (
                    <img
                      src={c.imageSmall}
                      alt={c.name}
                      className="h-12 w-9 object-contain rounded shrink-0 bg-slate-900"
                    />
                  ) : (
                    <div className="h-12 w-9 rounded bg-slate-900 flex items-center justify-center text-base shrink-0">
                      🃏
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-200 truncate">
                      {c.name}{" "}
                      <span className="text-slate-500">#{c.number}</span>
                    </p>
                    <p className="text-[11px] text-slate-500 truncate">
                      {c.setName} · {c.setSeries}
                    </p>
                  </div>
                  {c.previewMarket != null && (
                    <span className="text-xs text-[#F5C518] font-medium shrink-0">
                      {formatCurrency(c.previewMarket)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Add / Edit form dialog ──────────────────────────────────────────────────

interface CardFormDialogProps {
  open: boolean;
  onClose: () => void;
  initial?: WatchedCard;
}

function CardFormDialog({ open, onClose, initial }: CardFormDialogProps) {
  const createCard = useCreateCard();
  const updateCard = useUpdateCard();
  const isEdit = !!initial;

  // ── Add-mode state ────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<CatalogCard | null>(null);
  const [variant, setVariant] = useState<string>(initial?.variant ?? "");

  // When the user picks a new card, auto-pick the first available variant
  useEffect(() => {
    if (!selected) return;
    if (selected.variants.length > 0 && !selected.variants.includes(variant)) {
      setVariant(selected.variants[0]);
    }
  }, [selected, variant]);

  // Available variants come from the picked card in add-mode, or are
  // unknown in edit-mode (we don't have CatalogCard here). For edit we
  // just let the user retype the variant string — rare case.
  const availableVariants = selected?.variants ?? [];

  const isPending = createCard.isPending || updateCard.isPending;
  const canSubmit = isEdit
    ? !!variant
    : !!selected && !!variant;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isEdit) {
      updateCard.mutate(
        { id: initial!.id, variant },
        { onSuccess: onClose }
      );
    } else if (selected) {
      createCard.mutate(
        {
          pokemonTcgId: selected.id,
          variant,
          cardName: selected.name,
          setName: selected.setName,
          cardNumber: selected.number,
        },
        { onSuccess: onClose }
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-[#0f172a] border-slate-800 text-slate-100 max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">
            {isEdit ? "Edit Variant" : "Add Card to Watchlist"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {/* Add mode: catalog picker. Edit mode: read-only card identity. */}
          {isEdit ? (
            <div className="rounded-lg border border-slate-800 bg-slate-800/40 p-3">
              <p className="font-semibold text-slate-100 text-sm">
                {initial!.cardName}{" "}
                {initial!.cardNumber && (
                  <span className="text-slate-500 font-normal">#{initial!.cardNumber}</span>
                )}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">{initial!.setName}</p>
              <p className="text-[10px] text-slate-600 mt-1">
                Card identity can&apos;t be changed — delete and re-add to track a
                different card.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400">Card *</label>
              <CatalogPicker selected={selected} onSelect={setSelected} />
            </div>
          )}

          {/* Variant picker */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400">Variant *</label>
            {isEdit || availableVariants.length === 0 ? (
              <Input
                required
                placeholder="e.g. normal, holofoil"
                className="bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500"
                value={variant}
                onChange={(e) => setVariant(e.target.value)}
              />
            ) : (
              <Select value={variant} onValueChange={setVariant}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-slate-100">
                  <SelectValue placeholder="Choose a variant" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  {availableVariants.map((v) => {
                    const market = selected!.variantPrices[v]?.market;
                    return (
                      <SelectItem key={v} value={v}>
                        <span className="flex items-center gap-2">
                          <span>{variantLabel(v)}</span>
                          {market != null && (
                            <span className="text-[#F5C518] text-xs">
                              {formatCurrency(market)}
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            )}
            <p className="text-[10px] text-slate-500">
              Drives the TCGPlayer market price the deal engine compares against
              AND the keyword appended to eBay searches.
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-800/40 px-3 py-2.5">
            <p className="text-[11px] text-slate-400 leading-relaxed">
              <Check className="inline h-3 w-3 mr-1 text-[#F5C518]" />
              <span className="text-[#F5C518] font-medium">Market price</span>{" "}
              comes from TCGPlayer (via pokemontcg.io). Alerts fire when an eBay
              listing&apos;s total cost falls at or below the variant&apos;s
              market price.
            </p>
          </div>

          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit || isPending}
              className="bg-[#F5C518] text-slate-900 hover:bg-[#f0ba00] font-semibold disabled:opacity-50"
            >
              {isPending ? "Saving…" : isEdit ? "Save Changes" : "Add Card"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Single card tile ─────────────────────────────────────────────────────────

function CardTile({
  card,
  onEdit,
  onDelete,
  onViewDetails,
}: {
  card: WatchedCard;
  onEdit: () => void;
  onDelete: () => void;
  onViewDetails: () => void;
}) {
  const refreshListings = useRefreshListings(card.id);
  const [expanded, setExpanded] = useState(false);

  const bestListing = card.listings?.[0];
  const targetPrice = getMarketForVariant(card.priceCache, card.variant);
  const marketPrice =
    bestListing != null
      ? Number(bestListing.marketPrice)
      : targetPrice;

  const atTarget =
    bestListing != null &&
    targetPrice != null &&
    Number(bestListing.totalCost) <= targetPrice;

  // For the expandable "TCGPlayer prices" section, show all available variants
  const allVariantEntries = useMemo(() => {
    if (!card.priceCache?.variants) return [];
    return Object.entries(card.priceCache.variants);
  }, [card.priceCache]);

  return (
    <div
      className={[
        "rounded-xl border bg-[#0f172a] p-4 flex flex-col gap-3 transition-all",
        atTarget ? "border-emerald-700/60" : "border-slate-800",
      ].join(" ")}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <button
            className="font-semibold text-slate-100 hover:text-[#F5C518] transition-colors leading-tight truncate text-left w-full"
            onClick={onViewDetails}
          >
            {card.cardName}
          </button>
          <p className="text-xs text-slate-500 mt-0.5 truncate">
            {card.setName}
            {card.cardNumber && ` · #${card.cardNumber}`}
          </p>
          <Badge className="mt-1.5 text-[10px] bg-slate-800 text-slate-400 border border-slate-700">
            {variantLabel(card.variant)}
          </Badge>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-500 hover:text-slate-300"
            onClick={() => refreshListings.mutate()}
            disabled={refreshListings.isPending}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshListings.isPending ? "animate-spin" : ""}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-500 hover:text-slate-300"
            onClick={onEdit}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-500 hover:text-red-400"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Prices */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-slate-800/60 px-3 py-2">
          <p className="text-slate-500 text-[10px] uppercase tracking-wide">
            Target ({variantLabel(card.variant)})
          </p>
          <p className="font-semibold text-[#F5C518] mt-0.5">
            {targetPrice != null ? formatCurrency(targetPrice) : "—"}
          </p>
        </div>
        <div className="rounded-lg bg-slate-800/60 px-3 py-2">
          <p className="text-slate-500 text-[10px] uppercase tracking-wide">Market</p>
          <p className="font-semibold text-slate-200 mt-0.5">
            {marketPrice ? formatCurrency(marketPrice) : "—"}
          </p>
        </div>
      </div>

      {/* Best listing */}
      {bestListing ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500 uppercase tracking-wide">Best listing</span>
            <DealScoreBadge tier={bestListing.dealTier} score={Number(bestListing.dealScore)} />
          </div>
          <PriceBar
            listingPrice={Number(bestListing.listingPrice)}
            shippingCost={bestListing.shippingCost != null ? Number(bestListing.shippingCost) : null}
            marketPrice={Number(bestListing.marketPrice)}
          />
          {atTarget && (
            <Badge className="text-[10px] w-full justify-center bg-emerald-900/40 text-emerald-400 border border-emerald-700/40">
              ✓ At or below market price
            </Badge>
          )}
        </div>
      ) : (
        <div className="rounded-lg bg-slate-800/40 py-3 text-center text-xs text-slate-600">
          No listings fetched yet — hit refresh
        </div>
      )}

      {/* TCGPlayer prices (expandable) */}
      {allVariantEntries.length > 0 && (
        <button
          className="flex items-center gap-1 text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
          onClick={() => setExpanded((v) => !v)}
        >
          <TrendingUp className="h-3 w-3" />
          TCGPlayer prices
          <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      )}
      {expanded && (
        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
          {allVariantEntries.map(([key, prices]) =>
            prices.market != null ? (
              <div key={key} className="flex justify-between rounded bg-slate-800/40 px-2 py-1">
                <span className="text-slate-500">{variantLabel(key)}</span>
                <span className="text-slate-300 font-medium">
                  {formatCurrency(Number(prices.market))}
                </span>
              </div>
            ) : null
          )}
        </div>
      )}
    </div>
  );
}

// ─── Skeleton card ─────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4 space-y-3">
      <Skeleton className="h-5 w-3/4 bg-slate-800" />
      <Skeleton className="h-3 w-1/2 bg-slate-800" />
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-10 bg-slate-800 rounded-lg" />
        <Skeleton className="h-10 bg-slate-800 rounded-lg" />
      </div>
      <Skeleton className="h-8 bg-slate-800 rounded-lg" />
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Watchlist() {
  const { data: cards, isLoading } = useCards();
  const deleteCard = useDeleteCard();

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<WatchedCard | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<WatchedCard | undefined>(undefined);
  const [drawerCard, setDrawerCard] = useState<WatchedCard | null>(null);

  function openAdd() {
    setEditTarget(undefined);
    setFormOpen(true);
  }

  function openEdit(card: WatchedCard) {
    setEditTarget(card);
    setFormOpen(true);
  }

  return (
    <PageShell>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Watchlist</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            {cards?.length ?? 0} card{cards?.length !== 1 ? "s" : ""} tracked
          </p>
        </div>
        <Button
          onClick={openAdd}
          className="bg-[#F5C518] text-slate-900 hover:bg-[#f0ba00] font-semibold"
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Add Card
        </Button>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : !cards?.length ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 py-24 text-center">
          <p className="text-4xl mb-3">🎴</p>
          <p className="font-medium text-slate-300">No cards yet</p>
          <p className="mt-1 text-sm text-slate-500 max-w-xs">
            Add your first card to start receiving deal alerts and live eBay pricing.
          </p>
          <Button
            onClick={openAdd}
            className="mt-4 bg-[#F5C518] text-slate-900 hover:bg-[#f0ba00] font-semibold"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Add Your First Card
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <CardTile
              key={card.id}
              card={card}
              onEdit={() => openEdit(card)}
              onDelete={() => setDeleteTarget(card)}
              onViewDetails={() => setDrawerCard(card)}
            />
          ))}
        </div>
      )}

      {/* Add / Edit dialog */}
      {formOpen && (
        <CardFormDialog
          open={formOpen}
          onClose={() => setFormOpen(false)}
          initial={editTarget}
        />
      )}

      {/* Card detail drawer */}
      <CardDetailDrawer
        card={drawerCard}
        onClose={() => setDrawerCard(null)}
      />

      {/* Delete confirm dialog */}
      {deleteTarget && (
        <AlertDialog open onOpenChange={(v) => !v && setDeleteTarget(undefined)}>
          <AlertDialogContent className="bg-[#0f172a] border-slate-800 text-slate-100">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-white">Remove card?</AlertDialogTitle>
              <AlertDialogDescription className="text-slate-400">
                Remove <span className="text-slate-200 font-medium">{deleteTarget.cardName}</span>{" "}
                from your watchlist? All saved listings will be deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                className="bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                onClick={() => setDeleteTarget(undefined)}
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-700 hover:bg-red-600 text-white"
                onClick={() => {
                  deleteCard.mutate(deleteTarget.id);
                  setDeleteTarget(undefined);
                }}
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </PageShell>
  );
}
