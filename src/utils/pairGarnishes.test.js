import { describe, it, expect } from "vitest";
import { pairGarnishes } from "./pairGarnishes.js";
import guarnicionesCatalog from "../data/recipes/guarniciones.json";
import pescados from "../data/recipes/pescados.json";
import huevos from "../data/recipes/huevos.json";

function garnish(overrides) {
  return {
    id: "safe1",
    name: "Guarnición segura",
    shortName: "guarnicion segura",
    time: 10,
    ingredients: [{ name: "Aceite de oliva" }],
    ...overrides,
  };
}

function principal(overrides) {
  return {
    id: "p1",
    type: "principal",
    name: "Plato principal",
    ingredients: [{ name: "Pollo" }],
    ...overrides,
  };
}

describe("pairGarnishes", () => {
  it("only assigns a garnish from the safe list passed in", () => {
    const pool = { p1: principal() };
    const slots = [{ slotId: "lun_cena", recipeId: "p1" }];
    const safe = [garnish({ id: "safe1" })];
    const result = pairGarnishes(slots, pool, {}, safe);
    expect(result[0].garnishId).toBe("safe1");
  });

  it("leaves the slot without a garnish when the safe list is empty, never falling back to the raw catalog", () => {
    const pool = { p1: principal() };
    const slots = [{ slotId: "lun_cena", recipeId: "p1" }];
    const result = pairGarnishes(slots, pool, {}, []);
    expect(result[0].garnishId).toBeUndefined();
  });

  it("nunca pone guarnición automática a una receta del Recetario Estrella", () => {
    // "Lenguado meunière con mantequilla y limón" ya es un plato entero. Al
    // pegarle una guarnición salía "…con alcachofas confitadas con jamón": un
    // título imposible, veinte ingredientes y la sal repetida tres veces.
    const pool = { p1: principal({ estrella: true }) };
    const slots = [{ slotId: "lun_cena", recipeId: "p1" }];
    const result = pairGarnishes(slots, pool, {}, [garnish()]);
    expect(result[0].garnishId).toBeUndefined();
  });

  it("pero sí respeta la guarnición que ha fijado el usuario, aunque sea estrella", () => {
    // Elegirla es una decisión de quien cocina; lo que sobra es que la app se
    // la invente.
    // Id real del catalogo: la guarnicion fijada se resuelve contra
    // guarniciones.json, no contra la lista de seguras (que solo gobierna el
    // automatico).
    const pool = { p1: principal({ estrella: true }) };
    const slots = [{ slotId: "lun_cena", recipeId: "p1" }];
    const result = pairGarnishes(slots, pool, { p1: "guarniciones_037" }, []);
    expect(result[0].garnishId).toBe("guarniciones_037");
  });

  it("does not pair a garnish for a non-principal recipe", () => {
    const pool = { p1: { ...principal(), type: "guarnicion" } };
    const slots = [{ slotId: "lun_cena", recipeId: "p1" }];
    const result = pairGarnishes(slots, pool, {}, [garnish()]);
    expect(result[0].garnishId).toBeUndefined();
  });

  it("does not pair a garnish for comida_1 (primero) slots", () => {
    const pool = { p1: principal() };
    const slots = [{ slotId: "lun_comida_1", recipeId: "p1" }];
    const result = pairGarnishes(slots, pool, {}, [garnish()]);
    expect(result[0].garnishId).toBeUndefined();
  });

  it("respects the cena time cap even within the safe list", () => {
    const pool = { p1: principal() };
    const slots = [{ slotId: "lun_cena", recipeId: "p1" }];
    const safe = [garnish({ id: "slow", time: 30 })];
    const result = pairGarnishes(slots, pool, {}, safe);
    expect(result[0].garnishId).toBeUndefined();
  });

  it("skips a garnish that would push the comida (primero + segundo + garnish) over the kcal cap", () => {
    // Tester report: "Huevos fritos con puntillas" (312kcal segundo) + the
    // "Arroz blanco" garnish (270kcal) landed at ~580kcal combined with a
    // light primero — heavy enough to basically duplicate "Arroz a la
    // cubana" while still being paired with a starter. COMIDA_KCAL_SOFT_CAP
    // is 850, so a light primero (100) + this segundo (600) + a heavy
    // garnish (200) would total 900 — over the cap — and must be skipped in
    // favor of a lighter garnish that stays under it.
    const pool = {
      primero: { id: "primero", type: "principal", kcal: 100, ingredients: [] },
      p1: principal({ kcal: 600 }),
    };
    const slots = [
      { slotId: "lun_comida_1", recipeId: "primero" },
      { slotId: "lun_comida_2", recipeId: "p1" },
    ];
    const safe = [
      garnish({ id: "heavy", kcal: 200 }),
      garnish({ id: "light", kcal: 80, shortName: "guarnicion ligera" }),
    ];
    const result = pairGarnishes(slots, pool, {}, safe);
    const segundo = result.find((s) => s.slotId === "lun_comida_2");
    expect(segundo.garnishId).toBe("light");
  });

  it("falls back to the kcal-cap-breaking garnish rather than leaving the segundo with none", () => {
    const pool = {
      primero: { id: "primero", type: "principal", kcal: 100, ingredients: [] },
      p1: principal({ kcal: 600 }),
    };
    const slots = [
      { slotId: "lun_comida_1", recipeId: "primero" },
      { slotId: "lun_comida_2", recipeId: "p1" },
    ];
    // Only a heavy option exists — no garnish would ever be worse than none.
    const safe = [garnish({ id: "heavy", kcal: 200 })];
    const result = pairGarnishes(slots, pool, {}, safe);
    const segundo = result.find((s) => s.slotId === "lun_comida_2");
    expect(segundo.garnishId).toBe("heavy");
  });

  it("does not apply the kcal cap to cena (no sibling comida course to guard against)", () => {
    const pool = { p1: principal({ kcal: 600 }) };
    const slots = [{ slotId: "lun_cena", recipeId: "p1" }];
    const safe = [garnish({ id: "heavy", kcal: 400 })];
    const result = pairGarnishes(slots, pool, {}, safe);
    expect(result[0].garnishId).toBe("heavy");
  });

  it("a fried garnish (patatas fritas) never pairs with an egg/veg/pasta main — only meat or fish", () => {
    const fries = garnish({ id: "fries", shortName: "patatas fritas", healthFlags: ["frito"] });
    const veg = garnish({ id: "veg", shortName: "brócoli salteado" });
    const eggMain = principal({ id: "egg", category: "huevos", name: "Tortilla francesa" });
    const result = pairGarnishes(
      [{ slotId: "lun_cena", recipeId: "egg" }],
      { egg: eggMain },
      {},
      [fries, veg],
    );
    expect(result[0].garnishId).toBe("veg");
  });

  it("a fried garnish pairs with a meat/fish main", () => {
    const fries = garnish({ id: "fries", shortName: "patatas fritas", healthFlags: ["frito"] });
    const fishMain = principal({ id: "fish", category: "pescados", name: "Merluza rebozada" });
    const result = pairGarnishes(
      [{ slotId: "lun_cena", recipeId: "fish" }],
      { fish: fishMain },
      {},
      [fries],
    );
    expect(result[0].garnishId).toBe("fries");
  });

  it("a preferMeal:cena garnish is skipped on a comida when another side exists, but allowed on cena", () => {
    const fries = garnish({
      id: "fries",
      shortName: "patatas fritas",
      healthFlags: ["frito"],
      preferMeal: "cena",
    });
    const rice = garnish({ id: "rice", shortName: "arroz blanco" });
    const meat = principal({ id: "meat", category: "carnes", name: "Filete a la plancha", kcal: 300 });
    const pool = { meat, primero: { id: "primero", type: "principal", kcal: 100, ingredients: [] } };

    const comida = pairGarnishes(
      [
        { slotId: "lun_comida_1", recipeId: "primero" },
        { slotId: "lun_comida_2", recipeId: "meat" },
      ],
      pool,
      {},
      [fries, rice],
    );
    expect(comida.find((s) => s.slotId === "lun_comida_2").garnishId).toBe("rice");

    const cena = pairGarnishes([{ slotId: "lun_cena", recipeId: "meat" }], pool, {}, [fries]);
    expect(cena[0].garnishId).toBe("fries");
  });

  it("a user-pinned garnish wins even when excluded from the safe list (explicit choice overrides automatic filtering)", () => {
    // guarniciones_024 "Puré de patata con mantequilla y nuez moscada" carries
    // a real declared "lactosa" allergen in the bundled catalog — simulating a
    // pin made before this group had a dairy allergy, or a deliberate
    // exception the user wants.
    const pool = { p1: principal() };
    const slots = [{ slotId: "lun_cena", recipeId: "p1" }];
    const result = pairGarnishes(slots, pool, { p1: "guarniciones_024" }, []);
    expect(result[0].garnishId).toBe("guarniciones_024");
  });

  it("falls back to pan for a cena when it's the only side left, instead of shipping it bare", () => {
    // Reported: "una cena no pueden ser navajas [...] es super incompleta" —
    // a shellfish-only cena (mejillones, navajas) with no other eligible side
    // left this week used to ship with no garnish at all. Bread is excluded
    // from every earlier tier (a baguette plated next to a normal segundo
    // reads as redundant) but is a completely normal way to round out this
    // kind of light cena, so it's the one thing tried before giving up.
    const bread = garnish({ id: "bread1", shortName: "pan de pueblo" });
    const molusco = principal({
      id: "moluscos1",
      category: "pescados",
      name: "Navajas a la plancha con limón",
      kcal: 240,
    });
    const pool = { moluscos1: molusco };
    const result = pairGarnishes([{ slotId: "lun_cena", recipeId: "moluscos1" }], pool, {}, [bread]);
    expect(result[0].garnishId).toBe("bread1");
  });

  it("never falls back to pan for a comida segundo, even as a last resort", () => {
    const bread = garnish({ id: "bread1", shortName: "pan de pueblo" });
    const meat = principal({ id: "meat", category: "carnes", name: "Filete a la plancha", kcal: 300 });
    const pool = { meat };
    const result = pairGarnishes([{ slotId: "lun_comida_2", recipeId: "meat" }], pool, {}, [bread]);
    expect(result[0].garnishId).toBeUndefined();
  });
});

describe("pairGarnishes contra el catálogo real", () => {
  // Los tres casos que se reportaron, con sus ids de verdad: si alguna vez
  // vuelve a salir "Lenguado meunière con mantequilla y limón CON alcachofas
  // confitadas con jamón", este test lo dice antes que un usuario.
  const REPORTADAS = [
    ...pescados.filter((r) => r.id === "pescados_086"),
    ...huevos.filter((r) => r.id === "huevos_086"),
  ];

  it("no le pone guarnición a ninguna receta estrella reportada", () => {
    expect(REPORTADAS.length).toBe(2);
    for (const recipe of REPORTADAS) {
      expect(recipe.estrella).toBe(true);
      const slots = [{ slotId: "lun_cena", recipeId: recipe.id }];
      const result = pairGarnishes(slots, { [recipe.id]: recipe }, {}, guarnicionesCatalog);
      expect(result[0].garnishId).toBeUndefined();
    }
  });
});
