/**
 * Fix migration journal timestamp ordering.
 *
 * drizzle-kit generate uses Date.now() for the `when` field, but if any
 * previous entry has a manually-set future timestamp, a newly generated
 * migration ends up chronologically *before* it — causing the Drizzle
 * migrator to silently skip it.
 *
 * This script ensures:
 *   1. All `when` values are monotonically increasing (by idx order).
 *   2. No `when` value is in the future (capped at Date.now()).
 *
 * Called automatically by `db:generate` and `db:migrate`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const JOURNAL_PATH = resolve(import.meta.dirname, "../../drizzle/meta/_journal.json");

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

export function fixMigrationJournal(): boolean {
  const raw = readFileSync(JOURNAL_PATH, "utf-8");
  const journal: Journal = JSON.parse(raw);

  const now = Date.now();
  let changed = false;

  for (let i = 0; i < journal.entries.length; i++) {
    const curr = journal.entries[i] as JournalEntry;
    const prev = journal.entries[i - 1] as JournalEntry | undefined;

    // Cap future timestamps to now (with room for ordering)
    const maxTs = now - (journal.entries.length - i);
    if (curr.when > maxTs) {
      const fixed = prev ? Math.max(prev.when + 1, maxTs) : maxTs;
      console.log(
        `Fixed entry ${curr.idx} (${curr.tag}): future timestamp ${curr.when} -> ${fixed}`,
      );
      curr.when = fixed;
      changed = true;
    }

    // Ensure monotonically increasing relative to previous entry
    if (prev && curr.when <= prev.when) {
      const fixed = prev.when + 1;
      console.log(`Fixed entry ${curr.idx} (${curr.tag}): out-of-order ${curr.when} -> ${fixed}`);
      curr.when = fixed;
      changed = true;
    }
  }

  if (changed) {
    writeFileSync(JOURNAL_PATH, `${JSON.stringify(journal, null, 2)}\n`);
    console.log("Journal timestamps fixed.");
  }

  return changed;
}

// Run directly
if (import.meta.main) {
  const changed = fixMigrationJournal();
  if (!changed) {
    console.log("Journal timestamps already in order.");
  }
}
