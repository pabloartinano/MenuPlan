import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  buildUserMessage,
  buildGroupContext,
  generateGroupMenu,
  generateMenuWithAI,
  AIPlannerError,
  applyGarnishToRecipe,
  mergeIngredientLines,
  pickCatalogReplacement,
  selectReplacementCandidates,
  callModel,
  poolForWeek,
} from "./aiPlanner.js";
import { getCarbType, validateMenu, splitAchievableFreqs, FREQ_KEY_MATCHERS } from "../utils/validateMenu.js";
import { recipeCatalogById } from "../data/recipeCatalog.js";
import { filterRecipes } from "../utils/filterRecipes.js";
import { legumeSubtypeOf, mariscoSubtypeOf } from "./dishSubtype.js";

const SLOTS = [{ slotId: "lun_cena", mealType: "cena", mode: "casa", maxTime: 30 }];
const CONFIG = { targetKcal: 2000, freqs: {}, cookLevel: "normal", cookTime: {} };

describe("buildUserMessage pantry section", () => {
  it("omits the pantry section entirely when the user has no pantry", () => {
    const [, textBlock] = buildUserMessage([], SLOTS, CONFIG, {});
    expect(textBlock.text).not.toContain("INGREDIENTES QUE EL USUARIO YA TIENE EN CASA");
  });

  it("lists pantry ingredients and the secondary-preference instruction when present", () => {
    const [, textBlock] = buildUserMessage(
      [],
      SLOTS,
      CONFIG,
      {},
      [],
      ["pollo", "arroz", "tomate", "cebolla"],
    );
    expect(textBlock.text).toContain("INGREDIENTES QUE EL USUARIO YA TIENE EN CASA");
    expect(textBlock.text).toContain("- pollo");
    expect(textBlock.text).toContain("- arroz");
    expect(textBlock.text).toContain("- tomate");
    expect(textBlock.text).toContain("- cebolla");
    expect(textBlock.text).toContain("SECUNDARIA a todas las demás reglas");
    expect(textBlock.text).toContain("No fuerces recetas que no encajen");
  });
});

describe("buildGroupContext intolerances aggregation", () => {
  const group = { id: "g1", label: "Familia", memberIds: ["m1"] };

  function dataWith(member) {
    return { members: [{ id: "m1", age: 30, ...member }], groups: [group], schedule: {} };
  }

  it("passes through plain intolerances untouched", () => {
    const ctx = buildGroupContext(dataWith({ intolerances: ["lactosa_fina"] }), group);
    expect(ctx.filterOpts.intolerances).toEqual(["lactosa_fina"]);
  });

  it("adds alcohol_cocina automatically when embarazo is active", () => {
    const ctx = buildGroupContext(dataWith({ dietaryStates: ["embarazo"] }), group);
    expect(ctx.filterOpts.intolerances).toEqual(
      expect.arrayContaining(["embarazo", "alcohol_cocina"]),
    );
  });

  it("adds alcohol_cocina automatically when lactancia is active", () => {
    const ctx = buildGroupContext(dataWith({ dietaryStates: ["lactancia"] }), group);
    expect(ctx.filterOpts.intolerances).toEqual(
      expect.arrayContaining(["lactancia", "alcohol_cocina"]),
    );
  });

  it("does not add alcohol_cocina for unrelated intolerances", () => {
    const ctx = buildGroupContext(dataWith({ intolerances: ["fructosa"] }), group);
    expect(ctx.filterOpts.intolerances).toEqual(["fructosa"]);
  });

  it("never lets the user select alcohol_cocina directly (it's not a real dietaryState)", () => {
    const ctx = buildGroupContext(dataWith({}), group);
    expect(ctx.filterOpts.intolerances).toEqual([]);
  });
});

describe("buildGroupContext school menu avoidance (protein + carb)", () => {
  const group = { id: "g1", label: "Familia", memberIds: ["m1"] };

  function dataWithSchoolMenu(courses) {
    return {
      members: [{ id: "m1", age: 10 }],
      groups: [group],
      schedule: {},
      schoolMenus: { shared: {}, byMember: { m1: courses } },
    };
  }

  it("sets schoolCarbsToAvoid on the cena slot when the school served a matching carb base at comida", () => {
    const data = dataWithSchoolMenu({
      "Lun-Primero": "Arroz con tomate",
      "Lun-Segundo": "Merluza a la plancha",
    });
    const ctx = buildGroupContext(data, group);
    const cena = ctx.slots.find((s) => s.slotId === "lun_cena");
    expect(cena.schoolCarbsToAvoid).toEqual(["arroz"]);
  });

  it("does not derive schoolCarbsToAvoid from the postre course alone (e.g. 'Arroz con leche' is a dessert, not a carb-bearing course)", () => {
    const data = dataWithSchoolMenu({
      "Lun-Primero": "Ensalada mixta",
      "Lun-Segundo": "Pollo asado",
      "Lun-Postre": "Arroz con leche",
    });
    const ctx = buildGroupContext(data, group);
    const cena = ctx.slots.find((s) => s.slotId === "lun_cena");
    expect(cena.schoolCarbsToAvoid).toBeUndefined();
    // The protein course (Pollo asado) still correctly avoids "carne" — this
    // confirms the postre exclusion is carb-specific, not a general regression.
    expect(cena.schoolProteinsToAvoid).toEqual(["carne"]);
  });

  it("sets neither schoolProteinsToAvoid nor schoolCarbsToAvoid when there's no school menu data for that day", () => {
    const data = dataWithSchoolMenu({}); // nothing uploaded for Lun
    const ctx = buildGroupContext(data, group);
    const cena = ctx.slots.find((s) => s.slotId === "lun_cena");
    expect(cena.schoolProteinsToAvoid).toBeUndefined();
    expect(cena.schoolCarbsToAvoid).toBeUndefined();
  });
});

describe("pickCatalogReplacement respects school-menu avoidance", () => {
  // Real catalog stats (see audit): 101 cena-eligible recipes; 17 are
  // carne-group (pollo/pavo/cerdo/ternera) under the 30min weekday default,
  // 76 are not. This gives enough non-carne candidates that, absent the
  // school-avoidance guard, random selection would very likely (>99.999%
  // over 60 trials) pick a carne dish at least once.
  const group = { id: "g1", label: "Familia", memberIds: ["m1"] };

  function dataWithSchoolMenu(courses, extra = {}) {
    return {
      members: [{ id: "m1", age: 35 }],
      groups: [group],
      schedule: {},
      schoolMenus: { shared: {}, byMember: { m1: courses } },
      ...extra,
    };
  }

  function baseMenuPlan(recipeId = "carnes_002") {
    return { [group.id]: { "Lun-Cena": { recipeId, eaters: 2 } } };
  }

  it("never proposes a cena dish whose protein group matches what the school already served that day", () => {
    const data = dataWithSchoolMenu({
      "Lun-Primero": "Ensalada mixta",
      "Lun-Segundo": "Pollo asado",
    });
    const menuPlan = baseMenuPlan();

    for (let i = 0; i < 60; i++) {
      const result = pickCatalogReplacement(data, menuPlan, {
        groupId: group.id,
        day: "Lun",
        meal: "Cena",
        course: "main",
      });
      expect(result).toBeTruthy();
      const catalogRecipe = recipeCatalogById[result.recipeId] ?? recipeCatalogById[result.frontendRecipe.baseRecipeId];
      expect(["pollo", "pavo", "cerdo", "ternera"]).not.toContain(catalogRecipe.mainProtein);
    }
  });

  it("never proposes a cena dish whose carb base matches what the school already served that day", () => {
    const data = dataWithSchoolMenu(
      { "Lun-Primero": "Arroz con verduras", "Lun-Segundo": "Merluza al horno" },
      { timeWeekday: 60 }, // widen the pool so real arroz-base cena candidates are in range
    );
    const menuPlan = baseMenuPlan("__placeholder_not_in_catalog__");

    for (let i = 0; i < 150; i++) {
      const result = pickCatalogReplacement(data, menuPlan, {
        groupId: group.id,
        day: "Lun",
        meal: "Cena",
        course: "main",
      });
      expect(result).toBeTruthy();
      const catalogRecipe = recipeCatalogById[result.recipeId] ?? recipeCatalogById[result.frontendRecipe.baseRecipeId];
      expect(getCarbType(catalogRecipe)).not.toBe("arroz");
    }
  });

  it("does not apply school-cena avoidance to a comida slot replacement", () => {
    // Sanity check on scoping: schoolProteinsToAvoid/schoolCarbsToAvoid only
    // ever apply to cena (see buildGroupContext) — a comida replacement must
    // not be constrained by them.
    const data = dataWithSchoolMenu({
      "Lun-Primero": "Ensalada mixta",
      "Lun-Segundo": "Pollo asado",
    });
    const menuPlan = {
      [group.id]: {
        "Lun-Comida": { recipeId: "carnes_002", firstRecipeId: null, eaters: 2 },
      },
    };
    const result = pickCatalogReplacement(data, menuPlan, {
      groupId: group.id,
      day: "Lun",
      meal: "Comida",
      course: "main",
    });
    expect(result).toBeTruthy();
  });
});

