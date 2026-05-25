/**
 * utd — Pure formatter for CHANGELOG.md entries.
 *
 * Takes a list of conventional commits and returns a rendered markdown
 * block of date-stamped sections. Used by scripts/changelog.mjs (which
 * handles git IO + file writing) so the formatting logic can be unit-
 * tested without touching git or the filesystem.
 *
 * Commit subjects look like:
 *   feat(lots): A3 — bulk-rarity bucketing for unidentified cards (yam)
 *   fix(ux): backdrop click closes image lightbox (n5f follow-up)
 *
 * Only `feat:` and `fix:` are surfaced. Everything else (build, chore,
 * test, docs, refactor, bd, etc) is silently dropped.
 */

const SUBJECT_RE = /^(feat|fix)(?:\(([^)]+)\))?:\s*(.+?)\s*$/i;

/**
 * Parse one commit subject. Returns null when the subject is not a
 * user-visible (feat|fix) conventional-commit line.
 *
 * @param {string} subject
 * @returns {{type: 'feat'|'fix', scope: string|null, message: string} | null}
 */
export function parseSubject(subject) {
  const m = SUBJECT_RE.exec(subject);
  if (!m) return null;
  const type = m[1].toLowerCase();
  if (type !== "feat" && type !== "fix") return null;
  return {
    type,
    scope: m[2] ? m[2].trim() : null,
    message: m[3].trim(),
  };
}

/**
 * Group commits by date (YYYY-MM-DD UTC), preserving input order
 * within each group.
 *
 * @param {Array<{sha: string, date: string, subject: string}>} commits
 *   date is ISO-8601 with timezone, e.g. "2026-05-25T13:14:42-07:00"
 * @returns {Array<{date: string, items: Array<{type: string, scope: string|null, message: string, sha: string}>}>}
 *   sorted DESC by date (most recent first)
 */
export function groupByDate(commits) {
  const byDate = new Map();
  for (const c of commits) {
    const parsed = parseSubject(c.subject);
    if (!parsed) continue;
    // Use the date portion of the ISO timestamp — already YYYY-MM-DD when
    // truncated. Slice avoids Date construction (timezone gotchas).
    const day = c.date.slice(0, 10);
    if (!byDate.has(day)) byDate.set(day, []);
    byDate.get(day).push({ ...parsed, sha: c.sha });
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, items]) => ({ date, items }));
}

/**
 * Render a single commit as a bullet point. Scope and message both
 * carry through verbatim — the user's commit messages are already
 * the right grain ("A3 — bulk-rarity ..." stays as-is).
 *
 * Example output:
 *   - **lots:** A3 — bulk-rarity bucketing for unidentified cards (yam)
 */
function renderItem(item) {
  const scopePrefix = item.scope ? `**${item.scope}:** ` : "";
  return `- ${scopePrefix}${item.message}`;
}

/**
 * Render the changelog block for a list of grouped-by-date commits.
 * Returns an empty string when nothing qualifies — caller decides
 * whether to print "Nothing to add" or no-op.
 *
 * @param {ReturnType<typeof groupByDate>} groups
 * @returns {string}
 */
export function renderGroups(groups) {
  if (groups.length === 0) return "";
  const sections = [];
  for (const { date, items } of groups) {
    const feats = items.filter((i) => i.type === "feat");
    const fixes = items.filter((i) => i.type === "fix");
    const parts = [`## ${date}`];
    if (feats.length > 0) {
      parts.push("");
      parts.push("### Added");
      for (const f of feats) parts.push(renderItem(f));
    }
    if (fixes.length > 0) {
      parts.push("");
      parts.push("### Fixed");
      for (const f of fixes) parts.push(renderItem(f));
    }
    sections.push(parts.join("\n"));
  }
  return sections.join("\n\n");
}

/**
 * Convenience: parse + group + render in one call.
 * @param {Array<{sha: string, date: string, subject: string}>} commits
 * @returns {string}
 */
export function formatEntries(commits) {
  return renderGroups(groupByDate(commits));
}
