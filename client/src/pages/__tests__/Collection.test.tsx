import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * hpx — Component test for the Radiant Collection page.
 * cxu — Extended: tap opens an action sheet with toggle + add-to-watchlist.
 *
 * Mocks the three hooks the page depends on (useRadiantCollection,
 * useToggleCollection, useCreateCard, useCards) and verifies the page
 * renders correctly + tapping a tile opens the action sheet + the sheet's
 * actions invoke the right mutations.
 */

const { useCollectionMock, toggleMutate, createMutate, useCardsMock } = vi.hoisted(() => ({
  useCollectionMock: vi.fn(),
  toggleMutate: vi.fn(),
  createMutate: vi.fn(),
  useCardsMock: vi.fn(),
}));

vi.mock("@/hooks/useRadiantCollection", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useRadiantCollection")>(
    "@/hooks/useRadiantCollection",
  );
  return {
    ...actual,
    useRadiantCollection: useCollectionMock,
    useToggleCollection: () => ({
      mutate: toggleMutate,
      isPending: false,
      variables: undefined as string | undefined,
    }),
  };
});

vi.mock("@/hooks/useCards", () => ({
  useCards: useCardsMock,
  useCreateCard: () => ({ mutate: createMutate, isPending: false }),
}));

// Stub TopNav's dependencies — they pull in react-query + alert hooks that
// would otherwise need their own mocks. The nav isn't what's under test.
vi.mock("@/hooks/useAlerts", () => ({
  useUnreadAlertsCount: () => ({ data: { unread: 0 } }),
}));
vi.mock("@/components/shared/NotificationDrawer", () => ({
  NotificationDrawer: () => null,
}));

import Collection from "../Collection";
import type { RadiantCollectionResponse } from "@/hooks/useRadiantCollection";

function setHook(state: { data?: RadiantCollectionResponse; isLoading?: boolean; error?: unknown }) {
  useCollectionMock.mockReturnValue({
    data: state.data,
    isLoading: state.isLoading ?? false,
    error: state.error ?? null,
  });
}

function sampleResponse(): RadiantCollectionResponse {
  return {
    total: 57,
    collected: 1,
    sets: [
      {
        setId: "g1",
        setName: "Generations",
        total: 32,
        collected: 1,
        cards: [
          {
            id: "g1-rc1",
            name: "Charmander",
            number: "RC1",
            rarity: "Rare",
            setId: "g1",
            setName: "Generations",
            imageSmall: "https://example.com/rc1.png",
            imageLarge: null,
            variants: ["holofoil"],
            collected: true,
          },
          {
            id: "g1-rc2",
            name: "Charmeleon",
            number: "RC2",
            rarity: "Rare",
            setId: "g1",
            setName: "Generations",
            imageSmall: "https://example.com/rc2.png",
            imageLarge: null,
            variants: ["holofoil", "reverseHolofoil"],
            collected: false,
          },
        ],
      },
      {
        setId: "bw11",
        setName: "Legendary Treasures",
        total: 25,
        collected: 0,
        cards: [],
      },
    ],
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Collection />
    </MemoryRouter>,
  );
}

describe("Collection page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCardsMock.mockReturnValue({ data: [] });
  });

  it("renders the loading skeleton state", () => {
    setHook({ isLoading: true });
    renderPage();
    expect(screen.getByText(/Radiant Collection/i)).toBeInTheDocument();
    // No tiles when loading
    expect(screen.queryAllByTestId("radiant-card-tile")).toHaveLength(0);
  });

  it("renders an error banner when the query errors", () => {
    setHook({ error: new Error("boom") });
    renderPage();
    expect(screen.getByText(/Couldn't load the collection/i)).toBeInTheDocument();
  });

  it("renders the progress headline and per-set counts", () => {
    setHook({ data: sampleResponse() });
    renderPage();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "57");
    expect(screen.getByText("57 collected", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Generations")).toBeInTheDocument();
    expect(screen.getByText("Legendary Treasures")).toBeInTheDocument();
  });

  it("marks collected vs not-collected tiles via data-collected", () => {
    setHook({ data: sampleResponse() });
    renderPage();
    const tiles = screen.getAllByTestId("radiant-card-tile");
    expect(tiles).toHaveLength(2);
    const rc1 = tiles.find((t) => t.getAttribute("aria-label")?.includes("RC1"));
    const rc2 = tiles.find((t) => t.getAttribute("aria-label")?.includes("RC2"));
    expect(rc1?.getAttribute("data-collected")).toBe("true");
    expect(rc2?.getAttribute("data-collected")).toBe("false");
    expect(rc1?.getAttribute("aria-pressed")).toBe("true");
    expect(rc2?.getAttribute("aria-pressed")).toBe("false");
  });

  it("opens the action sheet on tap (does not toggle directly)", () => {
    setHook({ data: sampleResponse() });
    renderPage();
    const tiles = screen.getAllByTestId("radiant-card-tile");
    const rc2 = tiles.find((t) => t.getAttribute("aria-label")?.includes("RC2"))!;
    fireEvent.click(rc2);
    expect(toggleMutate).not.toHaveBeenCalled();
    expect(screen.getByTestId("collection-action-sheet")).toBeInTheDocument();
    expect(screen.getByText("Charmeleon")).toBeInTheDocument();
  });

  it("action sheet's 'Mark collected' button invokes toggle mutation", () => {
    setHook({ data: sampleResponse() });
    renderPage();
    const tiles = screen.getAllByTestId("radiant-card-tile");
    fireEvent.click(tiles.find((t) => t.getAttribute("aria-label")?.includes("RC2"))!);
    fireEvent.click(screen.getByTestId("action-toggle-collected"));
    expect(toggleMutate).toHaveBeenCalledWith("g1-rc2");
  });

  it("action sheet's 'Add to watchlist' button invokes createCard with the default variant", () => {
    setHook({ data: sampleResponse() });
    renderPage();
    const tiles = screen.getAllByTestId("radiant-card-tile");
    fireEvent.click(tiles.find((t) => t.getAttribute("aria-label")?.includes("RC2"))!);
    fireEvent.click(screen.getByTestId("action-add-watchlist"));
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        pokemonTcgId: "g1-rc2",
        variant: "holofoil",
        cardName: "Charmeleon",
        setName: "Generations",
        cardNumber: "RC2",
      }),
      expect.any(Object),
    );
  });

  it("disables 'Add to watchlist' when the user already watches the card+variant", () => {
    setHook({ data: sampleResponse() });
    useCardsMock.mockReturnValue({
      data: [{ pokemonTcgId: "g1-rc2", variant: "holofoil" }],
    });
    renderPage();
    const tiles = screen.getAllByTestId("radiant-card-tile");
    fireEvent.click(tiles.find((t) => t.getAttribute("aria-label")?.includes("RC2"))!);
    const addBtn = screen.getByTestId("action-add-watchlist");
    expect(addBtn).toBeDisabled();
    expect(addBtn).toHaveTextContent(/Already in watchlist/i);
  });
});