describe("pickCatalogReplacement derives the target role from slot shape, not from the current dish", () => {
  // Regression: targetRoles used to mirror the mealRole of whatever dish was
  // already sitting in the slot. If a "primero"-only recipe (e.g. an
  // ensalada tagged mealRole ["primero","cena"], no "segundo") ever ended up
  // in the segundo/recipeId slot, every "Regenerar" of that slot mirrored
  // that same wrong role and kept placing more primero-only dishes there —
  // reported as two ensaladas shown as 1º and 2º of the same comida.
  const group = { id: "g1", label: "Familia", memberIds: ["m1"] };
  const data = { members: [{ id: "m1", age: 35 }], groups: [group], schedule: {} };

  it("never proposes a primero-only dish for a segundo slot, even when one is already incorrectly sitting there", () => {
    const misplacedPrimero = Object.values(recipeCatalogById).find(
      (r) =>
        r.mealRole?.includes("primero") &&
        !r.mealRole?.includes("segundo") &&
        !r.mealRole?.includes("plato_unico"),
    );
    // Sanity check: this shape (a real "primero"-only dish) exists in the
    // catalog — otherwise the regression this test guards can't occur.
    expect(misplacedPrimero).toBeTruthy();

    const anotherPrimero = Object.values(recipeCatalogById).find(
      (r) => r.mealRole?.includes("primero") && r.id !== misplacedPrimero.id,
    );

    const menuPlan = {
      [group.id]: {
        "Lun-Comida": { firstRecipeId: anotherPrimero.id, recipeId: misplacedPrimero.id, eaters: 2 },
      },
    };

    for (let i = 0; i < 30; i++) {
      const result = pickCatalogReplacement(data, menuPlan, {
        groupId: group.id,
        day: "Lun",
        meal: "Comida",
        course: "main",
      });
      expect(result).toBeTruthy();
      const catalogRecipe =
        recipeCatalogById[result.recipeId] ?? recipeCatalogById[result.frontendRecipe.baseRecipeId];
      expect(catalogRecipe.mealRole).toEqual(expect.arrayContaining(["segundo"]));
    }
  });
});

describe("pickCatalogReplacement varies legume/marisco subtype across the whole week", () => {
  // Reported: a Thursday comida was regenerated to garbanzos without noticing
  // Sunday's comida already had garbanzos — Thursday and Sunday aren't
  // chronologically adjacent, so rule 3c's neighbour-day check never saw it
  // (both are just "legumbres", the same coarse group, on non-neighbouring
  // days). This is a whole-week PREFERENCE (see aiPlanner.js), not a hard
  // block, so it should steer away from garbanzos while other legume
  // subtypes are available in the pool.
  const group = { id: "g1", label: "Familia", memberIds: ["m1"] };

  it("does not repeat the garbanzo subtype on a non-adjacent day when lentejas/alubias are available", () => {
    const data = { members: [{ id: "m1", age: 35 }], groups: [group], schedule: {}, timeWeekday: 90, timeWeekend: 90 };
    const all = Object.values(recipeCatalogById);
    const garbanzoDishes = all.filter(
      (r) => legumeSubtypeOf(r) === "garbanzo" && r.mealRole?.includes("plato_unico") && r.time <= 90,
    );
    const otherLegumeExists = all.some(
      (r) =>
        ["lenteja", "alubia"].includes(legumeSubtypeOf(r)) &&
        r.mealRole?.includes("plato_unico") &&
        r.time <= 90,
    );
    // Sanity: the fixture this regression needs (two distinct garbanzo
    // dishes, plus a non-garbanzo legume alternative) exists in the catalog.
    expect(garbanzoDishes.length).toBeGreaterThanOrEqual(2);
    expect(otherLegumeExists).toBe(true);

    const menuPlan = {
      [group.id]: {
        "Jue-Comida": { recipeId: garbanzoDishes[0].id, eaters: 2 },
        "Dom-Comida": { recipeId: garbanzoDishes[1].id, eaters: 2 },
      },
    };

    for (let i = 0; i < 40; i++) {
      const result = pickCatalogReplacement(data, menuPlan, {
        groupId: group.id,
        day: "Jue",
        meal: "Comida",
        course: "main",
      });
      expect(result).toBeTruthy();
      const picked = recipeCatalogById[result.recipeId] ?? recipeCatalogById[result.frontendRecipe.baseRecipeId];
      expect(legumeSubtypeOf(picked)).not.toBe("garbanzo");
    }
  });

  it("does not repeat the molusco subtype (mejillones/navajas/almejas) on a non-adjacent day when other cena options exist", () => {
    const data = { members: [{ id: "m1", age: 35 }], groups: [group], schedule: {}, timeWeekday: 90, timeWeekend: 90 };
    const all = Object.values(recipeCatalogById);
    const moluscoCenas = all.filter(
      (r) => mariscoSubtypeOf(r) === "molusco" && r.mealRole?.includes("cena") && r.time <= 90,
    );
    expect(moluscoCenas.length).toBeGreaterThanOrEqual(2);

    const menuPlan = {
      [group.id]: {
        "Jue-Cena": { recipeId: moluscoCenas[0].id, eaters: 2 },
        "Dom-Cena": { recipeId: moluscoCenas[1].id, eaters: 2 },
      },
    };

    for (let i = 0; i < 40; i++) {
      const result = pickCatalogReplacement(data, menuPlan, {
        groupId: group.id,
        day: "Jue",
        meal: "Cena",
        course: "main",
      });
      expect(result).toBeTruthy();
      const picked = recipeCatalogById[result.recipeId] ?? recipeCatalogById[result.frontendRecipe.baseRecipeId];
      expect(mariscoSubtypeOf(picked)).not.toBe("molusco");
    }
  });
});

