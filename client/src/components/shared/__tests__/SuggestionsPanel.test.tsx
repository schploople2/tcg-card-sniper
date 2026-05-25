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
    pickedCardIdByName: {},
    openPickerName: null,
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
