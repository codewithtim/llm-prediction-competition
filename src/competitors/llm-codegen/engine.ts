import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { PredictionEngine } from "../../engine/types.ts";

export async function loadCodegenEngine(enginePath: string): Promise<PredictionEngine> {
  const absolutePath = resolve(enginePath);
  const mod = (await import(absolutePath)) as Record<string, unknown>;

  if (typeof mod.default !== "function") {
    throw new Error(`Engine at ${enginePath} does not export a default function`);
  }

  return mod.default as PredictionEngine;
}

export async function saveGeneratedEngine(params: {
  competitorId: string;
  code: string;
  version?: number;
}): Promise<string> {
  const engineDir = resolve("src/competitors", params.competitorId);
  await mkdir(engineDir, { recursive: true });

  const filename = params.version ? `engine_v${params.version}.ts` : "engine.ts";
  const enginePath = resolve(engineDir, filename);
  await Bun.write(enginePath, params.code);

  return enginePath;
}
