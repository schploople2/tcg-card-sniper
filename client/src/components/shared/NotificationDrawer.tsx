import { createPortal } from "react-dom";
import { X, Bell, ExternalLink, Check, CheckCheck } from "lucide-react";
import { useAlerts, useMarkAlertRead, useMarkAllAlertsRead } from "@/hooks/useAlerts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DealScoreBadge } from "./DealScoreBadge";
import { formatCurrency } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import type { Alert } from "@/types";

interface NotificationDrawerProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Slide-over panel showing all of a user's alerts, newest first.
 *
 * Mirrors the structural choices in `CardDetailDrawer`:
 *   - Fixed right side, max-width content, dark backdrop with backdrop-blur
 *   - Header with title + "mark all read" action
 *   - Scrollable body of grouped alerts
 *   - Each row links to the eBay listing (and marks itself read on click)
 *
 * When a listing has expired (>30 min old), the row shows the title +
 * "listing expired" hint rather than a live "Buy" link — the alert is still
 * historically useful but the deal is gone.
 */
export function NotificationDrawer({ open, onClose }: NotificationDrawerProps) {
  const { data, isLoading } = useAlerts({ enabled: open });
  const markRead = useMarkAlertRead();
  const markAllRead = useMarkAllAlertsRead();

  if (!open) return null;

  const alerts = data?.alerts ?? [];
  const unreadCount = alerts.filter((a) => a.readAt === null).length;

  // Portal to document.body so the panel escapes *any* ancestor stacking
  // context — backdrop-filter / transform / contain / will-change on a
  // parent all break `position: fixed` for descendants. Mounting at the
  // body root sidesteps the lot of them.
  const drawer = (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel — explicit h-screen alongside inset-y-0 so the flex children
          have a definite parent height even on browsers that struggle with
          the implicit top:0 + bottom:0 height resolution. */}
      <div className="fixed inset-y-0 right-0 z-50 flex h-screen w-full max-w-md flex-col bg-[#0a0f1e] border-l border-slate-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-[#F5C518]" />
            <h2 className="text-base font-bold text-white">Alerts</h2>
            {unreadCount > 0 && (
              <Badge className="bg-red-900/40 text-red-300 border border-red-700/40 text-[10px]">
                {unreadCount} new
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                className="text-xs text-slate-400 hover:text-slate-200"
                title="Mark all read"
              >
                <CheckCheck className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {isLoading ? (
            <div className="space-y-2 px-2 pt-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-20 w-full bg-slate-800 rounded-xl" />
              ))}
            </div>
          ) : alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Bell className="h-8 w-8 text-slate-700 mb-3" />
              <p className="text-sm font-medium text-slate-400">No alerts yet</p>
              <p className="text-xs text-slate-600 mt-1 max-w-[260px]">
                Set a target price on a watched card — we'll notify you
                when a listing drops to or below it.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {alerts.map((alert) => (
                <AlertRow
                  key={alert.id}
                  alert={alert}
                  onMarkRead={() => markRead.mutate(alert.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );

  return createPortal(drawer, document.body);
}

interface AlertRowProps {
  alert: Alert;
  onMarkRead: () => void;
}

/**
 * One alert in the drawer. Two visual states:
 *   - Unread: stronger border, unread-dot indicator, click anywhere marks read
 *   - Read:   muted styling, dot hidden
 *
 * Clicking the title or the "Open" link opens eBay in a new tab AND marks
 * the alert read — the typical "I saw this" intent for a notification.
 */
function AlertRow({ alert, onMarkRead }: AlertRowProps) {
  const isUnread = alert.readAt === null;
  const card = alert.card;
  const listing = alert.listing;
  // A1 — LOT_HOT alerts reference a lot, not a watched card. card is null
  // and we render the lot title from `listing` (which the alerts route
  // populates from the Lot row for LOT_HOT specifically). Falls back to a
  // generic label when neither is available.
  const isLotAlert = alert.kind === "LOT_HOT";

  const onOpenEbay = () => {
    if (listing) {
      window.open(listing.ebayUrl, "_blank", "noopener");
    }
    if (isUnread) onMarkRead();
  };

  const kindLabel =
    alert.kind === "TARGET_HIT"
      ? "🎯 Target hit"
      : alert.kind === "HOT_DEAL"
      ? "🔥 Hot deal"
      : "💎 Under-priced lot";
  const kindClass =
    alert.kind === "TARGET_HIT"
      ? "bg-emerald-900/30 text-emerald-300 border-emerald-700/40"
      : alert.kind === "HOT_DEAL"
      ? "bg-red-900/30 text-red-300 border-red-700/40"
      : "bg-purple-900/30 text-purple-300 border-purple-700/40";

  return (
    <div
      className={[
        "rounded-xl border p-3 space-y-2 transition",
        isUnread
          ? "border-slate-700 bg-[#0f172a]"
          : "border-slate-800 bg-[#0a0f1e] opacity-70",
      ].join(" ")}
    >
      <div className="flex items-start gap-2 justify-between">
        <div className="flex items-start gap-2 min-w-0">
          {/* Unread indicator dot */}
          {isUnread && (
            <span
              className="mt-1.5 inline-block h-2 w-2 rounded-full bg-red-400 shrink-0"
              aria-label="unread"
            />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={`text-[10px] border ${kindClass}`}>{kindLabel}</Badge>
              <span className="text-[10px] text-slate-500">
                {formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true })}
              </span>
            </div>
            <p className="text-xs text-slate-300 font-medium mt-1 truncate">
              {card ? (
                <>
                  {card.cardName}
                  {card.cardNumber && (
                    <span className="text-slate-600"> · #{card.cardNumber}</span>
                  )}
                  <span className="text-slate-600"> · {card.setName}</span>
                </>
              ) : isLotAlert ? (
                <span className="text-slate-300">Multi-card lot</span>
              ) : (
                <span className="text-slate-500 italic">(card removed)</span>
              )}
            </p>
          </div>
        </div>
        {isUnread && (
          <button
            type="button"
            onClick={onMarkRead}
            className="text-slate-600 hover:text-emerald-400 transition shrink-0"
            title="Mark read"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {listing ? (
        <button
          type="button"
          onClick={onOpenEbay}
          className="w-full flex items-center gap-2 text-left bg-slate-800/50 hover:bg-slate-800 rounded-lg p-2 transition group"
        >
          {listing.imageUrl && (
            <img
              src={listing.imageUrl}
              alt={listing.title}
              className="h-10 w-8 object-contain rounded shrink-0"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-slate-300 line-clamp-2 leading-snug">
              {listing.title}
            </p>
            <div className="flex items-center justify-between gap-2 mt-1">
              <span className="text-xs font-medium text-[#F5C518] tabular-nums">
                {formatCurrency(Number(listing.totalCost))}
              </span>
              <DealScoreBadge tier={listing.dealTier} score={listing.dealScore} />
            </div>
          </div>
          <ExternalLink
            className="h-4 w-4 text-slate-500 group-hover:text-slate-300 transition shrink-0"
            aria-hidden
          />
        </button>
      ) : isLotAlert && alert.lotEbayItemId ? (
        // A1 — LOT_HOT alert. We don't have a full listing snapshot wired
        // through yet (follow-up bead); just expose the eBay link so the
        // user can jump straight to the lot.
        <a
          href={ebayUrlFromLotId(alert.lotEbayItemId)}
          target="_blank"
          rel="noopener"
          onClick={() => isUnread && onMarkRead()}
          className="block bg-slate-800/50 hover:bg-slate-800 rounded-lg p-2 transition group"
        >
          <p className="text-[11px] text-slate-300">
            Vision OCR found multiple cards above asking price.
          </p>
          <span className="mt-1 inline-flex items-center gap-1 text-xs text-purple-300 group-hover:text-purple-200">
            Open lot on eBay
            <ExternalLink className="h-3 w-3" />
          </span>
        </a>
      ) : (
        // Listing rotated out of the 30-min cache — alert is historical.
        <div className="text-[11px] text-slate-600 italic px-2 py-1">
          Listing has expired or sold — alert kept for history.
          <span className="ml-1 text-slate-700">({alert.listingExpired ? "expired" : "missing"})</span>
        </div>
      )}
    </div>
  );
}

/**
 * Convert a stored Lot.ebayItemId (Browse API format `v1|<id>|0`) into a
 * canonical eBay item URL. Falls back to the raw value when the prefix
 * isn't present, so older or alternative ID shapes still link somewhere.
 */
function ebayUrlFromLotId(lotEbayItemId: string): string {
  const m = lotEbayItemId.match(/^v\d+\|(\d+)\|/);
  const id = m ? m[1] : lotEbayItemId;
  return `https://www.ebay.com/itm/${id}`;
}
