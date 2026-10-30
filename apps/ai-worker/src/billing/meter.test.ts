import { describe, expect, it } from "vitest";
import { computeCostIDR, type Pricing } from "./meter.js";

const pricing: Pricing = { inUsdPerM: 0.28, outUsdPerM: 0.42, usdIdr: 17900, margin: 1.75 };

describe("computeCostIDR", () => {
  it("menghitung modal x kurs x margin", () => {
    // (1000*0.28 + 500*0.42)/1e6 = 0.00049 USD -> *17900 = 8.771 IDR -> *1.75 = 15.35
    expect(computeCostIDR({ promptTokens: 1000, completionTokens: 500 }, pricing)).toBe(15.35);
  });

  it("token nol = biaya nol", () => {
    expect(computeCostIDR({ promptTokens: 0, completionTokens: 0 }, pricing)).toBe(0);
  });

  it("margin 1 = harga modal murni", () => {
    const raw = computeCostIDR({ promptTokens: 1000, completionTokens: 500 }, { ...pricing, margin: 1 });
    expect(raw).toBe(8.77);
  });

  it("token output lebih mahal dari input", () => {
    const input = computeCostIDR({ promptTokens: 1000, completionTokens: 0 }, pricing);
    const output = computeCostIDR({ promptTokens: 0, completionTokens: 1000 }, pricing);
    expect(output).toBeGreaterThan(input);
  });

  it("tidak pernah negatif", () => {
    expect(computeCostIDR({ promptTokens: 1, completionTokens: 1 }, pricing)).toBeGreaterThanOrEqual(0);
  });
});
