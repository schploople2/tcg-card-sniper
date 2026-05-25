import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BulkValuationPanel } from "../BulkValuationPanel";

/**
 * A3 (yam) — Component test for BulkValuationPanel.
 *
 * Covers the hide-when-empty branch, the singular/plural pluralization
 * helpers, and the per-bucket breakdown line.
 */

describe("BulkValuationPanel", () => {
  it("renders nothing when valuation is null", () => {
    const { container } = render(
      <BulkValuationPanel counts={null} valuation={null} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when totalCards is 0", () => {
    const { container } = render(
      <BulkValuationPanel
        counts={{ commons: 0, uncommons: 0, rares: 0, holos: 0 }}
        valuation={{
          totalCards: 0,
          low: 0,
          mid: 0,
          high: 0,
          byBucket: { commons: 0, uncommons: 0, rares: 0, holos: 0 },
        }}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the headline + range + mid for a multi-bucket lot", () => {
    render(
      <BulkValuationPanel
        counts={{ commons: 10, uncommons: 4, rares: 2, holos: 1 }}
        valuation={{
          totalCards: 17,
          low: 1.85,
          mid: 3.5,
          high: 7.45,
          byBucket: { commons: 0.2, uncommons: 0.32, rares: 1.0, holos: 1.5 },
        }}
      />
    );
    expect(screen.getByTestId("bulk-valuation-panel")).toBeInTheDocument();
    expect(screen.getByText(/≈ 17 unidentified cards/)).toBeInTheDocument();
    expect(screen.getByText(/\$1\.85 – \$7\.45/)).toBeInTheDocument();
    expect(screen.getByText(/mid \$3\.50/)).toBeInTheDocument();
    expect(
      screen.getByText(/10 commons · 4 uncommons · 2 rares · 1 holo/)
    ).toBeInTheDocument();
  });

  it("uses singular for count=1", () => {
    render(
      <BulkValuationPanel
        counts={{ commons: 1, uncommons: 0, rares: 0, holos: 0 }}
        valuation={{
          totalCards: 1,
          low: 0.01,
          mid: 0.02,
          high: 0.05,
          byBucket: { commons: 0.02, uncommons: 0, rares: 0, holos: 0 },
        }}
      />
    );
    expect(screen.getByText(/≈ 1 unidentified card$/)).toBeInTheDocument();
    expect(screen.getByText("1 common")).toBeInTheDocument();
  });

  it("omits buckets with zero count from the breakdown line", () => {
    render(
      <BulkValuationPanel
        counts={{ commons: 0, uncommons: 0, rares: 0, holos: 3 }}
        valuation={{
          totalCards: 3,
          low: 3,
          mid: 4.5,
          high: 9,
          byBucket: { commons: 0, uncommons: 0, rares: 0, holos: 4.5 },
        }}
      />
    );
    expect(screen.getByText("3 holos")).toBeInTheDocument();
    expect(screen.queryByText(/common/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/uncommon/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\brares?\b/i)).not.toBeInTheDocument();
  });
});
