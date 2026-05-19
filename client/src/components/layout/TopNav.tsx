import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, BookMarked, LogOut, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

const NAV_LINKS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/watchlist", label: "Watchlist", icon: BookMarked },
];

/**
 * Top navigation bar shared across all authenticated pages.
 * Shows brand logo, nav links, and a sign-out button.
 */
export function TopNav() {
  const { pathname } = useLocation();

  function handleSignOut() {
    localStorage.removeItem("token");
    window.location.href = "/login";
  }

  return (
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
  );
}
