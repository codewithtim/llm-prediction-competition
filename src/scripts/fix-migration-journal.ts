/**
 * Fix migration journal timestamp ordering.
 *
 * drizzle-kit generate uses Date.now() for the `when` field, but some
 * migrations have manually-set future timestamps. This means a newly
 * generated migration can end up chronologically *before* an earlier
 * entry, breaking migration ordering.
 *
 * This script ensures all `when` values are monotonically increasing.
 *
 * Usage:
 *   bun run src/scripts/fix-migration-journal.ts
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

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

function main() {
  const raw = readFileSync(JOURNAL_PATH, "utf-8");
  const journal: Journal = JSON.parse(raw);

  let changed = false;

  for (let i = 1; i < journal.entries.length; i++) {
    const prev = journal.entries[i - 1]!;
    const curr = journal.entries[i]!;

    if (curr.when <= prev.when) {
      const fixed = prev.when + 1000;
      console.log(`Fixed entry ${curr.idx} (${curr.tag}): ${curr.when} -> ${fixed}`);
      curr.when = fixed;
      changed = true;
    }
  }

  if (changed) {
    writeFileSync(JOURNAL_PATH, JSON.stringify(journal, null, 2) + "\n");
    console.log("Journal timestamps fixed.");
  } else {
    console.log("Journal timestamps already in order.");
  }
}

main();
