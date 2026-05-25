import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SuggestionsPanel, type SuggestionsPanelProps } from "../SuggestionsPanel";
import type { LotSuggestion } from "@/types";

/**
 * nl6 — Component test for SuggestionsPanel.
 *
 * Covers the three render states added in the AI-failure UX work:
 *   - aiTemporarilyDown=true  → amber "AI vision is temporarily unavailable"
 *                                + Retry button (data-testid="ai-down-banner")
 *   - suggestions=null        → "Suggest cards from photos" trigger
 *   - suggestions=[]          → "No cards identified" empty state
 *   - suggestions=[...] +
 *     suggestionsWarning      → amber partial-failed warning above chips
 *                                (data-testid="partial-failed-warning")
 *
 * Stubs onRequestSuggestions / onAcceptSuggestion / etc. as vi.fn() so we
 * can assert clicks dispatch the right handler.
 */

function makeProps(over: Partial<SuggestionsPanelProps> = {}): SuggestionsPanelProps {
  return {
    aiTemporarilyDown: false,
    suggestions: null,
    suggestionsWarning: null,
    isPending: false,
    imagesCount: 5,
    acceptedSuggestionKeys: new Set<string>(),
    pickedCardIdByKey: {},
    openPickerKey: null,
    suggestionKeyFn: (s, i) => `${s.name.toLowerCase()}-${s.sourceImagePosition ?? "?"}-${i}`,
    onRequestSuggestions: vi.fn(),
    onAcceptAllHighConfidence: vi.fn(),
    onAcceptSuggestion: vi.fn(),
    onPickerOpenChange: vi.fn(),
    onPickPrinting: vi.fn(),
    onSearchFromSuggestion: vi.fn(),
    ...over,
  };
}

function suggestion(over: Partial<LotSuggestion> = {}): LotSuggestion {
  return {
    name: "charizard ex",
    quantity: 1,
    confidence: 0.85,
    setHint: null,
    cardNumber: null,
    sourceImagePosition: 0,
    candidates: [
      {
        cardId: "sv1-199",
        setName: "Scarlet & Violet 151",
        setReleaseDate: "2023-09-22",
        number: "199",
        imageSmall: null,
        market: 90,
        currency: "USD",
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SuggestionsPanel — initial state", () => {
  it("renders the 'Suggest cards from photos' button when suggestions=null", () => {
    render(<SuggestionsPanel {...makeProps()} />);
    expect(
      screen.getByRole("button", { name: /suggest cards from photos/i })
    ).toBeEnabled();
  });

  it("disables the trigger when there are no images to OCR", () => {
    render(<SuggestionsPanel {...makeProps({ imagesCount: 0 })} />);
    expect(
      screen.getByRole("button", { name: /suggest cards from photos/i })
    ).toBeDisabled();
  });

  it("fires onRequestSuggestions on click", () => {
    const onRequestSuggestions = vi.fn();
    render(
      <SuggestionsPanel {...makeProps({ onRequestSuggestions })} />
    );
    fireEvent.click(
      screen.getByRole("button", { name: /suggest cards from photos/i })
    );
    expect(onRequestSuggestions).toHaveBeenCalledOnce();
  });

  it("shows 'Analyzing photos…' label while the mutation is pending", () => {
    render(<SuggestionsPanel {...makeProps({ isPending: true })} />);
    expect(
      screen.getByRole("button", { name: /analyzing photos/i })
    ).toBeDisabled();
  });
});

describe("SuggestionsPanel — AI vision unavailable (nl6 all-failed)", () => {
  it("renders the amber 'AI vision is temporarily unavailable' banner", () => {
    render(
      <SuggestionsPanel {...makeProps({ aiTemporarilyDown: true })} />
    );
    expect(screen.getByTestId("ai-down-banner")).toBeInTheDocument();
    expect(
      screen.getByText(/AI vision is temporarily unavailable/i)
    ).toBeInTheDocument();
  });

  it("offers a Retry button that fires onRequestSuggestions", () => {
    const onRequestSuggestions = vi.fn();
    render(
      <SuggestionsPanel
        {...makeProps({ aiTemporarilyDown: true, onRequestSuggestions })}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /^retry$/i }));
    expect(onRequestSuggestions).toHaveBeenCalledOnce();
  });

  it("hides the regular 'Suggest cards' trigger while AI is down", () => {
    render(
      <SuggestionsPanel {...makeProps({ aiTemporarilyDown: true })} />
    );
    expect(
      screen.queryByRole("button", { name: /suggest cards from photos/i })
    ).not.toBeInTheDocument();
  });

  it("labels the Retry button 'Retrying…' while the mutation is pending", () => {
    render(
      <SuggestionsPanel
        {...makeProps({ aiTemporarilyDown: true, isPending: true })}
      />
    );
    expect(
      screen.getByRole("button", { name: /retrying/i })
    ).toBeDisabled();
  });
});

