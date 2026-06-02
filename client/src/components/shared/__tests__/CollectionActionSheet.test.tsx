import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CollectionActionSheet, pickDefaultVariant } from "../CollectionActionSheet";
import type { RadiantCard } from "@/hooks/useRadiantCollection";

function card(over: Partial<RadiantCard> = {}): RadiantCard {
  return {
    id: "g1-RC1",
    name: "Chikorita",
    number: "RC1",
    rarity: "Rare",
    setId: "g1",
    setName: "Generations",
    imageSmall: "https://example.com/c.png",
    imageLarge: null,
    variants: ["holofoil", "reverseHolofoil"],
    collected: false,
    ...over,
  };
}

describe("pickDefaultVariant", () => {
  it("returns holofoil when present", () => {
    expect(pickDefaultVariant(["normal", "holofoil", "reverseHolofoil"])).toBe("holofoil");
  });
  it("falls back to the first variant when holofoil is absent", () => {
    expect(pickDefaultVariant(["normal", "reverseHolofoil"])).toBe("normal");
  });
  it("returns null on empty array (e.g. alt-arts without TCGPlayer data)", () => {
    expect(pickDefaultVariant([])).toBeNull();
  });
});

describe("CollectionActionSheet", () => {
  function setup(over: { card?: RadiantCard | null; alreadyWatching?: boolean } = {}) {
    const props = {
      card: over.card === undefined ? card() : over.card,
      alreadyWatching: over.alreadyWatching ?? false,
      isToggling: false,
      isAdding: false,
      onToggleCollected: vi.fn(),
      onAddToWatchlist: vi.fn(),
      onClose: vi.fn(),
    };
    return { props, ...render(<CollectionActionSheet {...props} />) };
  }

  it("renders nothing when card is null (sheet closed)", () => {
    setup({ card: null });
    expect(screen.queryByTestId("collection-action-sheet")).not.toBeInTheDocument();
  });

  it("renders card name + set + number", () => {
    setup();
    expect(screen.getByText("Chikorita")).toBeInTheDocument();
    expect(screen.getByText(/Generations.*RC1/)).toBeInTheDocument();
  });

  it("'Mark collected' calls onToggleCollected with the card id", () => {
    const { props } = setup();
    fireEvent.click(screen.getByTestId("action-toggle-collected"));
    expect(props.onToggleCollected).toHaveBeenCalledWith("g1-RC1");
  });

  it("'Add to watchlist' calls onAddToWatchlist with the default variant", () => {
    const { props } = setup();
    fireEvent.click(screen.getByTestId("action-add-watchlist"));
    expect(props.onAddToWatchlist).toHaveBeenCalledWith(
      expect.objectContaining({ id: "g1-RC1" }),
      "holofoil",
    );
  });

  it("disables Add button + labels it 'Already in watchlist' when alreadyWatching", () => {
    const { props } = setup({ alreadyWatching: true });
    const btn = screen.getByTestId("action-add-watchlist");
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent(/Already in watchlist/i);
    fireEvent.click(btn);
    expect(props.onAddToWatchlist).not.toHaveBeenCalled();
  });

  it("disables Add + labels 'No TCGPlayer variants' when variants is empty", () => {
    const { props } = setup({ card: card({ variants: [] }) });
    const btn = screen.getByTestId("action-add-watchlist");
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent(/No TCGPlayer variants/i);
    fireEvent.click(btn);
    expect(props.onAddToWatchlist).not.toHaveBeenCalled();
  });

  it("'Mark collected' button label flips for an already-collected card", () => {
    setup({ card: card({ collected: true }) });
    expect(screen.getByTestId("action-toggle-collected")).toHaveTextContent(
      /Mark as not collected/i,
    );
  });

  it("'Add to watchlist' label includes the chosen variant", () => {
    setup();
    expect(screen.getByTestId("action-add-watchlist")).toHaveTextContent(
      /Add to watchlist \(holofoil\)/i,
    );
  });
});
