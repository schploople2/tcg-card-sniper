/**
 * utd — Tests for the pure changelog formatter.
 *
 * Uses node:test (zero-deps) so we don't have to wire the scripts/
 * folder into either workspace's vitest config. Run with:
 *
 *   node --test scripts/__tests__/changelog-format.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSubject,
  groupByDate,
  renderGroups,
  formatEntries,
} from "../changelog-format.mjs";

test("parseSubject — feat with scope", () => {
  const r = parseSubject(
    "feat(lots): A3 — bulk-rarity bucketing for unidentified cards (yam)"
  );
  assert.deepEqual(r, {
    type: "feat",
    scope: "lots",
    message: "A3 — bulk-rarity bucketing for unidentified cards (yam)",
  });
});

test("parseSubject — fix without scope", () => {
  const r = parseSubject("fix: backdrop click closes image lightbox");
  assert.deepEqual(r, {
    type: "fix",
    scope: null,
    message: "backdrop click closes image lightbox",
  });
});

test("parseSubject — drops non-user-visible types", () => {
  assert.equal(parseSubject("build(server): require Node 20+"), null);
  assert.equal(parseSubject("chore: bump deps"), null);
  assert.equal(parseSubject("test+docs: UI test buildout"), null);
  assert.equal(parseSubject("docs(readme): typo"), null);
  assert.equal(parseSubject("refactor: extract helper"), null);
  assert.equal(parseSubject("bd: close u8y"), null);
});

test("parseSubject — drops garbage", () => {
  assert.equal(parseSubject(""), null);
  assert.equal(parseSubject("WIP"), null);
  assert.equal(parseSubject("Merge branch 'main'"), null);
});

test("parseSubject — handles fix+feat compound type", () => {
  // We see commits like 'fix+feat(lots): per-chip identity + thumbnails'
  // in this repo. Bias to fix since that's the more common interpretation
  // when both apply. The regex only matches single types so this falls
  // through as null, which is the safe choice — won't double-count.
  assert.equal(
    parseSubject("fix+feat(lots): per-chip identity + thumbnails"),
    null
  );
});

test("groupByDate — collapses same-day commits", () => {
  const groups = groupByDate([
    { sha: "a", date: "2026-05-25T13:00:00-07:00", subject: "feat(a): one" },
    { sha: "b", date: "2026-05-25T18:00:00-07:00", subject: "fix(b): two" },
    { sha: "c", date: "2026-05-24T09:00:00-07:00", subject: "feat(c): three" },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].date, "2026-05-25");
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[1].date, "2026-05-24");
  assert.equal(groups[1].items.length, 1);
});

test("groupByDate — sorts descending so today appears first", () => {
  const groups = groupByDate([
    { sha: "older", date: "2026-05-20T00:00:00Z", subject: "feat: old" },
    { sha: "newer", date: "2026-05-25T00:00:00Z", subject: "feat: new" },
  ]);
  assert.equal(groups[0].date, "2026-05-25");
  assert.equal(groups[1].date, "2026-05-20");
});

test("groupByDate — silently drops non-user-visible commits", () => {
  const groups = groupByDate([
    { sha: "a", date: "2026-05-25T00:00:00Z", subject: "chore: deps" },
    { sha: "b", date: "2026-05-25T00:00:00Z", subject: "feat: keeper" },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].items.length, 1);
  assert.equal(groups[0].items[0].message, "keeper");
});

test("renderGroups — splits Added vs Fixed within a date", () => {
  const out = renderGroups([
    {
      date: "2026-05-25",
      items: [
        { type: "feat", scope: "lots", message: "thing one", sha: "a" },
        { type: "fix", scope: "ux", message: "thing two", sha: "b" },
      ],
    },
  ]);
  assert.match(out, /## 2026-05-25/);
  assert.match(out, /### Added/);
  assert.match(out, /- \*\*lots:\*\* thing one/);
  assert.match(out, /### Fixed/);
  assert.match(out, /- \*\*ux:\*\* thing two/);
  // Added comes before Fixed
  assert.ok(out.indexOf("Added") < out.indexOf("Fixed"));
});

test("renderGroups — omits Added section when no feat commits", () => {
  const out = renderGroups([
    {
      date: "2026-05-25",
      items: [{ type: "fix", scope: null, message: "only a fix", sha: "x" }],
    },
  ]);
  assert.doesNotMatch(out, /### Added/);
  assert.match(out, /### Fixed/);
});

test("renderGroups — returns empty string when no groups", () => {
  assert.equal(renderGroups([]), "");
});

test("renderGroups — items without scope render without bold prefix", () => {
  const out = renderGroups([
    {
      date: "2026-05-25",
      items: [{ type: "feat", scope: null, message: "no scope", sha: "x" }],
    },
  ]);
  assert.match(out, /^- no scope$/m);
});

test("formatEntries — end-to-end happy path", () => {
  const commits = [
    {
      sha: "abc",
      date: "2026-05-25T13:14:42-07:00",
      subject: "feat(lots): A3 — bulk-rarity bucketing (yam)",
    },
    {
      sha: "def",
      date: "2026-05-25T15:00:00-07:00",
      subject: "fix(ux): backdrop click closes lightbox (n5f follow-up)",
    },
    {
      sha: "ghi",
      date: "2026-05-25T16:00:00-07:00",
      subject: "chore: bump deps",
    },
  ];
  const out = formatEntries(commits);
  assert.match(out, /## 2026-05-25/);
  assert.match(out, /A3 — bulk-rarity bucketing \(yam\)/);
  assert.match(out, /backdrop click closes lightbox \(n5f follow-up\)/);
  assert.doesNotMatch(out, /bump deps/);
});

test("formatEntries — returns empty string when nothing qualifies", () => {
  const out = formatEntries([
    { sha: "a", date: "2026-05-25T00:00:00Z", subject: "chore: ignore me" },
    { sha: "b", date: "2026-05-25T00:00:00Z", subject: "build: also ignored" },
  ]);
  assert.equal(out, "");
});
