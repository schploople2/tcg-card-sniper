import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, BookMarked, LogOut, Zap, Bell, Settings as SettingsIcon, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUnreadAlertsCount } from "@/hooks/useAlerts";
import { NotificationDrawer } from "@/components/shared/NotificationDrawer";

const NAV_LINKS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/watchlist", label: "Watchlist", icon: BookMarked },
  { to: "/collection", label: "Collection", icon: Sparkles },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

/**
 * Top navigation bar shared across all authenticated pages.
 * Shows brand logo, nav links, alert bell, and sign-out.
 */
export function TopNav() {
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Poll the unread count every 60s. The hook also fires a sonner toast
  // when the count *increases* during the session — that's our pseudo-push.
  const { data: countData } = useUnreadAlertsCount();
  const unread = countData?.unread ?? 0;

  function handleSignOut() {
    localStorage.removeItem("token");
    window.location.href = "/login";
  }

  return (
    // Fragment so the slide-over drawer mounts as a SIBLING of <header>,
    // not a descendant. <header> uses `backdrop-blur`, which creates a CSS
    // containing block — that broke `position: fixed` on the drawer, clipping
    // it to the 56px-tall header bar. Moving it out of <header> restores
    // viewport-relative positioning.
    <>
    <header className="sticky top-0 z-40 w-full border-b border-slate-800 bg-[#0a0f1e]/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
        {/* Brand */}
        <Link
          to="/"
          className="flex items-center gap-2 text-[#F5C518] font-bold text-lg tracking-tight shrink-0"
        >
          <Zap className="h-5 w-5 fill-current" />
          TCG Sniper
        </Link>

        {/* Nav links */}
        <nav className="flex items-center gap-1">
          {NAV_LINKS.map(({ to, label, icon: Icon }) => {
            const active = pathname === to;
            return (
              <Link
                key={to}
                to={to}
                className={[
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200",
                ].join(" ")}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Alert bell with unread badge. Positioned to the left of sign-out
            so it remains visible even on narrow viewports. */}
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="relative inline-flex items-center justify-center rounded-md p-2 text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 transition"
          aria-label={unread > 0 ? `${unread} unread alerts` : "Alerts"}
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white"
              aria-hidden
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>

        {/* Sign out */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSignOut}
          className="text-slate-400 hover:text-red-400 hover:bg-red-900/20"
        >
          <LogOut className="h-4 w-4 mr-1.5" />
          Sign out
        </Button>
      </div>

    </header>

    {/* Slide-over drawer — rendered as a sibling so `position: fixed`
        children escape the header's backdrop-blur stacking context. */}
    <NotificationDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}
