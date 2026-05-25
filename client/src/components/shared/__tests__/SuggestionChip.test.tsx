import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { SuggestionChip } from "../LotAnalyzerModal";
import type { LotSuggestion } from "@/types";

/**
 * 36g — integration test: SuggestionChip wiring through PrintingPicker.
 *
 * Asserts that the chip's two affordances (fast-accept body vs. ⋯ picker
 * trigger) route to the right callbacks, and that picking a non-default
 * candidate from the popover surfaces the chosen cardId — not the AI's
 * default candidates[0].cardId — back to the parent (which then routes
 * through useSaveAnnotation in production).
 *
 * The chip is rendered inside a small controlled-state harness that mirrors
 * the parent's openPickerName + pickedCardIdByName state, so the picker
 * actually opens when the user clicks ⋯ (rather than asserting against a
 * pre-opened popover).
 */

function makeSuggestion(): LotSuggestion {
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
        imageSmall: null,
        market: 15.2,
        currency: "USD",
      },
      {
        cardId: "swsh8-269",
        setName: "Fusion Strike",
        setReleaseDate: "2021-11-12",
        number: "269",
        imageSmall: null,
        market: 215.3,
        currency: "USD",
      },
    ],
  };
}

function Harness({
  onAccept,
  onPick,
  onSearch,
  initiallyAccepted = false,
  initialCurrentCardId,
}: {
  onAccept: () => void;
  onPick: (cardId: string) => void;
  onSearch: (name: string) => void;
  initiallyAccepted?: boolean;
  initialCurrentCardId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <SuggestionChip
      suggestion={makeSuggestion()}
      accepted={initiallyAccepted}
      currentCardId={initialCurrentCardId}
      pickerOpen={open}
      onPickerOpenChange={setOpen}
      onAccept={onAccept}
      onPick={onPick}
      onSearch={onSearch}
    />
  );
}

describe("SuggestionChip — wiring with PrintingPicker", () => {
  it("body click fires onAccept (fast path) without opening the picker", () => {
    const onAccept = vi.fn();
    const onPick = vi.fn();
    render(
      <Harness onAccept={onAccept} onPick={onPick} onSearch={vi.fn()} />
    );

    // The body button is the one labelled by the suggestion name
    fireEvent.click(screen.getByText("Mew Vmax"));

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("⋯ opens the picker; selecting a non-AI candidate fires onPick with that cardId", () => {
    const onAccept = vi.fn();
    const onPick = vi.fn();
    render(
      <Harness onAccept={onAccept} onPick={onPick} onSearch={vi.fn()} />
    );

    // No printing rows visible yet
    expect(screen.queryByTestId("printing-row-swsh8-269")).not.toBeInTheDocument();

    // Click the ⋯ button — Radix opens the popover (anchored to it)
    fireEvent.click(screen.getByRole("button", { name: /Pick a different printing/ }));

    // Now the picker rows are present
    const fusionStrikeRow = screen.getByTestId("printing-row-swsh8-269");
    expect(fusionStrikeRow).toBeInTheDocument();

    // Pick the Fusion Strike alt art (NOT the AI's default which is swsh8-base)
    fireEvent.click(fusionStrikeRow);

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith("swsh8-269");
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("when accepted, the body click is disabled but ⋯ stays usable for 'Change printing'", () => {
    const onAccept = vi.fn();
    const onPick = vi.fn();
    render(
      <Harness
        onAccept={onAccept}
        onPick={onPick}
        onSearch={vi.fn()}
        initiallyAccepted
        initialCurrentCardId="swsh8-base"
      />
    );

    // Body click on accepted chip is a no-op (the button is disabled)
    const bodyBtn = screen.getByText("Mew Vmax").closest("button")!;
    expect(bodyBtn).toBeDisabled();

    // ⋯ has the "Change printing" aria label when chip is accepted
    const moreBtn = screen.getByRole("button", { name: /Change printing/ });
    fireEvent.click(moreBtn);

    // Pick a different printing
    fireEvent.click(screen.getByTestId("printing-row-swsh8-269"));
    expect(onPick).toHaveBeenCalledWith("swsh8-269");
  });
});
