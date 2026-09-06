import { describe, it, expect } from "vitest";
import { legumeSubtypeOf, mariscoSubtypeOf, isShellOnlyMarisco } from "./dishSubtype.js";

describe("legumeSubtypeOf", () => {
  it("detects garbanzo, lenteja and alubia by name", () => {
    expect(legumeSubtypeOf({ name: "Garbanzos fritos crujientes especiados" })).toBe("garbanzo");
    expect(legumeSubtypeOf({ name: "Crema de lentejas" })).toBe("lenteja");
    expect(legumeSubtypeOf({ name: "Alubias blancas con verduras" })).toBe("alubia");
  });

  it("returns null for a non-legume dish", () => {
    expect(legumeSubtypeOf({ name: "Pechuga de pollo a la plancha" })).toBeNull();
  });

  it("detects legume subtype from ingredients even when not named in the title", () => {
    expect(
      legumeSubtypeOf({
        name: "Cocido madrileño",
        ingredients: [{ name: "Garbanzos" }, { name: "Ternera" }],
      }),
    ).toBe("garbanzo");
  });
});

describe("mariscoSubtypeOf / isShellOnlyMarisco", () => {
  it("files mejillones and navajas as molusco", () => {
    expect(mariscoSubtypeOf({ name: "Mejillones a la marinera" })).toBe("molusco");
    expect(mariscoSubtypeOf({ name: "Navajas a la plancha con limón" })).toBe("molusco");
    expect(isShellOnlyMarisco({ name: "Navajas a la plancha con limón" })).toBe(true);
  });

  it("files gambas/langostinos as crustaceo, distinct from molusco", () => {
    expect(mariscoSubtypeOf({ name: "Gambas al ajillo" })).toBe("crustaceo");
    expect(isShellOnlyMarisco({ name: "Gambas al ajillo" })).toBe(false);
  });

  it("does not mislabel plain fish as shellfish", () => {
    expect(mariscoSubtypeOf({ name: "Merluza a la plancha con ajada" })).toBe("pescado_blanco");
    expect(isShellOnlyMarisco({ name: "Merluza a la plancha con ajada" })).toBe(false);
  });
});
