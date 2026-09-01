import { useEffect, useState } from "react";
import { Plus, Trash2, Search, Wallet } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import {
  usePortfolio,
  useCreatePortfolioItem,
  useDeletePortfolioItem,
} from "@/hooks/usePortfolio";
import { useCatalogSearch } from "@/hooks/useCatalog";
import { formatCurrency } from "@/lib/utils";
import { variantLabel, type CatalogCard, type CollectionItemKind, type PortfolioItem } from "@/types";
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

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

const KIND_LABEL: Record<CollectionItemKind, string> = {
  raw: "Raw",
  graded: "Graded",
  sealed: "Sealed",
};

export default function Portfolio() {
  const { data, isLoading, error } = usePortfolio();
  const deleteItem = useDeletePortfolioItem();
  const [addOpen, setAddOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PortfolioItem | null>(null);

  return (
    <PageShell>
      <div className="space-y-6">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-[#F5C518]" />
            <h1 className="text-2xl font-bold tracking-tight">Portfolio</h1>
          </div>
          <Button onClick={() => setAddOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> Add item
          </Button>
        </header>

        {data && <SummaryBar summary={data.summary} />}

        {error && (
          <div className="rounded-md border border-amber-700 bg-amber-950/40 p-4 text-sm text-amber-300">
            Couldn&apos;t load your portfolio. Refresh to try again.
          </div>
        )}

        {isLoading && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-md" />
            ))}
          </div>
        )}

        {data && data.items.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-800 p-10 text-center text-sm text-slate-500">
            No items yet. Add a card or sealed product to start tracking cost
            basis and unrealized P&amp;L.
          </div>
        )}

        {data && data.items.length > 0 && (
          <div className="space-y-2">
            {data.items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                onDelete={() => setPendingDelete(item)}
              />
            ))}
          </div>
        )}
      </div>

      <AddItemDialog open={addOpen} onClose={() => setAddOpen(false)} />

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(v) => !v && setPendingDelete(null)}
      >
        <AlertDialogContent className="bg-[#0f172a] border-slate-800 text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from portfolio?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {pendingDelete?.label} will be removed. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent border-slate-700 text-slate-200 hover:bg-slate-800">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (pendingDelete) deleteItem.mutate(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

function SummaryBar({
  summary,
}: {
  summary: { count: number; pricedCount: number; totalCost: number; totalValue: number; totalPnl: number };
}) {
  const pnlPositive = summary.totalPnl >= 0;
  const unpriced = summary.count - summary.pricedCount;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat label="Items" value={String(summary.count)} />
      <Stat label="Cost basis" value={formatCurrency(summary.totalCost)} />
      <Stat label="Current value" value={formatCurrency(summary.totalValue)} />
      <Stat
        label="Unrealized P&L"
        value={`${pnlPositive ? "+" : ""}${formatCurrency(summary.totalPnl)}`}
        valueClassName={pnlPositive ? "text-emerald-400" : "text-red-400"}
        hint={unpriced > 0 ? `${unpriced} unpriced item${unpriced === 1 ? "" : "s"} excluded` : undefined}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  valueClassName,
  hint,
}: {
  label: string;
  value: string;
  valueClassName?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${valueClassName ?? "text-slate-100"}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

function ItemRow({ item, onDelete }: { item: PortfolioItem; onDelete: () => void }) {
  const pnl = item.unrealizedPnl;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      {item.imageSmall ? (
        <img
          src={item.imageSmall}
          alt={item.label}
          className="h-14 w-10 object-contain rounded shrink-0 bg-slate-950"
        />
      ) : (
        <div className="h-14 w-10 rounded bg-slate-950 flex items-center justify-center text-lg shrink-0">
          {item.kind === "sealed" ? "📦" : "🃏"}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-100 truncate">
          {item.label}
          {item.quantity > 1 && (
            <span className="text-slate-500 font-normal"> ×{item.quantity}</span>
          )}
        </p>
        <div className="text-[11px] text-slate-500 truncate flex items-center gap-1.5 flex-wrap">
          <Badge className="text-[10px] bg-slate-800 text-slate-400 border border-slate-700">
            {KIND_LABEL[item.kind]}
          </Badge>
          {item.kind === "graded" && item.gradingCompany && (
            <span>{item.gradingCompany} {item.grade}</span>
          )}
          {item.variant && <span>{variantLabel(item.variant)}</span>}
          {item.setName && <span>{item.setName}</span>}
        </div>
      </div>

      <div className="text-right shrink-0">
        <p className="text-xs text-slate-500">
          Paid {formatCurrency(item.totalCost)}
        </p>
        <p className="text-sm font-medium text-slate-200">
          {item.currentValue != null ? formatCurrency(item.currentValue) : "— unpriced"}
        </p>
      </div>

      <div className="w-24 text-right shrink-0">
        {pnl != null ? (
          <span
            className={`text-sm font-semibold ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}
          >
            {pnl >= 0 ? "+" : ""}
            {formatCurrency(pnl)}
          </span>
        ) : (
          <span className="text-xs text-slate-600">—</span>
        )}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="text-slate-500 hover:text-red-400 shrink-0"
        onClick={onDelete}
        aria-label={`Remove ${item.label}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

// ─── Add item dialog ──────────────────────────────────────────────────────────

function CatalogPicker({
  selected,
  onSelect,
}: {
  selected: CatalogCard | null;
  onSelect: (card: CatalogCard | null) => void;
}) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 300);
  const { data: results, isFetching, isError } = useCatalogSearch(debouncedQuery);

  if (selected) {
    return (
      <div className="rounded-lg border border-[#F5C518]/40 bg-slate-800/40 p-3 flex gap-3">
        {selected.imageSmall ? (
          <img
            src={selected.imageSmall}
            alt={selected.name}
            className="h-16 w-11 object-contain rounded shrink-0 bg-slate-900"
          />
        ) : (
          <div className="h-16 w-11 rounded bg-slate-900 flex items-center justify-center text-lg shrink-0">
            🃏
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-100 truncate">
            {selected.name} <span className="text-slate-500">#{selected.number}</span>
          </p>
          <p className="text-xs text-slate-500 truncate">{selected.setName}</p>
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
          placeholder="Search Pokémon cards…"
          className="pl-8 bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-800 bg-slate-900/40">
        {query.trim().length < 2 ? (
          <div className="px-3 py-6 text-center text-xs text-slate-500">
            Type a card name to search the catalog.
          </div>
        ) : isFetching ? (
          <div className="px-3 py-3 space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full bg-slate-800 rounded" />
            ))}
          </div>
        ) : isError ? (
          <div className="px-3 py-6 text-center text-xs text-red-400">
            Catalog search failed — try again.
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
                      className="h-11 w-8 object-contain rounded shrink-0 bg-slate-900"
                    />
                  ) : (
                    <div className="h-11 w-8 rounded bg-slate-900 flex items-center justify-center text-sm shrink-0">
                      🃏
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-200 truncate">
                      {c.name} <span className="text-slate-500">#{c.number}</span>
                    </p>
                    <p className="text-[11px] text-slate-500 truncate">{c.setName}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AddItemDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createItem = useCreatePortfolioItem();
  const [kind, setKind] = useState<CollectionItemKind>("raw");
  const [selectedCard, setSelectedCard] = useState<CatalogCard | null>(null);
  const [variant, setVariant] = useState<string>("");
  const [label, setLabel] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [acquisitionPrice, setAcquisitionPrice] = useState("");
  const [acquiredAt, setAcquiredAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [gradingCompany, setGradingCompany] = useState("");
  const [grade, setGrade] = useState("");
  const [notes, setNotes] = useState("");

  function reset() {
    setKind("raw");
    setSelectedCard(null);
    setVariant("");
    setLabel("");
    setQuantity("1");
    setAcquisitionPrice("");
    setAcquiredAt(new Date().toISOString().slice(0, 10));
    setGradingCompany("");
    setGrade("");
    setNotes("");
  }

  function handleClose() {
    reset();
    onClose();
  }

  useEffect(() => {
    if (selectedCard && selectedCard.variants.length > 0 && !selectedCard.variants.includes(variant)) {
      setVariant(selectedCard.variants[0]);
    }
  }, [selectedCard, variant]);

  const needsCard = kind !== "sealed";
  const priceValid = /^\d+(\.\d{1,2})?$/.test(acquisitionPrice) && Number(acquisitionPrice) >= 0;
  const canSubmit =
    priceValid &&
    Number(quantity) >= 1 &&
    (needsCard ? !!selectedCard && !!variant : !!selectedCard || !!label.trim()) &&
    (kind !== "graded" || (!!gradingCompany.trim() && !!grade.trim()));

  function handleSubmit() {
    if (!canSubmit) return;
    createItem.mutate(
      {
        cardId: selectedCard?.id,
        label: selectedCard ? undefined : label.trim(),
        variant: needsCard ? variant : undefined,
        kind,
        gradingCompany: kind === "graded" ? gradingCompany.trim() : undefined,
        grade: kind === "graded" ? grade.trim() : undefined,
        quantity: Number(quantity),
        acquisitionPrice: Number(acquisitionPrice),
        acquiredAt: acquiredAt ? new Date(acquiredAt).toISOString() : undefined,
        notes: notes.trim() || undefined,
      },
      { onSuccess: handleClose }
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="bg-[#0f172a] border-slate-800 text-slate-100 max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">Add to portfolio</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-slate-400">Type</span>
            <Select value={kind} onValueChange={(v) => setKind(v as CollectionItemKind)}>
              <SelectTrigger className="bg-slate-900 border-slate-700 text-slate-100">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700 text-slate-100">
                <SelectItem value="raw">Raw</SelectItem>
                <SelectItem value="graded">Graded</SelectItem>
                <SelectItem value="sealed">Sealed product</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {kind === "sealed" && !selectedCard ? (
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-slate-400">Item name</span>
              <Input
                placeholder="e.g. Scarlet & Violet Booster Box"
                className="bg-slate-900 border-slate-700 text-slate-100"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
              <p className="text-[11px] text-slate-500">
                Or search the catalog below to link this to a specific card instead.
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <span className="text-xs font-medium text-slate-400">Card</span>
            <CatalogPicker selected={selectedCard} onSelect={setSelectedCard} />
          </div>

          {needsCard && selectedCard && selectedCard.variants.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-slate-400">Variant</span>
              <Select value={variant} onValueChange={setVariant}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-slate-100">
                  <SelectValue placeholder="Choose a variant" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 text-slate-100">
                  {selectedCard.variants.map((v) => (
                    <SelectItem key={v} value={v}>
                      {variantLabel(v)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {kind === "graded" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-slate-400">Grading company</span>
                <Input
                  placeholder="PSA"
                  className="bg-slate-900 border-slate-700 text-slate-100"
                  value={gradingCompany}
                  onChange={(e) => setGradingCompany(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-slate-400">Grade</span>
                <Input
                  placeholder="10"
                  className="bg-slate-900 border-slate-700 text-slate-100"
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-slate-400">Quantity</span>
              <Input
                type="number"
                min={1}
                className="bg-slate-900 border-slate-700 text-slate-100"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-slate-400">Paid (each, USD)</span>
              <Input
                inputMode="decimal"
                placeholder="0.00"
                className="bg-slate-900 border-slate-700 text-slate-100"
                value={acquisitionPrice}
                onChange={(e) => setAcquisitionPrice(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-slate-400">Acquired</span>
              <Input
                type="date"
                className="bg-slate-900 border-slate-700 text-slate-100"
                value={acquiredAt}
                onChange={(e) => setAcquiredAt(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-medium text-slate-400">Notes (optional)</span>
            <textarea
              rows={2}
              className="flex w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 shadow-sm placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} className="text-slate-300">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || createItem.isPending}>
            {createItem.isPending ? "Adding…" : "Add item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
