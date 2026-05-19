import { useState } from "react";
import { Plus, Pencil, Trash2, RefreshCw, TrendingUp, ChevronDown } from "lucide-react";
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
import { formatCurrency } from "@/lib/utils";
import type { WatchedCard, CreateCardPayload } from "@/types";
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

const CONDITIONS = ["Raw", "PSA 10", "PSA 9", "PSA 8", "BGS 10", "BGS 9.5", "CGC 10"] as const;

// ─── Add / Edit form dialog ──────────────────────────────────────────────────

interface CardFormDialogProps {
  open: boolean;
  onClose: () => void;
  initial?: WatchedCard;
}

function CardFormDialog({ open, onClose, initial }: CardFormDialogProps) {
  const createCard = useCreateCard();
  const updateCard = useUpdateCard();

  const [form, setForm] = useState<CreateCardPayload>({
    cardName: initial?.cardName ?? "",
    setName: initial?.setName ?? "",
    cardNumber: initial?.cardNumber ?? "",
    condition: initial?.condition ?? "Raw",
    targetPrice: initial?.targetPrice ?? 0,
  });

  const isEdit = !!initial;
  const isPending = createCard.isPending || updateCard.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = { ...form, targetPrice: Number(form.targetPrice) };
    if (isEdit) {
      updateCard.mutate(
        { id: initial!.id, ...payload },
        { onSuccess: onClose }
      );
    } else {
      createCard.mutate(payload, { onSuccess: onClose });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-[#0f172a] border-slate-800 text-slate-100 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">
            {isEdit ? "Edit Card" : "Add Card to Watchlist"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400">Card Name *</label>
            <Input
              required
              placeholder="e.g. Charizard VMAX"
              className="bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500"
              value={form.cardName}
              onChange={(e) => setForm((f) => ({ ...f, cardName: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400">Set Name *</label>
            <Input
              required
              placeholder="e.g. Darkness Ablaze"
              className="bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500"
              value={form.setName}
              onChange={(e) => setForm((f) => ({ ...f, setName: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400">Card Number</label>
              <Input
                placeholder="e.g. 020/189"
                className="bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500"
                value={form.cardNumber ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, cardNumber: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400">Condition *</label>
              <Select
                value={form.condition}
                onValueChange={(v) => setForm((f) => ({ ...f, condition: v }))}
              >
                <SelectTrigger className="bg-slate-800 border-slate-700 text-slate-100">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  {CONDITIONS.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400">
              Target Price (incl. shipping) *
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                $
              </span>
              <Input
                required
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                className="pl-7 bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500"
                value={form.targetPrice || ""}
                onChange={(e) => setForm((f) => ({ ...f, targetPrice: parseFloat(e.target.value) || 0 }))}
              />
            </div>
            <p className="text-[10px] text-slate-500">
              Max total cost you'll pay, including shipping.
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
              disabled={isPending}
              className="bg-[#F5C518] text-slate-900 hover:bg-[#f0ba00] font-semibold"
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

  // Best listing from the included listings array
  const bestListing = card.listings?.[0];
  const marketPrice =
    bestListing?.marketPrice ??
    (card.priceCache
      ? Number(card.priceCache.loosePrice) || Number(card.priceCache.gradedPrice) || null
      : null);

  const atTarget =
    bestListing != null && Number(bestListing.totalCost) <= card.targetPrice;

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
            {card.condition}
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
          <p className="text-slate-500 text-[10px] uppercase tracking-wide">Target</p>
          <p className="font-semibold text-[#F5C518] mt-0.5">{formatCurrency(card.targetPrice)}</p>
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
              ✓ At or below your target price
            </Badge>
          )}
        </div>
      ) : (
        <div className="rounded-lg bg-slate-800/40 py-3 text-center text-xs text-slate-600">
          No listings fetched yet — hit refresh
        </div>
      )}

      {/* Price cache details (expandable) */}
      {card.priceCache && (
        <button
          className="flex items-center gap-1 text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
          onClick={() => setExpanded((v) => !v)}
        >
          <TrendingUp className="h-3 w-3" />
          PriceCharting data
          <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      )}
      {expanded && card.priceCache && (
        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
          {[
            ["Loose", card.priceCache.loosePrice],
            ["CIB", card.priceCache.cibPrice],
            ["New", card.priceCache.newPrice],
            ["Graded", card.priceCache.gradedPrice],
          ].map(([label, val]) =>
            val != null ? (
              <div key={label as string} className="flex justify-between rounded bg-slate-800/40 px-2 py-1">
                <span className="text-slate-500">{label}</span>
                <span className="text-slate-300 font-medium">{formatCurrency(Number(val))}</span>
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