describe("pickCatalogReplacement keeps the same-day protein group separated (rule 3c)", () => {
  const group = { id: "g1", label: "Familia", memberIds: ["m1"] };
  const PROTEIN_GROUPS = {
    pollo: "carne", pavo: "carne", cerdo: "carne", ternera: "carne",
    pescado_blanco: "pescado", pescado_azul: "pescado", marisco: "pescado",
    legumbre: "legumbres", huevo: "huevos",
  };
  const groupsOfRecipe = (r) => {
    const out = new Set();
    if (!r) return out;
    for (const p of [r.mainProtein, ...(r.extraProteins ?? [])]) {
      if (PROTEIN_GROUPS[p]) out.add(PROTEIN_GROUPS[p]);
    }
    return out;
  };

  it("never proposes a cena sharing that day's comida protein group, even when the neighbouring days crowd out the stricter tier", () => {
    // The diversity guardrail used to be a single all-or-nothing filter: when no
    // candidate satisfied BOTH the same-day and the neighbour-day constraint it
    // dropped the two together, so a crowded week could hand back a cena with
    // the very protein group that day's comida already carried. Same-day
    // separation is what the user actually sees on the plate, so it must now
    // survive one tier longer than the neighbour-day preference.
    const data = {
      members: [{ id: "m1", age: 35 }],
      groups: [group],
      schedule: {},
      timeWeekday: 90,
      timeWeekend: 90,
    };
    const all = Object.values(recipeCatalogById);
    const bySlotGroup = (mealRole, wanted) =>
      all.find((r) => r.mealRole?.includes(mealRole) && groupsOfRecipe(r).has(wanted) && r.time <= 90);

    const carneComida = bySlotGroup("segundo", "carne");
    expect(carneComida, "fixture needs a carne segundo in the catalog").toBeTruthy();

    // Deliberately spread the OTHER protein groups across the adjacent days so
    // the strict (same-day + neighbour-day clean) tier is genuinely squeezed.
    const menuPlan = {
      [group.id]: {
        "Lun-Comida": { recipeId: bySlotGroup("segundo", "pescado")?.id, eaters: 2 },
        "Lun-Cena": { recipeId: bySlotGroup("cena", "huevos")?.id, eaters: 2 },
        "Mar-Comida": { recipeId: carneComida.id, eaters: 2 },
        "Mar-Cena": { recipeId: "__placeholder_not_in_catalog__", eaters: 2 },
        "Mié-Comida": { recipeId: bySlotGroup("segundo", "legumbres")?.id, eaters: 2 },
        "Mié-Cena": { recipeId: bySlotGroup("cena", "pescado")?.id, eaters: 2 },
      },
    };

    for (let i = 0; i < 60; i++) {
      const result = pickCatalogReplacement(data, menuPlan, {
        groupId: group.id,
        day: "Mar",
        meal: "Cena",
        course: "main",
      });
      expect(result).toBeTruthy();
      const picked =
        recipeCatalogById[result.recipeId] ?? recipeCatalogById[result.frontendRecipe.baseRecipeId];
      expect(groupsOfRecipe(picked).has("carne")).toBe(false);
    }
  });
});

describe("generateGroupMenu: a forced fixed dish must not reintroduce a same-day protein clash", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockLLMAlwaysReturns(slots) {
    const text = JSON.stringify({ slots });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: [{ text }] }) }),
    );
  }

  it("re-picks the primero when enforceFixedDishes forces a huevo cena onto a day whose primero is already huevo", async () => {
    // The exact shape reported from a real menu: "Huevos rellenos" as primero
    // and "Huevos fritos con puntillas" as cena, the same Thursday. The
    // validate + applyFallback loop leaves a clean menu; enforceFixedDishes then
    // forces the huevo cena in and recreates rule 3c's clash. breakProteinClusters
    // only walked the main-meal chain, which deliberately skips comida_1
    // primeros — so nothing corrected this and it surfaced only as a warning.
    const group = { id: "g1", label: "Familia", memberIds: ["m1"], days: 2 };
    const fixedRecipe = recipeCatalogById.huevos_007; // Huevos fritos con puntillas
    expect(fixedRecipe, "fixture depends on huevos_007 existing").toBeTruthy();
    expect(fixedRecipe.mealRole).toContain("cena");

    const data = {
      members: [{ id: "m1", age: 35 }],
      groups: [group],
      schedule: {},
      timeWeekday: 90,
      timeWeekend: 90,
      // No weekly caps, so the only pressure under test is the same-day clash
      // (a huevos cap would mask it by swapping the primero for its own reason).
      freqs: {},
      fixedDishes: [
        { name: fixedRecipe.name, catalogId: fixedRecipe.id, timesPerWeek: 1, meals: ["Cena"] },
      ],
    };

    const ctx = buildGroupContext(data, group);
    const { recipes: pool } = filterRecipes(ctx.filterOpts);

    const huevoPrimeros = pool.filter(
      (r) => r.mainProtein === "huevo" && r.mealRole.includes("primero") && r.id !== fixedRecipe.id,
    );
    expect(huevoPrimeros.length).toBeGreaterThanOrEqual(2);

    const used = new Set([fixedRecipe.id, huevoPrimeros[0].id, huevoPrimeros[1].id]);
    const pickDistinct = (pred) => {
      const r = pool.find((c) => pred(c) && !used.has(c.id));
      expect(r, "no distinct pool candidate matched a fixture predicate").toBeTruthy();
      used.add(r.id);
      return r;
    };
    const noHuevo = (r) => r.mainProtein !== "huevo";

    // BOTH days open with a huevo primero, so wherever enforceFixedDishes places
    // the fixed huevo cena it lands on a day that already carries huevos.
    mockLLMAlwaysReturns([
      { slotId: "lun_comida_1", recipeId: huevoPrimeros[0].id },
      { slotId: "lun_comida_2", recipeId: pickDistinct((r) => r.mealRole.includes("segundo") && noHuevo(r)).id },
      { slotId: "lun_cena", recipeId: pickDistinct((r) => r.mealRole.includes("cena") && noHuevo(r) && r.category !== "legumbres").id },
      { slotId: "mar_comida_1", recipeId: huevoPrimeros[1].id },
      { slotId: "mar_comida_2", recipeId: pickDistinct((r) => r.mealRole.includes("segundo") && noHuevo(r)).id },
      { slotId: "mar_cena", recipeId: pickDistinct((r) => r.mealRole.includes("cena") && noHuevo(r) && r.category !== "legumbres").id },
    ]);

    const result = await generateGroupMenu(data, group);

    // The fixed dish still gets its guaranteed placement — the fix corrects the
    // NON-fixed side of the clash, it never silently drops what the user pinned.
    expect(result.slotAssignments.filter((s) => s.recipeId === fixedRecipe.id)).toHaveLength(1);

    // ...and no day repeats a protein group across primero and cena any more.
    const finalCheck = validateMenu(result.slotAssignments, pool, ctx.slots, [], {});
    expect(finalCheck.violations.filter((v) => v.rule === "proteina_repetida_en_dia")).toEqual([]);
  });
});

