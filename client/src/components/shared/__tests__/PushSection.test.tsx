import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * B2 (rcs) — Component test for the Push Notifications section of the
 * Settings page. Drives the entire state machine exposed by
 * `usePushSubscription` and asserts the right copy + buttons render
 * for each state, and that user clicks fire the right callbacks.
 */

const { useMock, subscribe, unsubscribe } = vi.hoisted(() => ({
  useMock: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("@/hooks/usePushSubscription", () => ({
  usePushSubscription: useMock,
}));

// PushSection is exported from Settings.tsx; importing the parent module
// would pull in every other settings section + their hooks. Pull just the
// piece we need so the test stays narrow.
import { PushSection } from "@/pages/Settings";

type Status = "loading" | "unsupported" | "denied" | "default" | "subscribed";

function setHook(state: Partial<{ status: Status; busy: boolean }> = {}) {
  useMock.mockReturnValue({
    status: state.status ?? "default",
    busy: state.busy ?? false,
    subscribe,
    unsubscribe,
  });
}

beforeEach(() => {
  useMock.mockReset();
  subscribe.mockReset();
  unsubscribe.mockReset();
});

describe("PushSection", () => {
  it("renders 'Checking browser support…' in the loading state", () => {
    setHook({ status: "loading" });
    render(<PushSection />);
    expect(screen.getByText(/Checking browser support/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /enable push/i })
    ).not.toBeInTheDocument();
  });

  it("renders the unsupported fallback when status='unsupported'", () => {
    setHook({ status: "unsupported" });
    render(<PushSection />);
    expect(
      screen.getByText(/does not support web push/i)
    ).toBeInTheDocument();
  });

  it("renders the denied warning when status='denied' and offers no button", () => {
    setHook({ status: "denied" });
    render(<PushSection />);
    expect(
      screen.getByText(/Notifications are blocked for this site/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /enable push/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /disable/i })
    ).not.toBeInTheDocument();
  });

  it("renders the Enable button in the default state and fires subscribe on click", () => {
    setHook({ status: "default" });
    render(<PushSection />);
    const btn = screen.getByRole("button", { name: /enable push notifications/i });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(subscribe).toHaveBeenCalledOnce();
  });

  it("disables the Enable button while busy=true and labels it 'Enabling…'", () => {
    setHook({ status: "default", busy: true });
    render(<PushSection />);
    const btn = screen.getByRole("button", { name: /enabling/i });
    expect(btn).toBeDisabled();
  });

  it("renders subscribed confirmation + Disable button when status='subscribed'", () => {
    setHook({ status: "subscribed" });
    render(<PushSection />);
    expect(
      screen.getByText(/Subscribed on this device/i)
    ).toBeInTheDocument();
    const disable = screen.getByRole("button", { name: /disable/i });
    fireEvent.click(disable);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(subscribe).not.toHaveBeenCalled();
  });
});
