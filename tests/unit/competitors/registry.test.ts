import { describe, expect, it } from "bun:test";
import { createRegistry } from "../../../src/competitors/registry";

const stubEngine = () => [];

describe("CompetitorRegistry", () => {
  it("registers and retrieves an engine", () => {
    const registry = createRegistry();
    registry.register("comp-1", "Competitor One", stubEngine);

    const engine = registry.get("comp-1");
    expect(engine).toBeDefined();
    expect(engine?.competitorId).toBe("comp-1");
    expect(engine?.name).toBe("Competitor One");
    expect(engine?.engine).toBe(stubEngine);
  });

  it("returns all registered engines", () => {
    const registry = createRegistry();
    registry.register("comp-1", "First", stubEngine);
    registry.register("comp-2", "Second", stubEngine);

    const all = registry.getAll();
    expect(all).toHaveLength(2);
    expect(all.map((e) => e.competitorId)).toContain("comp-1");
    expect(all.map((e) => e.competitorId)).toContain("comp-2");
  });

  it("returns undefined for unregistered ID", () => {
    const registry = createRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("returns all engines when multiple are registered", () => {
    const registry = createRegistry();
    registry.register("a", "Alpha", stubEngine);
    registry.register("b", "Beta", stubEngine);
    registry.register("c", "Gamma", stubEngine);

    expect(registry.getAll()).toHaveLength(3);
  });
});
