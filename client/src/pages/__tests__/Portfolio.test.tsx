import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * eb6 — Component test for the Portfolio (cost-basis) page.
 *
 * Mocks usePortfolio/useCreatePortfolioItem/useDeletePortfolioItem plus the
 * catalog search hook (used by the add-item dialog) and TopNav's own
 * dependencies, then checks the loading/error/empty states, summary bar,
 * item rendering, and the delete confirmation flow.
 */

const {
  usePortfolioMock,
  createMutate,
  deleteMutate,
  useCatalogSearchMock,
} = vi.hoisted(() => ({
  usePortfolioMock: vi.fn(),
  createMutate: vi.fn(),
  deleteMutate: vi.fn(),
  useCatalogSearchMock: vi.fn(),
}));

vi.mock("@/hooks/usePortfolio", () => ({
  usePortfolio: usePortfolioMock,
  useCreatePortfolioItem: () => ({ mutate: createMutate, isPending: false }),
  useUpdatePortfolioItem: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletePortfolioItem: () => ({ mutate: deleteMutate, isPending: false }),
}));

vi.mock("@/hooks/useCatalog", () => ({
  useCatalogSearch: useCatalogSearchMock,
}));

vi.mock("@/hooks/useAlerts", () => ({
  useUnreadAlertsCount: () => ({ data: { unread: 0 } }),
}));
vi.mock("@/components/shared/NotificationDrawer", () => ({
  NotificationDrawer: () => null,
}));

import Portfolio from "../Portfolio";
import type { PortfolioResponse } from "@/types";

function setHook(state: { data?: PortfolioResponse; isLoading?: boolean; error?: unknown }) {
  usePortfolioMock.mockReturnValue({
    data: state.data,
    isLoading: state.isLoading ?? false,
    error: state.error ?? null,
  });
}

function sampleResponse(): PortfolioResponse {
  return {
    items: [
      {
        id: "item-1",
        cardId: "base1-4",
        label: "Charizard",
        setName: "Base Set",
        number: "4",
        imageSmall: null,
        variant: "holofoil",
        kind: "raw",
        gradingCompany: null,
        grade: null,
        quantity: 1,
        acquisitionPrice: 100,
        acquiredAt: "2026-01-01T00:00:00.000Z",
        notes: null,
        totalCost: 100,
        currentMarket: 150,
        currentValue: 150,
        unrealizedPnl: 50,
        priceCurrency: "USD",
        priceSource: "tcgplayer",
      },
      {
        id: "item-2",
        cardId: null,
        label: "Booster Box",
        setName: null,
        number: null,
        imageSmall: null,
        variant: null,
        kind: "sealed",
        gradingCompany: null,
        grade: null,
        quantity: 1,
        acquisitionPrice: 120,
        acquiredAt: "2026-01-01T00:00:00.000Z",
        notes: null,
        totalCost: 120,
        currentMarket: null,
        currentValue: null,
        unrealizedPnl: null,
        priceCurrency: null,
        priceSource: "none",
      },
    ],
    summary: { count: 2, pricedCount: 1, totalCost: 220, totalValue: 150, totalPnl: 50 },
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Portfolio />
    </MemoryRouter>,
  );
}

describe("Portfolio page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCatalogSearchMock.mockReturnValue({ data: [], isFetching: false, isError: false });
  });

  it("renders the loading skeleton state", () => {
    setHook({ isLoading: true });
    renderPage();
    expect(screen.getByRole("heading", { name: "Portfolio" })).toBeInTheDocument();
  });

  it("renders an error banner when the query errors", () => {
    setHook({ error: new Error("boom") });
    renderPage();
    expect(screen.getByText(/Couldn't load your portfolio/i)).toBeInTheDocument();
  });

  it("renders the empty state when there are no items", () => {
    setHook({ data: { items: [], summary: { count: 0, pricedCount: 0, totalCost: 0, totalValue: 0, totalPnl: 0 } } });
    renderPage();
    expect(screen.getByText(/No items yet/i)).toBeInTheDocument();
  });

  it("renders the summary bar with cost, value, and P&L", () => {
    setHook({ data: sampleResponse() });
    renderPage();
    expect(screen.getByText("$220.00")).toBeInTheDocument(); // cost basis (unique — item rows show "Paid $100.00" and "$120.00" separately)
    expect(screen.getAllByText("$150.00").length).toBeGreaterThan(0); // current value (summary stat + item row both show it)
    expect(screen.getAllByText("+$50.00").length).toBeGreaterThan(0); // P&L (summary stat + item row both show it)
    expect(screen.getByText(/1 unpriced item excluded/i)).toBeInTheDocument();
  });

  it("renders one row per item with label, kind badge, and P&L", () => {
    setHook({ data: sampleResponse() });
    renderPage();
    expect(screen.getByText("Charizard")).toBeInTheDocument();
    expect(screen.getByText("Booster Box")).toBeInTheDocument();
    expect(screen.getByText("Raw")).toBeInTheDocument();
    expect(screen.getByText("Sealed")).toBeInTheDocument();
    expect(screen.getByText("— unpriced")).toBeInTheDocument();
  });

  it("opens a confirm dialog and deletes on confirm", () => {
    setHook({ data: sampleResponse() });
    renderPage();
    fireEvent.click(screen.getByLabelText("Remove Charizard"));
    expect(screen.getByText(/Remove from portfolio/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Remove"));
    expect(deleteMutate).toHaveBeenCalledWith("item-1");
  });

  it("opens the add-item dialog from the header button", () => {
    setHook({ data: sampleResponse() });
    renderPage();
    fireEvent.click(screen.getByText("Add item"));
    expect(screen.getByText("Add to portfolio")).toBeInTheDocument();
  });
});