describe("generateGroupMenu: a fixed dish forced after the freq cap is already met must not silently exceed it", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockLLMAlwaysReturns(slots) {
    const text = JSON.stringify({ slots });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: [{ text }] }) }),
    );
  }

  it("swaps away the excess huevo dish instead of only warning, when enforceFixedDishes forces an extra huevo dish in on top of a cap already met", async () => {
    // The exact shape reported from a real menu: "Huevos: N/sem" configured,
    // but the generated menu carried one more huevo dish than the cap.
    // validateMenu's rule 11 (freq_max_exceeded, fixed 2026-08-08) already
    // catches this — but only inside the main validate+fallback loop, which
    // runs BEFORE enforceFixedDishes (step 4). A fixed huevo dish forced in
    // afterwards can push the count back over the cap, and until now step 6's
    // re-validation only warned about it (a warning that, since a
    // since-fixed bug, never even reached the UI) instead of repairing it.
    //
    // enforceFixedDishes places a single (need=1) fixed dish on the FIRST free
    // day in slot order (pickEvenlySpread(freeDays, 1) === freeDays[0]) — so
    // with lun mocked first, the fixed dish deterministically lands on
    // lun_cena. The OTHER huevo dish (mar_comida_1) is chronologically LATER,
    // so it — not the fixed dish's own slot — is the one rule 11 attributes
    // the excess to, which is exactly the case the repair must be able to fix.
    const group = { id: "g1", label: "Familia", memberIds: ["m1"], days: 2 };
    const fixedRecipe = recipeCatalogById.huevos_007; // Huevos fritos con puntillas (cena)
    expect(fixedRecipe, "fixture depends on huevos_007 existing").toBeTruthy();
    expect(fixedRecipe.mealRole).toContain("cena");

    const data = {
      members: [{ id: "m1", age: 35 }],
      groups: [group],
      schedule: {},
      timeWeekday: 90,
      timeWeekend: 90,
      freqs: { huevos: 1 },
      fixedDishes: [
        { name: fixedRecipe.name, catalogId: fixedRecipe.id, timesPerWeek: 1, meals: ["Cena"] },
      ],
    };

    const ctx = buildGroupContext(data, group);
    const { recipes: pool } = filterRecipes(ctx.filterOpts);

    const huevoPrimero = pool.find(
      (r) => r.mainProtein === "huevo" && r.mealRole.includes("primero") && r.id !== fixedRecipe.id,
    );
    expect(huevoPrimero, "fixture needs a huevo primero distinct from the fixed dish").toBeTruthy();

    const used = new Set([fixedRecipe.id, huevoPrimero.id]);
    const pickDistinct = (pred) => {
      const r = pool.find((c) => pred(c) && !used.has(c.id));
      expect(r, "no distinct pool candidate matched a fixture predicate").toBeTruthy();
      used.add(r.id);
      return r;
    };
    const noHuevo = (r) => r.mainProtein !== "huevo";

    // lun: nothing huevo — this is the day enforceFixedDishes will overwrite
    // lun_cena with the fixed dish. mar: comida_1 is the one huevo dish in the
    // INITIAL answer, which alone already sits exactly AT the cap of 1.
    mockLLMAlwaysReturns([
      { slotId: "lun_comida_1", recipeId: pickDistinct((r) => r.mealRole.includes("primero") && !r.mealRole.includes("plato_unico") && noHuevo(r)).id },
      { slotId: "lun_comida_2", recipeId: pickDistinct((r) => r.mealRole.includes("segundo") && noHuevo(r)).id },
      { slotId: "lun_cena", recipeId: pickDistinct((r) => r.mealRole.includes("cena") && noHuevo(r) && r.category !== "legumbres").id },
      { slotId: "mar_comida_1", recipeId: huevoPrimero.id },
      { slotId: "mar_comida_2", recipeId: pickDistinct((r) => r.mealRole.includes("segundo") && noHuevo(r)).id },
      { slotId: "mar_cena", recipeId: pickDistinct((r) => r.mealRole.includes("cena") && noHuevo(r) && r.category !== "legumbres").id },
    ]);

    const result = await generateGroupMenu(data, group);

    // The fixed dish still gets its guaranteed placement — the fix corrects
    // the excess huevo dish elsewhere, it never drops what the user pinned.
    const fixedPlacements = result.slotAssignments.filter((s) => s.recipeId === fixedRecipe.id);
    expect(fixedPlacements).toHaveLength(1);
    expect(fixedPlacements[0].slotId).toBe("lun_cena");

    // ...and the huevos cap (1/semana) holds in the FINAL menu, even though
    // enforceFixedDishes forced a 2nd huevo dish in after the main loop had
    // already satisfied the cap on its own — mar_comida_1 (huevoPrimero) is
    // what must have been swapped away, since lun_cena is off-limits (fixed).
    const huevoCount = result.slotAssignments.filter(
      (s) => recipeCatalogById[s.recipeId] && FREQ_KEY_MATCHERS.huevos(recipeCatalogById[s.recipeId]),
    ).length;
    expect(huevoCount).toBeLessThanOrEqual(1);
    expect(result.slotAssignments.find((s) => s.slotId === "mar_comida_1")?.recipeId).not.toBe(huevoPrimero.id);
  });
});

describe("selectReplacementCandidates (single-dish swap)", () => {
  // Covers the manual "swap this dish" path (pickCatalogReplacement), which
  // picks from a much smaller pool than the full weekly generator and is the
  // one place a recipeId can end up duplicated in the week — validateMenu's
  // rule 6 (recipeId_repetido) never runs on this path.
  const matchesAll = () => true;

  it("prefers unused candidates and never reports a duplicate when some exist", () => {
    const pool = [{ id: "a" }, { id: "b" }];
    const { candidates, reusedDuplicate } = selectReplacementCandidates(
      pool,
      matchesAll,
      new Set(["a"]), // "a" already used elsewhere this week
      "a", // slot being replaced currently holds "a"
    );
    expect(candidates.map((r) => r.id)).toEqual(["b"]);
    expect(reusedDuplicate).toBe(false);
  });

  it("falls back to an already-used recipe (and flags it) when no unused candidate fits", () => {
    // Every structurally-fitting recipe other than the one being replaced is
    // already placed somewhere else in the week.
    const pool = [{ id: "a" }, { id: "b" }];
    const { candidates, reusedDuplicate } = selectReplacementCandidates(
      pool,
      matchesAll,
      new Set(["a", "b"]), // both already used
      "a", // currently in this slot
    );
    expect(candidates.map((r) => r.id)).toEqual(["b"]);
    expect(reusedDuplicate).toBe(true);
  });

  it("never proposes the exact dish being replaced as its own replacement", () => {
    const pool = [{ id: "a" }];
    const { candidates, reusedDuplicate } = selectReplacementCandidates(
      pool,
      matchesAll,
      new Set(["a"]),
      "a",
    );
    expect(candidates).toEqual([]);
    expect(reusedDuplicate).toBe(false);
  });

  it("does not claim a duplicate happened when nothing fits even after relaxing", () => {
    const noMatch = () => false;
    const pool = [{ id: "a" }, { id: "b" }];
    const { candidates, reusedDuplicate } = selectReplacementCandidates(
      pool,
      noMatch,
      new Set(["a"]),
      "a",
    );
    expect(candidates).toEqual([]);
    expect(reusedDuplicate).toBe(false);
  });
});

describe("generateGroupMenu baby group", () => {
  // Baby groups skip the LLM entirely (generateBabyMenuDeterministic), so this
  // is safe to call directly without mocking callModel/network.
  const group = { id: "g1", label: "Bebé", memberIds: ["baby1"] };

  function babyData(memberOverrides) {
    return {
      members: [{ id: "baby1", age: 1, ...memberOverrides }],
      groups: [group],
      schedule: {},
    };
  }

  it("passes the group's intolerances through as `restrictions`, so hydration can adapt ingredients (e.g. lactose-free) for baby-only menus", async () => {
    const result = await generateGroupMenu(babyData({ intolerances: ["lactosa_fina"] }), group);
    expect(result.restrictions).toEqual(["lactosa_fina"]);
  });

  it("returns an empty warnings array for baby groups", async () => {
    const result = await generateGroupMenu(babyData({}), group);
    expect(result.warnings).toEqual([]);
  });
});

