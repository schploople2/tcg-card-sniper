import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PrintingPicker } from "../PrintingPicker";
import type { LotSuggestion } from "@/types";

/**
 * ex4 — focused unit tests on PrintingPicker in isolation.
 *
 * Renders the popover in `open=true` state with a trigger child, asserts
 * the candidate rows render with their content, AI badge lands on the
 * first row, and clicks emit the right cardId. Empty-state behaviour is
 * covered too.
 */

function makeSuggestion(overrides: Partial<LotSuggestion> = {}): LotSuggestion {
  return {
    name: "Mew Vmax",
    quantity: 1,
    confidence: 0.9,
    setHint: null,
    cardNumber: null,
    sourceImagePosition: 0,
    candidates: [
      {
        cardId: "swsh8-base",
        setName: "Sword & Shield",
        setReleaseDate: "2020-02-07",
        number: "114",
        market: 15.2,
        currency: "USD",
      },
      {
        cardId: "swsh8-269",
        setName: "Fusion Strike",
        setReleaseDate: "2021-11-12",
        number: "269",
        market: 215.3,
        currency: "USD",
      },
      {
        cardId: "promo-1",
        setName: "Pokémon GO Promo",
        setReleaseDate: null,
        number: "P1",
        market: null,
        currency: "USD",
      },
    ],
    ...overrides,
  };
}

function renderPicker(props: Partial<React.ComponentProps<typeof PrintingPicker>> = {}) {
  const onPick = vi.fn();
  const onSearch = vi.fn();
  const onOpenChange = vi.fn();
  const utils = render(
    <PrintingPicker
      suggestion={makeSuggestion()}
      open={true}
      onOpenChange={onOpenChange}
      onPick={onPick}
      onSearch={onSearch}
      {...props}
    >
      <button type="button">trigger</button>
    </PrintingPicker>
  );
  return { ...utils, onPick, onSearch, onOpenChange };
}

describe("PrintingPicker", () => {
  it("renders one row per candidate with set, year, number, and price", () => {
    renderPicker();

    // All three candidate rows are present
    expect(screen.getByTestId("printing-row-swsh8-base")).toBeInTheDocument();
    expect(screen.getByTestId("printing-row-swsh8-269")).toBeInTheDocument();
    expect(screen.getByTestId("printing-row-promo-1")).toBeInTheDocument();

    // Set names + release years
    expect(screen.getByText(/Sword & Shield/)).toBeInTheDocument();
    expect(screen.getByText(/2020/)).toBeInTheDocument();
    expect(screen.getByText(/Fusion Strike/)).toBeInTheDocument();
    expect(screen.getByText(/2021/)).toBeInTheDocument();

    // Card numbers
    expect(screen.getByText("#114")).toBeInTheDocument();
    expect(screen.getByText("#269")).toBeInTheDocument();
    expect(screen.getByText("#P1")).toBeInTheDocument();

    // Markets: $15.20 and $215.30 formatted; null candidate shows "—"
    expect(screen.getByText(/\$15\.20/)).toBeInTheDocument();
    expect(screen.getByText(/\$215\.30/)).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("puts the AI badge on the first candidate and only the first", () => {
    renderPicker();
    const badges = screen.getAllByText("AI");
    expect(badges).toHaveLength(1);
    // Badge should be inside the first candidate's row
    const firstRow = screen.getByTestId("printing-row-swsh8-base");
    expect(firstRow).toContainElement(badges[0]);
  });

  it("emits onPick with the chosen cardId (not the AI's first candidate)", () => {
    const { onPick, onOpenChange } = renderPicker();

    // User clicks the Fusion Strike alt-art row (not the AI's pick)
    fireEvent.click(screen.getByTestId("printing-row-swsh8-269"));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith("swsh8-269");
    // Picker should also request to close itself
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders the empty state when no candidates and clicking search fires onSearch with the suggestion name", () => {
    const { onSearch } = renderPicker({
      suggestion: makeSuggestion({ candidates: [] }),
    });

    expect(screen.getByText(/No catalog printings found/)).toBeInTheDocument();
    const searchBtn = screen.getByRole("button", {
      name: /Search the full catalog/,
    });
    fireEvent.click(searchBtn);
    expect(onSearch).toHaveBeenCalledWith("Mew Vmax");
  });

  it("when currentCardId is provided, the matching row gets the 'current pick' highlight", () => {
    renderPicker({ currentCardId: "swsh8-269" });

    // The Fusion Strike row should have the emerald highlight class
    const currentRow = screen.getByTestId("printing-row-swsh8-269");
    expect(currentRow.className).toMatch(/emerald-900/);

    // Other rows should not
    const aiRow = screen.getByTestId("printing-row-swsh8-base");
    expect(aiRow.className).not.toMatch(/emerald-900/);
  });
});
