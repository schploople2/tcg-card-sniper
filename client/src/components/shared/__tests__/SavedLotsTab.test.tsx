import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * u8y — SavedLotsTab component tests.
 *
 * Hooks (useSavedLots, useDeleteSavedLot) are mocked at the import
 * boundary so we exercise just the three render states + the row's
 * delete + analyze handlers.
 */

const { useSavedLotsMock, useDeleteSavedLotMock, deleteMutate } = vi.hoisted(
  () => ({
    useSavedLotsMock: vi.fn(),
    useDeleteSavedLotMock: vi.fn(),
    deleteMutate: vi.fn(),
  })
);

vi.mock("@/hooks/useSavedLots", async () => {
  const actual = await vi.importActual<
    typeof import("@/hooks/useSavedLots")
  >("@/hooks/useSavedLots");
  return {
    ...actual,
    useSavedLots: useSavedLotsMock,
    useDeleteSavedLot: useDeleteSavedLotMock,
  };
});

import { SavedLotsTab } from "../SavedLotsTab";
import type { SavedLot } from "@/hooks/useSavedLots";

function row(over: Partial<SavedLot> = {}): SavedLot {
  return {
    id: "id-1",
    ebayItemId: "v1|111|0",
    title: "Pokemon LOT w/ Binder + S&V",
    imageUrl: "https://i.example/x.jpg",
    ebayUrl: "https://www.ebay.com/itm/111",
    listingPrice: "45.00",
    note: null,
    createdAt: new Date(Date.now() - 2 * 86400_000).toISOString(),
    ...over,
  };
}

function setSavedLots(state: {
  data?: { savedLots: SavedLot[] };
  isLoading?: boolean;
  error?: unknown;
}) {
  useSavedLotsMock.mockReturnValue({
    data: state.data,
    isLoading: state.isLoading ?? false,
    error: state.error ?? null,
  });
}

beforeEach(() => {
  useSavedLotsMock.mockReset();
  useDeleteSavedLotMock.mockReset();
  deleteMutate.mockReset();
  useDeleteSavedLotMock.mockReturnValue({ mutate: deleteMutate, isPending: false });
});

describe("SavedLotsTab", () => {
  it("renders the loading state while isLoading=true", () => {
    setSavedLots({ isLoading: true });
    render(<SavedLotsTab onAnalyze={vi.fn()} />);
    expect(screen.getByText(/Loading saved lots/i)).toBeInTheDocument();
  });

  it("renders the amber error message when the hook errors", () => {
    setSavedLots({ error: new Error("nope"), data: undefined });
    render(<SavedLotsTab onAnalyze={vi.fn()} />);
    expect(screen.getByText(/Couldn't load saved lots/i)).toBeInTheDocument();
  });

  it("renders the empty state when there are no saved lots", () => {
    setSavedLots({ data: { savedLots: [] } });
    render(<SavedLotsTab onAnalyze={vi.fn()} />);
    expect(screen.getByText(/No saved lots yet/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Tap the bookmark icon on any lot/i)
    ).toBeInTheDocument();
  });

  it("renders a row per saved lot with title + price + image", () => {
    setSavedLots({
      data: {
        savedLots: [
          row({ id: "a", title: "First lot", listingPrice: "45.00" }),
          row({
            id: "b",
            ebayItemId: "v1|222|0",
            title: "Second lot",
            listingPrice: "99.95",
            imageUrl: null,
          }),
        ],
      },
    });
    render(<SavedLotsTab onAnalyze={vi.fn()} />);

    expect(screen.getAllByTestId("saved-lot-row")).toHaveLength(2);
    expect(screen.getByText("First lot")).toBeInTheDocument();
    expect(screen.getByText("Second lot")).toBeInTheDocument();
    expect(screen.getByText(/\$45\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\$99\.95/)).toBeInTheDocument();
  });

  it("fires delete mutation when the row trash icon is clicked", () => {
    setSavedLots({ data: { savedLots: [row({ id: "abc" })] } });
    render(<SavedLotsTab onAnalyze={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /remove from saved/i }));
    expect(deleteMutate).toHaveBeenCalledWith("abc");
  });

  it("fires onAnalyze with a shadow Lot when the Analyze button is clicked", () => {
    const onAnalyze = vi.fn();
    setSavedLots({
      data: {
        savedLots: [
          row({
            id: "abc",
            ebayItemId: "v1|999|0",
            title: "Binder lot",
            listingPrice: "60.00",
          }),
        ],
      },
    });
    render(<SavedLotsTab onAnalyze={onAnalyze} />);
    fireEvent.click(screen.getByRole("button", { name: /analyze/i }));
    expect(onAnalyze).toHaveBeenCalledOnce();
    const arg = onAnalyze.mock.calls[0][0];
    expect(arg).toMatchObject({
      ebayItemId: "v1|999|0",
      title: "Binder lot",
      listingPrice: 60,
      totalCost: 60,
      parsedCards: [],
      lotTier: "UNSCORED",
    });
  });
});