describe("applyGarnishToRecipe adaptations", () => {
  function baseFr() {
    return {
      id: "r1", name: "Pollo asado", time: 30, kcal: 400,
      macros: { protein: 30, carbs: 10, fat: 15 },
      ingredients: [{ id: "pollo", name: "Pollo", category: "carnes", qty: 200, unit: "g" }],
    };
  }

  function dairyGarnish() {
    return {
      id: "g1", shortName: "puré", time: 10, baseServings: 2,
      kcal: 200, protein_g: 4, carbs_g: 30, fat_g: 6,
      ingredients: [
        { name: "Leche", amount: 100, unit: "ml" },
        { name: "Patata", amount: 300, unit: "g" },
      ],
    };
  }

  it("renames a lactose ingredient in the merged garnish and notes the adaptation, instead of the garnish having been dropped", () => {
    const fr = applyGarnishToRecipe(baseFr(), dairyGarnish(), 2, ["lactosa_fina"]);
    const milk = fr.ingredients.find((i) => i.name.toLowerCase().includes("leche"));
    expect(milk.name.toLowerCase()).toContain("sin lactosa");
    expect(fr.adaptations).toEqual(
      expect.arrayContaining([expect.objectContaining({ from: "Leche", label: "sin lactosa" })]),
    );
  });

  it("leaves garnish ingredients untouched when the restriction isn't active", () => {
    const fr = applyGarnishToRecipe(baseFr(), dairyGarnish(), 2, []);
    expect(fr.ingredients.some((i) => i.name === "Leche")).toBe(true);
    expect(fr.adaptations).toBeUndefined();
  });
});

describe("pool exhaustion from MULTIPLE members' restrictions (filterRecipes error propagation)", () => {
  // Three kids, each contributing a DIFFERENT allergy/intolerance. None of
  // these alone would exhaust the catalog (see the "one member only" contrast
  // test below) — it's specifically the UNION across several children
  // (buildGroupContext's flatMap) that pushes the filtered pool under
  // filterRecipes.js's minRecipes floor. hasKids + a 30-min weekday budget +
  // cookLevel "basic" mirror a realistic family setup rather than an
  // artificial edge case.
  //
  // kid3 also carries a vegano intolerance on top of its allergies (a vegan
  // child with an egg/fish allergy is a perfectly ordinary combination) —
  // vegano alone leaves ~19 curated (Recetario Estrella) recipes, which is
  // thin but fine on its own (filterRecipes.js's minRecipes=15 accepts it,
  // repetition and all); it's specifically the UNION with the other two
  // kids' allergies that pushes the combined pool down to ~10 and crosses
  // the floor — verified below.
  const group = { id: "g1", label: "Niños", memberIds: ["kid1", "kid2", "kid3"] };
  const threeKidsData = {
    members: [
      { id: "kid1", age: 8, allergies: ["Gluten"], intolerances: ["fructosa"] },
      { id: "kid2", age: 6, allergies: ["Leche"], intolerances: ["sorbitol"] },
      { id: "kid3", age: 10, allergies: ["Huevos", "Pescado"], intolerances: ["vegano"] },
    ],
    groups: [group],
    schedule: {},
    timeWeekday: 30,
    timeWeekend: 30,
    cookLevel: "basic",
  };

  it("generateGroupMenu throws an AIPlannerError carrying filterRecipes' pool-exhaustion message", async () => {
    await expect(generateGroupMenu(threeKidsData, group)).rejects.toBeInstanceOf(AIPlannerError);
    await expect(generateGroupMenu(threeKidsData, group)).rejects.toThrow(
      /Solo quedan \d+ recetas tras filtrar/,
    );
  });

  it("does NOT exhaust the pool for just one of the three kids — the exhaustion is genuinely cumulative, not from a single member's restrictions", () => {
    // Checked via filterRecipes directly (not generateGroupMenu) so this stays
    // a pure/offline assertion: a non-exhausted pool would otherwise proceed
    // to call the LLM, which this test suite never mocks.
    const oneKidGroup = { id: "g1", label: "Niños", memberIds: ["kid1"] };
    const oneKidData = { ...threeKidsData, members: [threeKidsData.members[0]], groups: [oneKidGroup] };
    const ctx = buildGroupContext(oneKidData, oneKidGroup);
    const { error } = filterRecipes(ctx.filterOpts);
    expect(error).toBeNull();
  });

  it("does NOT exhaust the pool for kid3 (vegano) alone either", () => {
    const kid3Group = { id: "g1", label: "Niños", memberIds: ["kid3"] };
    const kid3Data = { ...threeKidsData, members: [threeKidsData.members[2]], groups: [kid3Group] };
    const ctx = buildGroupContext(kid3Data, kid3Group);
    const { error } = filterRecipes(ctx.filterOpts);
    expect(error).toBeNull();
  });

  it("generateMenuWithAI (the function App.jsx actually calls) also rejects end-to-end for the same multi-restriction group", async () => {
    await expect(generateMenuWithAI(threeKidsData)).rejects.toBeInstanceOf(AIPlannerError);
    await expect(generateMenuWithAI(threeKidsData)).rejects.toThrow(
      /Solo quedan \d+ recetas tras filtrar/,
    );
  });
});

