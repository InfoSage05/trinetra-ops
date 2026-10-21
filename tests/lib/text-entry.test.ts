import { describe, it, expect } from "vitest";
import { extractJson } from "@/lib/llm";
import { toPieces } from "@/lib/cartons";
import { matchName, parseQuantityLines } from "@/lib/text-entry";

describe("parseQuantityLines", () => {
  it("reads cartons and pieces from typed or spoken text", () => {
    expect(parseQuantityLines("rose candle 5 carton bana")).toEqual([{ name: "rose candle", quantity: 5, unit: "carton" }]);
    expect(parseQuantityLines("birthday 3 ctn, masjid 120 pcs")).toEqual([
      { name: "birthday", quantity: 3, unit: "carton" }, { name: "masjid", quantity: 120, unit: "piece" },
    ]);
    expect(parseQuantityLines("5 cartons flower design and 2 carton diya")).toEqual([
      { name: "flower design", quantity: 5, unit: "carton" }, { name: "diya", quantity: 2, unit: "carton" },
    ]);
  });
  it("understands a spoken number word only when a unit follows, and treats no unit as pieces", () => {
    expect(parseQuantityLines("do carton rose")).toEqual([{ name: "rose", quantity: 2, unit: "carton" }]);
    expect(parseQuantityLines("rose 40")).toEqual([{ name: "rose", quantity: 40, unit: "piece" }]);
  });
  it("skips lines that have no quantity or no item", () => {
    expect(parseQuantityLines("hello there\n5 carton")).toEqual([]);
  });
});

describe("matchName", () => {
  const catalogue = [
    { id: "1", name: "Rose Candle" }, { id: "2", name: "Rose Candle Large" },
    { id: "3", name: "Birthday Candle" }, { id: "4", name: "Masjid Candle" },
  ];
  it("matches a clear name, even with a small spelling slip", () => {
    expect(matchName("birthday", catalogue).best?.id).toBe("3");
    expect(matchName("birthday", catalogue).status).toBe("MATCHED");
    expect(matchName("masjd", catalogue).best?.id).toBe("4");
  });
  it("prefers the exact item over a longer one, but asks when it cannot tell", () => {
    expect(matchName("rose", catalogue)).toMatchObject({ status: "MATCHED", best: { id: "1" } });
    const both = matchName("rose candle", [{ id: "a", name: "Rose A" }, { id: "b", name: "Rose B" }]);
    expect(both.status).toBe("AMBIGUOUS");
    expect(both.candidates).toHaveLength(2);
  });
  it("reports unknown items as unmatched", () => {
    expect(matchName("lantern", catalogue).status).toBe("UNMATCHED");
  });
});

describe("extractJson", () => {
  it("finds the data even with bracketed words or a code fence around it", () => {
    expect(extractJson('Here is [the result]: {"items":[{"name":"rose"}]} hope that helps')).toEqual({ items: [{ name: "rose" }] });
    expect(extractJson(["```json", "[1, 2]", "```"].join("\n"))).toEqual([1, 2]);
    expect(() => extractJson("no data here")).toThrow();
    expect(() => extractJson("broken [ and { only")).toThrow();
  });
});

describe("toPieces", () => {
  it("treats half-typed text as zero instead of crashing the screen", () => {
    expect(toPieces("2", "3", 12)).toBe("27");
    expect(toPieces("abc", "", 12)).toBe("0");
    expect(toPieces("1,5", "", 12)).toBe("0");
  });
});
