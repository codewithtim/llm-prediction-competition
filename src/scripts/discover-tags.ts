/**
 * Discover Tags — diagnostic script for Polymarket tag/sport mappings.
 *
 * Calls Gamma API /sports and /tags, prints mappings so we can
 * verify which tag IDs correspond to which leagues.
 *
 * Usage:
 *   bun run discover:tags
 */

import { createGammaClient } from "../apis/polymarket/gamma-client.ts";

async function main() {
  const gamma = createGammaClient();

  console.log("Fetching sports...\n");
  const sports = await gamma.getSports();

  console.log(`Found ${sports.length} sports:\n`);
  console.log("ID   | Sport                        | Tags");
  console.log("-----|------------------------------|---------------------");
  for (const sport of sports) {
    const id = String(sport.id).padEnd(4);
    const name = sport.sport.padEnd(30);
    console.log(`${id} | ${name} | ${sport.tags}`);
  }

  console.log("\n\nFetching tags...\n");
  const tags = await gamma.getTags();

  console.log(`Found ${tags.length} tags:\n`);
  console.log("ID       | Label                        | Slug");
  console.log("---------|------------------------------|---------------------");
  for (const tag of tags) {
    const id = String(tag.id).padEnd(8);
    const label = tag.label.padEnd(30);
    console.log(`${id} | ${label} | ${tag.slug}`);
  }

  // Cross-reference: find football-related tags
  const footballKeywords = [
    "football",
    "soccer",
    "epl",
    "premier",
    "la liga",
    "serie",
    "bundesliga",
    "ligue",
  ];
  const footballTags = tags.filter((t) =>
    footballKeywords.some(
      (kw) => t.label.toLowerCase().includes(kw) || t.slug.toLowerCase().includes(kw),
    ),
  );

  if (footballTags.length > 0) {
    console.log("\n\nFootball-related tags:");
    console.log("------");
    for (const tag of footballTags) {
      console.log(`  ${tag.id}: ${tag.label} (${tag.slug})`);
    }
  }
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