// ── Multi-domain integration: rules that are only tested in isolation      ──
// elsewhere in this file can still interact when generateGroupMenu runs the
// FULL pipeline (LLM -> retries -> applyFallback -> 3b -> enforceFixedDishes
// -> enforceSlotTypes -> pairGarnishes). These tests mock the LLM to always
// return a deliberately non-compliant answer (so the deterministic machinery
// — not the model — has to do all the work) and assert the FINAL output
// satisfies every active domain simultaneously, via a real validateMenu()
// call on the result. A test that only checked "the freq target is met" or
// only "the school menu is respected" could pass while silently violating
// the other — see the applyFallback/enforceFixedDishes unit tests above for
// the underlying bugs this exercises.
describe("generateGroupMenu: multiple rule domains active at once", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockLLMAlwaysReturns(slots) {
    const text = JSON.stringify({ slots });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ text }] }),
      }),
    );
  }

  it("satisfies an allergy, a weekly pescado CAP, and the school-menu carb/protein avoidance together — not just whichever rule ran last", async () => {
    // freqs are maximums (see validateMenu.js rule 11): "pescado: 1" means
    // AT MOST one pescado dish all week, not "at least one".
    const group = { id: "g1", label: "Familia", memberIds: ["m1"], days: 2 };
    const data = {
      members: [{ id: "m1", age: 35, allergies: ["Gluten"] }],
      groups: [group],
      schedule: {},
      timeWeekday: 90,
      timeWeekend: 90,
      schoolMenus: {
        shared: {},
        byMember: {
          m1: { "Lun-Primero": "Arroz con verduras", "Lun-Segundo": "Merluza a la plancha" },
        },
      },
      freqs: { pescado: 1 },
    };

    const ctx = buildGroupContext(data, group);
    const { recipes: pool } = filterRecipes(ctx.filterOpts);
    expect(pool.length).toBeGreaterThan(10);

    // Real, gluten-safe candidates, deliberately chosen so the *initial* LLM
    // answer is wrong on two different domains at once: TWO pescado segundos
    // (freq cap of 1 exceeded) and an arroz-based, non-pescado cena on the
    // exact day the school already served arroz+pescado (school_carb_conflict,
    // and would-be school_protein_conflict if a naive pescado-cap fix dumped
    // the excess fish into that same cena instead of respecting the avoidance).
    const usedIds = new Set();
    const pick = (pred) => {
      const r = pool.find((c) => pred(c) && !usedIds.has(c.id));
      expect(r, `no pool candidate matched a fixture predicate`).toBeTruthy();
      usedIds.add(r.id);
      return r;
    };
    const primero = () =>
      pick((r) => r.mealRole.includes("primero") && !r.mealRole.includes("plato_unico") && getCarbType(r) !== "arroz");
    const segundoPescado = () =>
      pick(
        (r) =>
          r.mealRole.includes("segundo") &&
          (r.category === "pescados" || ["pescado_blanco", "pescado_azul", "marisco"].includes(r.mainProtein)),
      );
    const cenaArrozNoPescado = () =>
      pick(
        (r) =>
          r.mealRole.includes("cena") &&
          r.category !== "legumbres" &&
          getCarbType(r) === "arroz" &&
          !["pescado_blanco", "pescado_azul", "marisco"].includes(r.mainProtein),
      );
    const cenaNoPescadoNoArroz = () =>
      pick(
        (r) =>
          r.mealRole.includes("cena") &&
          r.category !== "legumbres" &&
          getCarbType(r) !== "arroz" &&
          !["pescado_blanco", "pescado_azul", "marisco"].includes(r.mainProtein),
      );

    const lunP = primero("lun");
    const lunS = segundoPescado(); // 1st pescado — within cap on its own
    const lunC = cenaArrozNoPescado(); // the deliberately-wrong pick for lun_cena
    const marP = primero("mar");
    const marS = segundoPescado(); // 2nd pescado — pushes the week over the cap of 1
    const marC = cenaNoPescadoNoArroz();

    mockLLMAlwaysReturns([
      { slotId: "lun_comida_1", recipeId: lunP.id },
      { slotId: "lun_comida_2", recipeId: lunS.id },
      { slotId: "lun_cena", recipeId: lunC.id },
      { slotId: "mar_comida_1", recipeId: marP.id },
      { slotId: "mar_comida_2", recipeId: marS.id },
      { slotId: "mar_cena", recipeId: marC.id },
    ]);

    const result = await generateGroupMenu(data, group);
    expect(result.slotAssignments).toHaveLength(6);

    // Nothing in the final menu carries the allergen (guaranteed upstream by
    // filterRecipes, but assert it explicitly since it's one of the three
    // domains under test).
    for (const { recipeId } of result.slotAssignments) {
      const r = recipeCatalogById[recipeId];
      expect((r.allergens ?? []).some((a) => /gluten/i.test(a))).toBe(false);
    }

    // The strongest assertion: re-running validateMenu on the FINAL output
    // (with the same achievable freqs generateGroupMenu itself computed) must
    // report zero violations — every domain holds simultaneously: the pescado
    // cap, the allergen, and the school-avoidance on lun_cena.
    const { achievable } = splitAchievableFreqs(pool, data.freqs);
    const finalCheck = validateMenu(result.slotAssignments, pool, ctx.slots, [], achievable);
    expect(finalCheck.violations).toEqual([]);
    expect(finalCheck.valid).toBe(true);

    const lunCenaFinal = result.slotAssignments.find((s) => s.slotId === "lun_cena");
    const lunCenaRecipe = recipeCatalogById[lunCenaFinal.recipeId];
    expect(getCarbType(lunCenaRecipe)).not.toBe("arroz");
    expect(["pescado_blanco", "pescado_azul", "marisco"]).not.toContain(lunCenaRecipe.mainProtein);

    // The core of the max-semantics fix: the pescado CAP is never exceeded in
    // the final menu, even though the (deliberately wrong) initial LLM answer
    // went over it.
    if (achievable.pescado != null) {
      const pescadoCount = result.slotAssignments.filter(
        (s) => recipeCatalogById[s.recipeId] && FREQ_KEY_MATCHERS.pescado(recipeCatalogById[s.recipeId]),
      ).length;
      expect(pescadoCount).toBeLessThanOrEqual(achievable.pescado);
    }
  });

  it("keeps a fixed dish's forced weekly placements off the exact cena day the school already served its protein — while still honoring an active allergy", async () => {
    const group = { id: "g1", label: "Familia", memberIds: ["m1"], days: 4 };
    // A pollo/cerdo/ternera-family cena dish — deliberately carne-based, so
    // it collides with schoolProteinsToAvoid ["carne"] on the one day (lun)
    // the school served pollo, exercising enforceFixedDishes' school-avoidance
    // carve-out end to end (not just the fixedDishes.test.js unit tests).
    const fixedRecipe = recipeCatalogById.carnes_002;
    expect(fixedRecipe, "fixture depends on carnes_002 existing in the catalog").toBeTruthy();
    expect(fixedRecipe.mealRole).toContain("cena");
    expect(["pollo", "pavo", "cerdo", "ternera"]).toContain(fixedRecipe.mainProtein);

    const data = {
      members: [{ id: "m1", age: 35, allergies: ["Marisco"] }],
      groups: [group],
      schedule: {},
      timeWeekday: 90,
      timeWeekend: 90,
      schoolMenus: {
        shared: {},
        byMember: {
          m1: { "Lun-Primero": "Ensalada mixta", "Lun-Segundo": "Pollo asado" },
        },
      },
      // timesPerWeek 2 with 3 non-conflicting cena days (mar/mie/jue) free —
      // the avoidance carve-out has enough room to satisfy the guarantee
      // without ever falling back onto the conflicting lun_cena slot.
      fixedDishes: [
        { name: fixedRecipe.name, catalogId: fixedRecipe.id, timesPerWeek: 2, meals: ["Cena"] },
      ],
    };

    const ctx = buildGroupContext(data, group);
    const { recipes: pool } = filterRecipes(ctx.filterOpts);
    expect(pool.length).toBeGreaterThan(10);
    expect(ctx.slots.find((s) => s.slotId === "lun_cena")?.schoolProteinsToAvoid).toEqual(["carne"]);

    // A wrong-but-non-repetitive initial LLM answer: distinct, non-carne
    // dishes per slot, so the only violations validateMenu should find are
    // the ones this test deliberately set up (fixed-dish placement + school
    // avoidance), not incidental noise from e.g. recipeId_repetido cascades.
    const notCarneOrFixed = (r) =>
      r.id !== fixedRecipe.id && !["pollo", "pavo", "cerdo", "ternera"].includes(r.mainProtein);
    const used = new Set([fixedRecipe.id]);
    const pickDistinct = (pred) => {
      const r = pool.find((c) => pred(c) && notCarneOrFixed(c) && !used.has(c.id));
      expect(r, "no distinct pool candidate matched a fixture predicate").toBeTruthy();
      used.add(r.id);
      return r;
    };
    mockLLMAlwaysReturns(
      ["lun", "mar", "mie", "jue"].flatMap((d) => [
        {
          slotId: `${d}_comida_1`,
          recipeId: pickDistinct((r) => r.mealRole.includes("primero") && !r.mealRole.includes("plato_unico")).id,
        },
        { slotId: `${d}_comida_2`, recipeId: pickDistinct((r) => r.mealRole.includes("segundo")).id },
        { slotId: `${d}_cena`, recipeId: pickDistinct((r) => r.mealRole.includes("cena")).id },
      ]),
    );

    const result = await generateGroupMenu(data, group);

    // Allergy domain: nothing in the final menu carries a marisco allergen.
    for (const { recipeId } of result.slotAssignments) {
      const r = recipeCatalogById[recipeId];
      expect((r.allergens ?? []).some((a) => /marisco/i.test(a))).toBe(false);
    }

    // Fixed-dish domain: the dish appears exactly timesPerWeek (2) times
    // among the cena slots it was fixed for.
    const fixedCenaPlacements = result.slotAssignments.filter(
      (s) => s.slotId.endsWith("_cena") && s.recipeId === fixedRecipe.id,
    );
    expect(fixedCenaPlacements).toHaveLength(2);

    // School domain: the fixed dish must never land on lun_cena, since that's
    // exactly the day/slot the school's "carne" course already covered.
    const lunCena = result.slotAssignments.find((s) => s.slotId === "lun_cena");
    expect(lunCena.recipeId).not.toBe(fixedRecipe.id);

    // Re-validating the whole final menu confirms every domain holds
    // simultaneously — not just the fixed-dish guarantee in isolation.
    // recipeId_repetido is expected and excluded here: a fixed dish
    // appearing timesPerWeek > 1 times is an intentional, sanctioned repeat
    // that validateMenu's generic rule 6 has no way to distinguish from an
    // accidental one.
    // recipeId_repetido (sanctioned fixed-dish repeat) and the soft style
    // backstops (dos_fritos_seguidos / dos_cuchara_mismo_dia / proteina_cena_
    // consecutiva) are best-effort and can survive the post-enforcement steps
    // as warnings; they aren't the domains under test here, so they're
    // excluded like recipeId_repetido. proteina_cena_consecutiva in particular
    // fires here for the same root cause as recipeId_repetido itself: the ONLY
    // two non-school-conflicting days available for this fixture (mar/mie) are
    // adjacent, so the fixed dish's own sanctioned 2x/week repeat necessarily
    // lands on consecutive cenas — the post-check correctly leaves it alone
    // (touching either slot would mean overriding the user's own pin).
    // recipeId_not_in_catalog is also expected here and for the same root
    // cause as recipeId_repetido: `pool` is filterRecipes' PRIMARY-only tier
    // (Recetario Estrella + own recipes — see filterRecipes.js's fondo de
    // armario fallback), and this fixture's pinned dish (carnes_002) predates
    // that batch, so it never was and was never meant to be a primary-tier
    // member. enforceFixedDishes (fixedDishes.js) resolves it straight from
    // recipeCatalogById regardless — the real placement is correct, only this
    // re-validation's narrower `pool` doesn't contain it.
    const TOLERATED = new Set([
      "recipeId_repetido",
      "recipeId_not_in_catalog",
      "dos_fritos_seguidos",
      "dos_cuchara_mismo_dia",
      "proteina_cena_consecutiva",
    ]);
    const finalCheck = validateMenu(result.slotAssignments, pool, ctx.slots, [], {});
    const unexpected = finalCheck.violations.filter((v) => !TOLERATED.has(v.rule));
    expect(unexpected).toEqual([]);
  });
});

