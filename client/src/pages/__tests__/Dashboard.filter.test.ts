import { describe, it, expect } from "vitest";
import {
  filterRowsByGroup,
  GROUP_FILTER_ALL,
  GROUP_FILTER_UNGROUPED,
} from "../Dashboard";

/**
 * bk7 — Pure-helper test for the Dashboard's Group filter. The Dashboard
 * itself is too heavy to mount in a unit test (many hooks, deep tree),
 * so the filter math is extracted as `filterRowsByGroup` and covered
 * here. Mounting + visual checks happen in the manual smoke test.
 */

type Row = { id: string; groupId: string | null };

const rows: Row[] = [
  { id: "l1", groupId: "g-priority" },
  { id: "l2", groupId: "g-longterm" },
  { id: "l3", groupId: null },
  { id: "l4", groupId: "g-priority" },
  { id: "l5", groupId: null },
];

describe("filterRowsByGroup", () => {
  it("returns input unchanged when value is ALL (no filter)", () => {
    expect(filterRowsByGroup(rows, GROUP_FILTER_ALL)).toBe(rows);
  });

  it("returns only ungrouped rows when value is UNGROUPED", () => {
    const out = filterRowsByGroup(rows, GROUP_FILTER_UNGROUPED);
    expect(out.map((r) => r.id)).toEqual(["l3", "l5"]);
  });

  it("filters by a specific group id", () => {
    const out = filterRowsByGroup(rows, "g-priority");
    expect(out.map((r) => r.id)).toEqual(["l1", "l4"]);
  });

  it("returns an empty array when no row matches the filter", () => {
    expect(filterRowsByGroup(rows, "nope-not-real")).toEqual([]);
  });

  it("preserves row order within the filtered subset", () => {
    const out = filterRowsByGroup(rows, "g-priority");
    expect(out[0].id).toBe("l1");
    expect(out[1].id).toBe("l4");
  });

  it("handles an empty input list cleanly", () => {
    expect(filterRowsByGroup([] as Row[], "g-priority")).toEqual([]);
    expect(filterRowsByGroup([] as Row[], GROUP_FILTER_UNGROUPED)).toEqual([]);
    expect(filterRowsByGroup([] as Row[], GROUP_FILTER_ALL)).toEqual([]);
  });
});
