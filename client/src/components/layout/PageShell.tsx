import type { ReactNode } from "react";
import { TopNav } from "./TopNav";

interface PageShellProps {
  children: ReactNode;
}

/**
 * Wraps every authenticated page with TopNav + centered content container.
 */
export function PageShell({ children }: PageShellProps) {
  return (
    <div className="min-h-screen bg-[#0a0f1e] text-slate-100">
      <TopNav />
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