// Regression test for a bug where planExtraMealsForGroup called
// isBabyMenuGroup(group) with only one argument (missing `data.members`),
// which crashed with "Cannot read properties of undefined (reading 'filter')"
// inside membersOfGroup for EVERY non-baby group — i.e. on virtually every
// real menu generation, since baby groups are the only ones that short-circuit
// before reaching membersOfGroup. Covered end-to-end via generateMenuWithAI
// (the function App.jsx actually calls) so a regression here fails loudly.
describe("generateMenuWithAI extra meals (desayuno/merienda/postre) for a normal group", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("plans desayuno/merienda/postre for a regular (non-baby) group instead of crashing", async () => {
    const group = { id: "g1", label: "Familia", memberIds: ["m1", "kid1"], days: 1 };
    const data = {
      members: [
        { id: "m1", age: 35 },
        { id: "kid1", age: 8 },
      ],
      groups: [group],
      schedule: {},
      extraMeals: { desayuno: "variado", merienda: "semana", postre: "cena" },
    };

    const ctx = buildGroupContext(data, group);
    const { recipes: pool } = filterRecipes(ctx.filterOpts);
    const primero = pool.find((r) => r.mealRole.includes("primero") && !r.mealRole.includes("plato_unico"));
    const segundo = pool.find((r) => r.mealRole.includes("segundo") && r.id !== primero?.id);
    const cena = pool.find((r) => r.mealRole.includes("cena"));
    expect(primero && segundo && cena, "fixture setup: expected primero/segundo/cena candidates").toBeTruthy();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [
            {
              text: JSON.stringify({
                slots: [
                  { slotId: "lun_comida_1", recipeId: primero.id },
                  { slotId: "lun_comida_2", recipeId: segundo.id },
                  { slotId: "lun_cena", recipeId: cena.id },
                ],
              }),
            },
          ],
        }),
      }),
    );

    const { plan } = await generateMenuWithAI(data);
    const groupPlan = plan[group.id];
    // Extra meals are planned for the full week regardless of group.days, so
    // every day should have Desayuno + Postre; Merienda too since the group
    // has a child.
    expect(groupPlan["Lun-Desayuno"]).toBeTruthy();
    expect(groupPlan["Lun-Merienda"]).toBeTruthy();
    expect(groupPlan["Lun-Postre"]).toBeTruthy();
    expect(groupPlan["Dom-Desayuno"]).toBeTruthy();
    expect(groupPlan["Dom-Postre"]).toBeTruthy();
  });

  it("varies desayuno/merienda/postre across weeks instead of repeating the identical day-of-week mapping every time", async () => {
    // Tester report: "Natillas" and "Arroz con leche" landed on the same two
    // weekdays in every week of a multi-week plan. planExtraMealsForGroup had
    // zero awareness of which week it was generating — called once per week
    // with the exact same DAYS.forEach((day, i) => pool[i % pool.length]), it
    // produced the identical mapping forever. Fixed by threading
    // crossWeek.weekIndex through as a rotation offset.
    const group = { id: "g1", label: "Familia", memberIds: ["m1", "kid1"], days: 1 };
    const data = {
      members: [
        { id: "m1", age: 35 },
        { id: "kid1", age: 8 },
      ],
      groups: [group],
      schedule: {},
      extraMeals: { desayuno: "variado", merienda: "semana", postre: "cena" },
    };

    const ctx = buildGroupContext(data, group);
    const { recipes: pool } = filterRecipes(ctx.filterOpts);
    const primero = pool.find((r) => r.mealRole.includes("primero") && !r.mealRole.includes("plato_unico"));
    const segundo = pool.find((r) => r.mealRole.includes("segundo") && r.id !== primero?.id);
    const cena = pool.find((r) => r.mealRole.includes("cena"));

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [
            {
              text: JSON.stringify({
                slots: [
                  { slotId: "lun_comida_1", recipeId: primero.id },
                  { slotId: "lun_comida_2", recipeId: segundo.id },
                  { slotId: "lun_cena", recipeId: cena.id },
                ],
              }),
            },
          ],
        }),
      }),
    );

    const week0 = await generateMenuWithAI(data, { crossWeek: { weekIndex: 0, weekCount: 2, varietyPref: "strict" } });
    const week1 = await generateMenuWithAI(data, { crossWeek: { weekIndex: 1, weekCount: 2, varietyPref: "strict" } });

    const postreWeek0 = week0.plan[group.id]["Lun-Postre"]?.recipeId;
    const postreWeek1 = week1.plan[group.id]["Lun-Postre"]?.recipeId;
    const desayunoWeek0 = week0.plan[group.id]["Lun-Desayuno"]?.recipeId;
    const desayunoWeek1 = week1.plan[group.id]["Lun-Desayuno"]?.recipeId;

    expect(postreWeek0).toBeTruthy();
    expect(postreWeek1).toBeTruthy();
    // At least one of the rotated extra meals must differ between weeks —
    // asserting on both together (rather than picking just one) avoids a
    // flaky test if either pool happens to be small enough that a 1-step
    // offset lands back on the same dish for that particular axis.
    expect([postreWeek0, desayunoWeek0]).not.toEqual([postreWeek1, desayunoWeek1]);

    // Same weekIndex twice must stay fully deterministic (no hidden randomness).
    const week0Again = await generateMenuWithAI(data, { crossWeek: { weekIndex: 0, weekCount: 2, varietyPref: "strict" } });
    expect(week0Again.plan[group.id]["Lun-Postre"]?.recipeId).toBe(postreWeek0);
    expect(week0Again.plan[group.id]["Lun-Desayuno"]?.recipeId).toBe(desayunoWeek0);
  });

  it("varies desayuno/merienda/postre across independent single-week generations (no crossWeek at all)", async () => {
    // Tester report: postres always came back in the exact same order — turned
    // out planExtraMealsForGroup rotates with pool[(dayIndex + weekIndex) %
    // pool.length], and a plain "Generar menú" (weekCount 1, the overwhelming
    // majority of real usage — see App.jsx's crossWeek = weekCount <= 1 ? null
    // : {...}) never passes a crossWeek at all, so the offset silently defaulted
    // to a hardcoded 0 on every single call. Every regeneration therefore
    // produced the identical Lun→Dom postre mapping. Fixed by falling back to a
    // fresh random offset instead of 0 when there's no crossWeek to be
    // consistent with (the previous test already locks down that an EXPLICIT
    // weekIndex must stay fully reproducible — this one only relaxes the
    // no-crossWeek default).
    const group = { id: "g1", label: "Familia", memberIds: ["m1"], days: 1 };
    const data = {
      members: [{ id: "m1", age: 35 }],
      groups: [group],
      schedule: {},
      extraMeals: { desayuno: "variado", postre: "cena" },
    };

    const ctx = buildGroupContext(data, group);
    const { recipes: pool } = filterRecipes(ctx.filterOpts);
    const primero = pool.find((r) => r.mealRole.includes("primero") && !r.mealRole.includes("plato_unico"));
    const segundo = pool.find((r) => r.mealRole.includes("segundo") && r.id !== primero?.id);
    const cena = pool.find((r) => r.mealRole.includes("cena"));

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [
            {
              text: JSON.stringify({
                slots: [
                  { slotId: "lun_comida_1", recipeId: primero.id },
                  { slotId: "lun_comida_2", recipeId: segundo.id },
                  { slotId: "lun_cena", recipeId: cena.id },
                ],
              }),
            },
          ],
        }),
      }),
    );

    const runs = [];
    for (let i = 0; i < 10; i++) {
      const { plan } = await generateMenuWithAI(data);
      runs.push([plan[group.id]["Lun-Postre"]?.recipeId, plan[group.id]["Lun-Desayuno"]?.recipeId]);
    }
    for (const [postre, desayuno] of runs) {
      expect(postre).toBeTruthy();
      expect(desayuno).toBeTruthy();
    }
    const distinct = new Set(runs.map((r) => r.join("|")));
    expect(distinct.size).toBeGreaterThan(1);
  });
});

