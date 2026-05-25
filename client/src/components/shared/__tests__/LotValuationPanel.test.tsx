import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LotValuationPanel } from "../LotValuationPanel";
import type { LotRevaluation } from "@/types";

function valuation(over: Partial<LotRevaluation> = {}): LotRevaluation {
  return {
    autoLowEstimate: 0,
    autoHighEstimate: 0,
    withAnnotationLowEstimate: 180,
    withAnnotationHighEstimate: 420,
    addedCardSummaries: [
      { cardId: "a", name: "x", setName: "s", number: "1", market: 100, quantity: 1, note: null },
      { cardId: "b", name: "y", setName: "s", number: "2", market: 200, quantity: 1, note: null },
    ],
    ...over,
  };
}

describe("LotValuationPanel", () => {
  it("renders nothing when valuation is null", () => {
    const { container } = render(
      <LotValuationPanel lotTotalCost={250} valuation={null} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when midpoint market is 0 (no cards priced)", () => {
    const { container } = render(
      <LotValuationPanel
        lotTotalCost={250}
        valuation={valuation({
          withAnnotationLowEstimate: 0,
          withAnnotationHighEstimate: 0,
        })}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the positive-deal headline when lot price is below midpoint", () => {
    // midpoint = (180+420)/2 = 300; deltaPct = (300-250)/300 = +16.67%
    render(<LotValuationPanel lotTotalCost={250} valuation={valuation()} />);
    expect(screen.getByTestId("lot-valuation-panel")).toBeInTheDocument();
    expect(screen.getByText("$250.00")).toBeInTheDocument();
    expect(screen.getByText(/\$180\.00.*\$420\.00/)).toBeInTheDocument();
    // Positive deal renders with a +N% badge
    expect(screen.getByText(/\+17%/)).toBeInTheDocument();
    expect(screen.getByText(/2 cards identified/)).toBeInTheDocument();
  });

  it("renders the negative-deal badge when lot price exceeds midpoint", () => {
    // midpoint=300, lot=500 → -67%
    render(<LotValuationPanel lotTotalCost={500} valuation={valuation()} />);
    expect(screen.getByText(/-67%/)).toBeInTheDocument();
  });

  it("uses singular 'card identified' for count=1", () => {
    render(
      <LotValuationPanel
        lotTotalCost={50}
        valuation={valuation({
          addedCardSummaries: [
            {
              cardId: "a",
              name: "x",
              setName: "s",
              number: "1",
              market: 100,
              quantity: 1,
              note: null,
            },
          ],
        })}
      />
    );
    expect(screen.getByText(/1 card identified/)).toBeInTheDocument();
  });
});
