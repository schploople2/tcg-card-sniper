import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * hpx — Component test for the Radiant Collection page.
 *
 * Mocks useRadiantCollection + useToggleCollection and verifies the
 * collected/not-collected rendering, the progress headline, and that
 * tapping a tile invokes the toggle mutation with the right cardId.
 */

const { useCollectionMock, toggleMutate } = vi.hoisted(() => ({
  useCollectionMock: vi.fn(),
  toggleMutate: vi.fn(),
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

  it("calls toggle mutation with the card id on tap", () => {
    setHook({ data: sampleResponse() });
    renderPage();
    const tiles = screen.getAllByTestId("radiant-card-tile");
    const rc2 = tiles.find((t) => t.getAttribute("aria-label")?.includes("RC2"))!;
    fireEvent.click(rc2);
    expect(toggleMutate).toHaveBeenCalledWith("g1-rc2");
  });
});