describe("callModel retry on transient overload", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("retries on a 529 (overloaded) and succeeds once the API recovers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 529, json: async () => ({ error: "Overloaded" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ content: [{ text: "hola" }] }) });
    vi.stubGlobal("fetch", fetchMock);

    const promise = callModel({ model: "m", max_tokens: 10, system: "s", messages: [] });
    await vi.runAllTimersAsync();
    expect(await promise).toBe("hola");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after exhausting retries on repeated 529s", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 529, json: async () => ({ error: "Overloaded" }) });
    vi.stubGlobal("fetch", fetchMock);

    const promise = callModel({ model: "m", max_tokens: 10, system: "s", messages: [] });
    const assertion = expect(promise).rejects.toThrow(AIPlannerError);
    await vi.runAllTimersAsync();
    await assertion;
    // Initial attempt + 2 retries (RETRY_DELAYS_MS has 2 entries).
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-retryable client error (e.g. 400)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "Bad request" }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callModel({ model: "m", max_tokens: 10, system: "s", messages: [] }),
    ).rejects.toThrow(AIPlannerError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// D4c (Fase 5): "strict" ("cosas distintas cada semana") reparte el pool en
// buckets disjuntos best-effort, sin dependencia entre semanas (paralelizable).
describe("poolForWeek — variedad multi-semana", () => {
  const pool = Array.from({ length: 60 }, (_, i) => ({ id: `r${i}` }));
  const slotCount = 6;

  it("no toca el pool sin crossWeek o con una sola semana", () => {
    expect(poolForWeek(pool, null, slotCount)).toBe(pool);
    expect(poolForWeek(pool, { weekIndex: 0, weekCount: 1, varietyPref: "strict" }, slotCount)).toBe(pool);
    expect(poolForWeek(pool, { weekIndex: 0, weekCount: 3, varietyPref: "relaxed" }, slotCount)).toBe(pool);
  });

  it("strict: las semanas quedan disjuntas cuando el pool es holgado", () => {
    const weekCount = 3;
    const weeks = [0, 1, 2].map((weekIndex) =>
      new Set(poolForWeek(pool, { weekIndex, weekCount, varietyPref: "strict" }, slotCount).map((r) => r.id)),
    );
    for (let a = 0; a < weeks.length; a++) {
      for (let b = a + 1; b < weeks.length; b++) {
        const overlap = [...weeks[a]].filter((id) => weeks[b].has(id));
        expect(overlap).toEqual([]);
      }
    }
    // Cada semana conserva bastantes recetas para tener margen de elección.
    for (const w of weeks) expect(w.size).toBeGreaterThanOrEqual(slotCount);
  });

  it("strict con pool ajustado: hace top-up best-effort sin fallar (no lanza)", () => {
    const small = Array.from({ length: 14 }, (_, i) => ({ id: `s${i}` }));
    expect(() =>
      [0, 1].map((weekIndex) =>
        poolForWeek(small, { weekIndex, weekCount: 2, varietyPref: "strict" }, slotCount),
      ),
    ).not.toThrow();
    const w0 = poolForWeek(small, { weekIndex: 0, weekCount: 2, varietyPref: "strict" }, slotCount);
    expect(w0.length).toBeGreaterThanOrEqual(slotCount);
  });
});

describe("mergeIngredientLines", () => {
  it("junta el mismo ingrediente en una sola linea y suma", () => {
    // Un plato con guarnicion y salsa es la suma de tres recetas, y las tres
    // llevan sal y aceite: la ficha salia con "Sal" tres veces.
    const merged = mergeIngredientLines([
      { id: "sal", name: "Sal", qty: 10, unit: "g" },
      { id: "aceite", name: "Aceite de oliva", qty: 40, unit: "ml" },
      { id: "garnish-sal", name: "sal", qty: 5, unit: "g" },
      { id: "sauce-aceite", name: "Aceite de oliva", qty: 20, unit: "ml" },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ name: "Sal", qty: 15, unit: "g" });
    expect(merged[1]).toMatchObject({ name: "Aceite de oliva", qty: 60, unit: "ml" });
  });

  it("entre 'al gusto' y una cantidad, manda la cantidad", () => {
    const merged = mergeIngredientLines([
      { name: "Sal", qty: null, unit: "al gusto" },
      { name: "Sal", qty: 8, unit: "g" },
    ]);
    expect(merged).toEqual([expect.objectContaining({ name: "Sal", qty: 8, unit: "g" })]);
  });

  it("no suma unidades que no se pueden sumar", () => {
    // Sumar 50 g con 30 ml seria inventarse una densidad.
    const merged = mergeIngredientLines([
      { name: "Nata", qty: 50, unit: "g" },
      { name: "Nata", qty: 30, unit: "ml" },
    ]);
    expect(merged).toHaveLength(2);
  });

  it("deja en null lo que no tiene cantidad por ningun lado", () => {
    const merged = mergeIngredientLines([
      { name: "Pimienta", qty: null, unit: "al gusto" },
      { name: "Pimienta", qty: null, unit: "al gusto" },
    ]);
    expect(merged).toEqual([expect.objectContaining({ name: "Pimienta", qty: null })]);
  });
});
