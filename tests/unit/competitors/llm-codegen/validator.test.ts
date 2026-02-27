import { describe, expect, it } from "bun:test";
import { SAMPLE_STATISTICS } from "../../../../src/competitors/llm-codegen/sample-statistics.ts";
import { validateGeneratedCode } from "../../../../src/competitors/llm-codegen/validator.ts";

const validEngineCode = `import type { PredictionOutput } from "../../domain/contracts/prediction";
import type { Statistics } from "../../domain/contracts/statistics";

const engine = (statistics: Statistics): PredictionOutput[] => [{
  marketId: statistics.market.marketId,
  side: "YES",
  confidence: 0.65,
  stake: 4,
  reasoning: "Test prediction engine"
}];

export default engine;`;

const noDefaultExport = `export function engine() { return []; }`;

const wrongReturnType = `const engine = () => "not an array";
export default engine;`;

const throwingEngine = `const engine = () => { throw new Error("Runtime crash"); };
export default engine;`;

const invalidPredictionFields = `const engine = (stats) => [{
  marketId: stats.market.marketId,
  side: "MAYBE",
  confidence: 2.5,
  stake: -1,
  reasoning: ""
}];
export default engine;`;

const emptyArrayEngine = `const engine = () => [];
export default engine;`;

describe("validateGeneratedCode", () => {
  it("accepts valid engine code", async () => {
    const result = await validateGeneratedCode(validEngineCode);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(typeof result.engine).toBe("function");
    }
  });

  it("valid engine produces correct output against sample statistics", async () => {
    const result = await validateGeneratedCode(validEngineCode);
    expect(result.valid).toBe(true);
    if (result.valid) {
      const output = await result.engine(SAMPLE_STATISTICS);
      expect(output).toHaveLength(1);
      const first = output[0] as { marketId: string };
      expect(first.marketId).toBe(SAMPLE_STATISTICS.market.marketId);
    }
  });

  it("rejects code without default export", async () => {
    const result = await validateGeneratedCode(noDefaultExport);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("default function");
    }
  });

  it("rejects code that returns wrong type", async () => {
    const result = await validateGeneratedCode(wrongReturnType);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("array");
    }
  });

  it("rejects code that throws at runtime", async () => {
    const result = await validateGeneratedCode(throwingEngine);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("Runtime crash");
    }
  });

  it("rejects code with invalid prediction field values", async () => {
    const result = await validateGeneratedCode(invalidPredictionFields);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("validation failed");
    }
  });

  it("rejects code that returns empty array", async () => {
    const result = await validateGeneratedCode(emptyArrayEngine);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("empty");
    }
  });

  it("rejects syntax errors", async () => {
    const result = await validateGeneratedCode("const x = {{{invalid syntax");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("Import failed");
    }
  });
});
