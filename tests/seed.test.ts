import { describe, expect, it } from "vitest";
import { seedText, variantSeed } from "../src/lib/seed.ts";

describe("variant seed", () => {
  it("is the same for the same class and nickname", () => {
    expect(variantSeed("ABC234", "Rama")).toBe(variantSeed("ABC234", "Rama"));
  });

  it("ignores case and extra spaces in the nickname, like the API does", () => {
    expect(seedText("ABC234", "  Rama   Putra ")).toBe("ABC234:rama putra");
    expect(variantSeed("ABC234", "RAMA  putra")).toBe(variantSeed("ABC234", "rama putra"));
  });

  it("differs between classes and nicknames", () => {
    const seeds = new Set([variantSeed("ABC234", "rama"), variantSeed("ABC235", "rama"), variantSeed("ABC234", "ramb")]);
    expect(seeds.size).toBe(3);
  });

  it("is a 32-bit unsigned integer and never 0", () => {
    for (let i = 0; i < 2000; i++) {
      const s = variantSeed("ABC234", `student ${i}`);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThan(2 ** 32);
    }
  });

  it("has fixed values, so a change of the hash is noticed", () => {
    expect(variantSeed("ABC234", "rama")).toBe(1236704569);
    expect(variantSeed("", "")).toBe(1057798253);
  });
});