describe("SuggestionsPanel — empty + partial-failed states", () => {
  it("renders the 'No cards identified' empty state for suggestions=[]", () => {
    render(<SuggestionsPanel {...makeProps({ suggestions: [] })} />);
    expect(
      screen.getByText(/No cards identified in the photos/i)
    ).toBeInTheDocument();
  });

  it("renders the amber partial-failed warning above the chips", () => {
    render(
      <SuggestionsPanel
        {...makeProps({
          suggestions: [suggestion()],
          suggestionsWarning: "3 of 6 photos couldn't be analyzed.",
        })}
      />
    );
    const warn = screen.getByTestId("partial-failed-warning");
    expect(warn).toHaveTextContent("3 of 6 photos couldn't be analyzed.");
    // Chip still renders below
    expect(screen.getByText(/charizard ex/i)).toBeInTheDocument();
  });

  it("doesn't render a warning element when suggestionsWarning=null", () => {
    render(
      <SuggestionsPanel
        {...makeProps({
          suggestions: [suggestion()],
          suggestionsWarning: null,
        })}
      />
    );
    expect(
      screen.queryByTestId("partial-failed-warning")
    ).not.toBeInTheDocument();
  });
});

describe("SuggestionsPanel — duplicate chips stay independent (ytf)", () => {
  it("uses the chip's array INDEX in the key so even two identical (name, position) chips get distinct keys", () => {
    const onPickerOpenChange = vi.fn();
    // Worst case: two chips with the SAME name AND same sourceImagePosition.
    // Pre-fix this collapsed both to one key; post-fix the index disambiguates.
    const a = suggestion({ name: "mega latias ex", sourceImagePosition: 0 });
    const b = suggestion({ name: "mega latias ex", sourceImagePosition: 0 });
    render(
      <SuggestionsPanel
        {...makeProps({
          suggestions: [a, b],
          openPickerKey: null,
          onPickerOpenChange,
        })}
      />
    );
    const dots = screen.getAllByRole("button", {
      name: /Pick a different printing|Change printing/i,
    });
    expect(dots).toHaveLength(2);
    fireEvent.click(dots[1]);
    const [key, open] = onPickerOpenChange.mock.calls[0];
    expect(open).toBe(true);
    // Second chip is at index 1
    expect(key).toBe("mega latias ex-0-1");
  });

  it("only the chip whose key is in acceptedSuggestionKeys renders the 'Change printing' state", () => {
    render(
      <SuggestionsPanel
        {...makeProps({
          suggestions: [
            suggestion({ name: "mega latias ex", sourceImagePosition: 0 }),
            suggestion({ name: "mega latias ex", sourceImagePosition: 0 }),
          ],
          // Only chip-at-index-0's key
          acceptedSuggestionKeys: new Set(["mega latias ex-0-0"]),
        })}
      />
    );
    const changeButtons = screen.getAllByRole("button", {
      name: /Change printing/i,
    });
    const pickButtons = screen.getAllByRole("button", {
      name: /Pick a different printing/i,
    });
    expect(changeButtons).toHaveLength(1);
    expect(pickButtons).toHaveLength(1);
  });

  it("only opens the picker for the chip whose key matches openPickerKey", () => {
    render(
      <SuggestionsPanel
        {...makeProps({
          suggestions: [
            suggestion({ name: "mega latias ex", sourceImagePosition: 0 }),
            suggestion({ name: "mega latias ex", sourceImagePosition: 0 }),
          ],
          // Only the SECOND chip's key
          openPickerKey: "mega latias ex-0-1",
        })}
      />
    );
    // Radix renders the open Popover.Content with role=dialog. We only
    // expect ONE open popover even though both chips share name+position.
    const popovers = screen.getAllByRole("dialog");
    expect(popovers).toHaveLength(1);
  });
});

describe("SuggestionsPanel — 'Add all high-confidence' shortcut", () => {
  it("appears when at least one suggestion has confidence >= 0.8", () => {
    render(
      <SuggestionsPanel
        {...makeProps({ suggestions: [suggestion({ confidence: 0.9 })] })}
      />
    );
    expect(
      screen.getByRole("button", { name: /add all high-confidence/i })
    ).toBeInTheDocument();
  });

  it("is hidden when every suggestion is below 0.8", () => {
    render(
      <SuggestionsPanel
        {...makeProps({ suggestions: [suggestion({ confidence: 0.5 })] })}
      />
    );
    expect(
      screen.queryByRole("button", { name: /add all high-confidence/i })
    ).not.toBeInTheDocument();
  });
});
