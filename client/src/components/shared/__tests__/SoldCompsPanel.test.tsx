import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * C1 (l6x) — Component test for SoldCompsPanel.
 *
 * Mocks useSoldComps directly and walks the four render states the
 * panel can be in: loading, error, empty, populated. Verifies the
 * summary headline math is rendered straight from the hook (we don't
 * recompute median in the component) and that the per-row content
 * appears.
 */

const { useMock, refetch } = vi.hoisted(() => ({
  useMock: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("@/hooks/useSoldComps", () => ({
  useSoldComps: useMock,
}));

import { SoldCompsPanel } from "../SoldCompsPanel";
import type { SoldCompsResponse } from "@/hooks/useSoldComps";

function setHook(
  state: Partial<{
    data: SoldCompsResponse | undefined;
    isLoading: boolean;
    isFetching: boolean;
    error: unknown;
  }> = {}
) {
  useMock.mockReturnValue({
    data: state.data,
    isLoading: state.isLoading ?? false,
    isFetching: state.isFetching ?? false,
    error: state.error ?? null,
    refetch,
  });
}

function happyResponse(): SoldCompsResponse {
  return {
    query: "pikachu vmax 188",
    summary: {
      count: 3,
      median: 320,
      low: 280,
      high: 400,
      mostRecentAt: new Date(Date.now() - 86_400_000).toISOString(),
    },
    byGrade: [],
    rows: [
      {
        ebayItemId: "111",
        title: "Pikachu VMAX 188/185 Rainbow Rare",
        soldPrice: 280,
        shippingCost: 0,
        totalPrice: 280,
        conditionGrade: "NM",
        gradeLabel: null,
        acceptedOffer: false,
        soldAt: new Date(Date.now() - 86_400_000).toISOString(),
        imageUrl: "https://i.example/a.jpg",
        ebayUrl: "https://www.ebay.com/itm/111",
      },
      {
        ebayItemId: "222",
        title: "Pikachu VMAX PSA 10 BO sale",
        soldPrice: 300,
        shippingCost: 4.95,
        totalPrice: 304.95,
        conditionGrade: "GRADED",
        gradeLabel: "PSA 10",
        acceptedOffer: true,
        soldAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        imageUrl: null,
        ebayUrl: "https://www.ebay.com/itm/222",
      },
    ],
    fromCache: true,
  };
}

beforeEach(() => {
  useMock.mockReset();
  refetch.mockReset();
});

describe("SoldCompsPanel", () => {
  it("renders 'Loading sold comps…' while isLoading=true", () => {
    setHook({ isLoading: true });
    render(<SoldCompsPanel cardId="card-1" enabled />);
    expect(screen.getByText(/Loading sold comps/i)).toBeInTheDocument();
  });

  it("renders the amber error message when the hook returns an error", () => {
    setHook({ error: new Error("network"), data: undefined });
    render(<SoldCompsPanel cardId="card-1" enabled />);
    expect(
      screen.getByText(/Couldn't load sold comps/i)
    ).toBeInTheDocument();
  });

  it("renders the empty state when summary.count === 0", () => {
    setHook({
      data: {
        query: "obscure card 999",
        summary: {
          count: 0,
          median: null,
          low: null,
          high: null,
          mostRecentAt: null,
        },
        byGrade: [],
        rows: [],
        fromCache: false,
      },
    });
    render(<SoldCompsPanel cardId="card-1" enabled />);
    expect(
      screen.getByText(/No sold comps in the last 90 days/i)
    ).toBeInTheDocument();
    expect(screen.getByText("obscure card 999")).toBeInTheDocument();
  });

  it("renders the summary headline + per-row data on the happy path", () => {
    setHook({ data: happyResponse() });
    render(<SoldCompsPanel cardId="card-1" enabled />);

    expect(screen.getByText(/Median sold/i)).toBeInTheDocument();
    expect(screen.getByText("$320.00")).toBeInTheDocument();
    expect(screen.getByText(/Range \$280\.00.*\$400\.00/)).toBeInTheDocument();
    expect(screen.getByText(/3 comps · cached/)).toBeInTheDocument();

    expect(screen.getAllByTestId("sold-comp-row")).toHaveLength(2);
    expect(
      screen.getByText("Pikachu VMAX 188/185 Rainbow Rare")
    ).toBeInTheDocument();
    expect(screen.getByText("$280.00")).toBeInTheDocument();
    expect(screen.getByText("$304.95")).toBeInTheDocument();
  });

  it("renders 'BO' badge only for rows with acceptedOffer=true", () => {
    setHook({ data: happyResponse() });
    render(<SoldCompsPanel cardId="card-1" enabled />);
    const boBadges = screen.getAllByText("BO");
    expect(boBadges).toHaveLength(1);
  });

  it("fires refetch when the refresh button is clicked", () => {
    setHook({ data: happyResponse() });
    render(<SoldCompsPanel cardId="card-1" enabled />);
    fireEvent.click(
      screen.getByRole("button", { name: /refresh sold comps/i })
    );
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("renders 'fresh' indicator when fromCache=false", () => {
    setHook({ data: { ...happyResponse(), fromCache: false } });
    render(<SoldCompsPanel cardId="card-1" enabled />);
    expect(screen.getByText(/3 comps · fresh/)).toBeInTheDocument();
  });
});

describe("SoldCompsPanel — by-grade breakdown (C2)", () => {
  it("hides the breakdown card when byGrade is empty", () => {
    setHook({ data: happyResponse() }); // happyResponse default byGrade = []
    render(<SoldCompsPanel cardId="card-1" enabled />);
    expect(
      screen.queryByTestId("by-grade-breakdown")
    ).not.toBeInTheDocument();
  });

  it("renders one row per grade, sorted as returned by server", () => {
    setHook({
      data: {
        ...happyResponse(),
        byGrade: [
          {
            gradeLabel: "PSA 10",
            count: 3,
            median: 420,
            low: 380,
            high: 460,
            mostRecentAt: new Date().toISOString(),
          },
          {
            gradeLabel: "PSA 9",
            count: 2,
            median: 165,
            low: 150,
            high: 180,
            mostRecentAt: new Date().toISOString(),
          },
          {
            gradeLabel: "BGS 9.5",
            count: 1,
            median: 310,
            low: 310,
            high: 310,
            mostRecentAt: new Date().toISOString(),
          },
        ],
      },
    });
    render(<SoldCompsPanel cardId="card-1" enabled />);
    expect(screen.getByTestId("by-grade-breakdown")).toBeInTheDocument();
    expect(screen.getByTestId("by-grade-row-PSA-10")).toBeInTheDocument();
    expect(screen.getByTestId("by-grade-row-PSA-9")).toBeInTheDocument();
    expect(screen.getByTestId("by-grade-row-BGS-9.5")).toBeInTheDocument();
    expect(screen.getByText("$420.00")).toBeInTheDocument();
    expect(screen.getByText(/3 sales/)).toBeInTheDocument();
    expect(screen.getByText(/1 sale\b/)).toBeInTheDocument(); // singular
  });

  it("renders specific gradeLabel on per-row badge when present, falls back to conditionGrade otherwise", () => {
    setHook({ data: happyResponse() });
    render(<SoldCompsPanel cardId="card-1" enabled />);
    // Row 1: gradeLabel=null, conditionGrade="NM" → badge shows "NM"
    expect(screen.getByText("NM")).toBeInTheDocument();
    // Row 2: gradeLabel="PSA 10", conditionGrade="GRADED" → badge shows "PSA 10" (not "GRADED")
    expect(screen.getByText("PSA 10")).toBeInTheDocument();
    expect(screen.queryByText("GRADED")).not.toBeInTheDocument();
  });
});
