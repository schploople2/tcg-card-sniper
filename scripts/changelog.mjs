#!/usr/bin/env node
/**
 * utd — CHANGELOG.md generator from conventional commits.
 *
 * Reads recent git commits, filters to `feat:` / `fix:` subjects only,
 * groups by UTC date, and prepends new sections to CHANGELOG.md above
 * any existing dated sections. Idempotent: re-running with no new
 * commits is a no-op (and prints a small "nothing to add" note).
 *
 * Marker:
 *   <!-- changelog-marker: <sha> -->
 * stores the last-processed commit SHA. First run (no marker) processes
 * the entire history.
 *
 * Usage:
 *   pnpm changelog
 *   node scripts/changelog.mjs
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { formatEntries } from "./changelog-format.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");
const CHANGELOG_PATH = path.join(REPO_ROOT, "CHANGELOG.md");
const MARKER_RE = /<!-- changelog-marker:\s*([a-f0-9]+)\s*-->/i;

const HEADER = `# Changelog

All notable user-visible changes to TCG Card Sniper. Generated from
conventional commits — run \`pnpm changelog\` to refresh from git.

`;

function git(cmd) {
  return execSync(cmd, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
}

function readExisting() {
  if (!existsSync(CHANGELOG_PATH)) {
    return { body: "", lastSha: null, hadHeader: false };
  }
  const raw = readFileSync(CHANGELOG_PATH, "utf8");
  const m = raw.match(MARKER_RE);
  const lastSha = m ? m[1] : null;
  // Strip header + marker so the caller can rebuild the file cleanly.
  // Anything after the marker line is "existing dated sections".
  const afterMarker = m ? raw.slice(m.index + m[0].length).replace(/^\n+/, "") : "";
  return { body: afterMarker, lastSha, hadHeader: true };
}

/**
 * Get commits since `sinceSha` (exclusive). When sinceSha is null,
 * returns the full history. Tab-delimited so we can split safely
 * around subject lines that contain colons / dashes / parens.
 */
function getCommits(sinceSha) {
  const range = sinceSha ? `${sinceSha}..HEAD` : "HEAD";
  // %H = full sha; %aI = author date strict-ISO; %s = subject
  let out;
  try {
    out = git(`git log ${range} --format=%H%x09%aI%x09%s`);
  } catch (err) {
    // The marker SHA may not exist in this checkout (rebase, force-push).
    // Fall back to full history with a warning.
    console.warn(
      `[changelog] marker SHA ${sinceSha} not found in history — backfilling from scratch`
    );
    out = git(`git log HEAD --format=%H%x09%aI%x09%s`);
  }
  if (!out) return [];
  return out.split("\n").map((line) => {
    const [sha, date, ...rest] = line.split("\t");
    return { sha, date, subject: rest.join("\t") };
  });
}

function main() {
  const headSha = git("git rev-parse HEAD");
  const { body, lastSha } = readExisting();

  if (lastSha === headSha) {
    console.log("[changelog] already up to date (marker at HEAD)");
    return;
  }

  const commits = getCommits(lastSha);
  const newSection = formatEntries(commits);

  if (!newSection) {
    console.log(
      `[changelog] no new user-visible (feat/fix) commits since ${lastSha ?? "<initial>"}`
    );
    // Still bump the marker so we don't re-scan the same commits next run.
    const next =
      HEADER +
      `<!-- changelog-marker: ${headSha} -->\n` +
      (body ? `\n${body}` : "");
    writeFileSync(CHANGELOG_PATH, next);
    return;
  }

  const next =
    HEADER +
    `<!-- changelog-marker: ${headSha} -->\n\n` +
    newSection +
    (body ? `\n\n${body}` : "\n");

  writeFileSync(CHANGELOG_PATH, next);
  // Count the new entries for a friendly summary line.
  const addedCount = (newSection.match(/^- /gm) || []).length;
  console.log(
    `[changelog] wrote ${addedCount} new entr${addedCount === 1 ? "y" : "ies"} to CHANGELOG.md (marker → ${headSha.slice(0, 7)})`
  );
}

main();
