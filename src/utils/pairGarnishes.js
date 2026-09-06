import guarniciones from "../data/recipes/guarniciones.json";
import { getCarbType, COMIDA_KCAL_SOFT_CAP } from "./validateMenu.js";

const CENA_MAX_GARNISH_TIME = 15;

// Same patterns as validateMenu.js getCarbType, applied to garnish shortName
const CARB_PATTERNS = [
  [/arroz/, "arroz"],
  [/pasta|ajillo.*pasta|espagueti/, "pasta"],
  [/patata|pur[eé]/, "patatas"],
  [/quinoa/, "quinoa"],
  [/c[uú]sc[uú]s/, "cuscus"],
  [/\bpan\b/, "pan"],
];

function carbOfGarnish(g) {
  const text = (g.shortName ?? g.name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  for (const [pat, carb] of CARB_PATTERNS) {
    if (pat.test(text)) return carb;
  }
  return null;
}

// Carb detection for full catalog recipes reuses validateMenu's taxonomy
// directly. It used to be a verbatim copy of that pattern list, which meant
// every taxonomy fix had to be made twice or the two would silently disagree
// about what counts as the same base.
const carbOfRecipe = getCarbType;

// Bread is never an automatic side — a plain baguette doesn't belong plated next
// to a main. It can still be attached as a pinned/user choice. Detected via its
// "pan" carb type.
function isPanGarnish(g) {
  return carbOfGarnish(g) === "pan";
}

// A garnish with no starch is treated as "vegetable" (judías, brócoli, menestra,
// ensalada…). Used to avoid a veg garnish when the day already leans vegetable
// (veg primero or another veg side) — veg + veg reads as an unbalanced comida.
function isVegGarnish(g) {
  return carbOfGarnish(g) === null;
}

// A main recipe counts as "vegetable-forward" when it's a salad/vegetable dish.
function isVegRecipe(recipe) {
  return recipe?.category === "ensaladas_verduras";
}

// A deep-fried garnish (patatas fritas) only makes sense next to meat or fish —
// it never goes with an egg dish (tortilla), a salad or a pasta/rice plate. Real
// "huevos con patatas fritas y chorizo" is a whole dish, not a segundo + side, so
// eggs are deliberately excluded here.
function isFriedGarnish(g) {
  return Array.isArray(g.healthFlags) && g.healthFlags.includes("frito");
}
function friedGarnishFitsMain(g, mainRecipe) {
  if (!isFriedGarnish(g)) return true;
  return mainRecipe?.category === "carnes" || mainRecipe?.category === "pescados";
}

function normalizeText(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Aromatics/condiments show up in almost every recipe, so they can never be a
// garnish's "star" ingredient — otherwise cebolla/ajo would clash with the whole
// catalog. The star is the first listed ingredient that isn't one of these.
const GARNISH_STOPWORDS =
  /^(aceite|sal|vinagre|limon|ajo|perejil|cebolla|oregano|pimienta|pimenton|mantequilla|leche|nata|nuez|miel|menta|hierba|especia|azucar|laurel|tomillo|romero|comino|guindilla)/;

// The garnish's headline ingredient, e.g. "Ensalada de tomate con cebolla" → "tomate".
function garnishStarWord(g) {
  for (const ing of g.ingredients ?? []) {
    const n = normalizeText(ing.name);
    const word = n.split(/\s+/)[0];
    if (!word || word.length < 3) continue;
    if (GARNISH_STOPWORDS.test(word)) continue;
    return word;
  }
  return null;
}

// A garnish that repeats the main's headline ingredient reads as redundant
// ("Bacalao con tomate" + "Ensalada de tomate"). Detected by matching the
// garnish's star word against the main recipe's name and ingredient list.
function garnishClashesWithMain(g, recipe) {
  const star = garnishStarWord(g);
  if (!star) return false;
  const hay = normalizeText(
    (recipe.name ?? "") + " " + (recipe.ingredients ?? []).map((i) => i.name).join(" "),
  );
  return new RegExp(`\\b${star}`).test(hay);
}

/**
 * For each "principal" recipe in a comida_2 or cena slot, picks a garnish
 * from guarniciones.json at random among every candidate that satisfies the
 * rules below (never just the first match in the JSON's fixed order — that
 * used to make e.g. "pasta al ajillo" win almost every cena, every week).
 *
 * Rules:
 * - No repeated carb type within the same day (main recipes + garnishes combined)
 * - No repeated garnish across the week
 * - Cena slots: garnish time must be ≤ 15 min
 * - Comida (segundo) slots: recipe + garnish + that day's primero must stay
 *   under COMIDA_KCAL_SOFT_CAP combined (see below)
 *
 * A user can pin a specific garnish to a dish (picked from the catalog) via
 * `pinnedByRecipeId`. A pinned garnish always wins over the automatic rules
 * (carb repetition / cena time limit / kcal cap) — the user's choice takes
 * priority.
 *
 * @param {Array<{slotId: string, recipeId: string}>} slotAssignments
 * @param {Object} poolById - { [recipeId]: catalogRecipe }
 * @param {Object<string,string>} [pinnedByRecipeId] - { [recipeId]: garnishId }
 * @param {Object[]} [safeGarnishes] - guarniciones pre-filtered for the
 *   group's allergies/intolerances/hasKids (see filterRecipes.js
 *   `filterGarnishes`). Defaults to the full unfiltered catalog, but every
 *   real caller should pass the filtered list — this default only exists so
 *   call sites that genuinely have no restriction context don't crash.
 * @param {"off"|"week"|"weekdays"|"weekend"} [garnishRepeat]
 * @returns {Array<{slotId: string, recipeId: string, garnishId?: string}>}
 */
export function pairGarnishes(slotAssignments, poolById, pinnedByRecipeId = {}, safeGarnishes = guarniciones, garnishRepeat = "off") {
  // Collect carbs already used by main recipes, per day
  const dayUsedCarbs = {};
  // Track whether each day already leans vegetable (a salad/veg main), so the
  // pairing avoids stacking a veg garnish on top (veg + veg).
  const dayHasVeg = {};
  // Track whether a day's MAIN course already brings a starch (arroz/pasta/
  // patatas…), so a segundo garnish doesn't turn the comida into a double-carb
  // bomb (arroz de primero + patatas de guarnición). Computed from mains only,
  // before any garnish carbs are folded into dayUsedCarbs below.
  const dayHasStarchMain = {};
  const WEEKEND = new Set(["sab", "dom"]);
  let weekAnchor = null;
  let weekdayAnchor = null;
  let weekendAnchor = null;
  for (const { slotId, recipeId } of slotAssignments) {
    const daySlug = slotId.split("_")[0];
    const recipe = poolById[recipeId];
    if (!recipe) continue;
    if (isVegRecipe(recipe)) dayHasVeg[daySlug] = true;
    const carb = carbOfRecipe(recipe);
    if (!carb) continue;
    dayHasStarchMain[daySlug] = true;
    if (!dayUsedCarbs[daySlug]) dayUsedCarbs[daySlug] = new Set();
    dayUsedCarbs[daySlug].add(carb);
  }

  const usedGarnishIds = new Set();

  return slotAssignments.map((slot) => {
    const { slotId, recipeId } = slot;
    const recipe = poolById[recipeId];

    if (!recipe || recipe.type !== "principal") return slot;
    const roles = recipe.mealRole ?? [];
    if (roles.includes("plato_unico")) return slot;

    const parts = slotId.split("_");
    const daySlug = parts[0];
    const mealType = parts[1];
    const position = parts[2];

    // Only pair comida_2 and cena
    if (mealType === "comida" && position !== "2") return slot;
    if (mealType !== "comida" && mealType !== "cena") return slot;

    const isCena = mealType === "cena";
    const dayCarbs = dayUsedCarbs[daySlug] ?? new Set();

    // Comida (segundo) only: the day's primero kcal, so a garnish never turns
    // this pairing into a plato_unico-heavy combo that duplicates an existing
    // catalog dish (tester report: "Huevos fritos con puntillas" + the
    // "Arroz blanco" garnish landed at ~580kcal — basically "Arroz a la
    // cubana" — while still being served alongside a primero). Only "comida"
    // reaches this point with position "2" (cena was filtered out above), so
    // no extra position check is needed. null = no primero on record, so
    // there's nothing to guard against.
    let siblingKcal = null;
    if (mealType === "comida") {
      const siblingSlot = slotAssignments.find((s) => s.slotId === `${daySlug}_comida_1`);
      const siblingRecipe = siblingSlot ? poolById[siblingSlot.recipeId] : null;
      if (siblingRecipe) siblingKcal = siblingRecipe.kcal ?? 0;
    }
    const weightOk = (g) =>
      siblingKcal === null || (recipe.kcal ?? 0) + siblingKcal + (g.kcal ?? 0) <= COMIDA_KCAL_SOFT_CAP;

    // Pinned garnish (user picked it for this exact dish) wins over auto rules.
    // Either pinned per fixed-dish combo (pinnedByRecipeId) or baked into the
    // recipe itself when created in the recipe planner (recipe.pinnedGarnishId).
    let garnish = null;
    const pinnedId = pinnedByRecipeId[recipeId] ?? recipe.pinnedGarnishId;
    if (pinnedId) {
      garnish = guarniciones.find((g) => g.id === pinnedId) ?? null;
    }

    // Una receta del Recetario Estrella NO se combina con nada. Viene escrita
    // como un plato entero -"Lenguado meunière con mantequilla y limón" ya
    // trae su salsa y su punto-, asi que pegarle una guarnicion de la
    // combinatoria del catalogo viejo producia titulos imposibles ("...con
    // alcachofas confitadas con jamon"), platos de 20 ingredientes y la misma
    // sal y el mismo aceite repetidos tres veces. La combinatoria se diseño
    // para el fondo de armario, donde los platos SI son piezas sueltas; el
    // recetario estrella no es eso y no hay que "completarlo".
    //
    // Lo mismo aplica a cualquier receta con llevaSalsa: true, sea o no
    // Recetario Estrella — "Merluza en salsa verde" o "Pollo al ajillo" ya
    // traen su salsa escrita dentro, así que pegarles TAMBIÉN una guarnición
    // automática (patatas panaderas, ensalada...) deja el plato recargado:
    // salsa propia + guarnición ajena compitiendo en el mismo plato. Es
    // literalmente el principio que ya declara recipeSchema.js sobre este
    // campo — "aquí no se combinan platos con salsas: cada receta es la que
    // es" — que hasta ahora esta función no respetaba para la guarnición.
    //
    // Lo elegido a mano se respeta igual: fijar una guarnicion es una decision
    // de quien cocina, no algo que la app se invente.
    if (!garnish && (recipe.estrella || recipe.llevaSalsa)) return slot;

    if (!garnish) {
      // A fried side (patatas fritas) only pairs with meat/fish — never a
      // tortilla, salad or pasta plate. Applied before every pass below so no
      // relaxation tier can sneak it back in for an egg/veg main.
      // A garnish can also declare `preferMeal: "cena"` (patatas fritas read as
      // a dinner classic, not a lunch side); those are dropped from comida slots
      // unless nothing else is eligible.
      let eligible = safeGarnishes.filter(
        (g) => friedGarnishFitsMain(g, recipe) && (isCena || g.preferMeal !== "cena"),
      );
      if (eligible.length === 0) eligible = safeGarnishes.filter((g) => friedGarnishFitsMain(g, recipe));
      // Bread is never auto-paired (only ever pinned by the user), so it's
      // excluded from every candidate pass below.
      const fitsRules = (g) => {
        if (isPanGarnish(g)) return false;
        if (usedGarnishIds.has(g.id)) return false;
        if (isCena && g.time > CENA_MAX_GARNISH_TIME) return false;
        const gCarb = carbOfGarnish(g);
        if (gCarb && dayCarbs.has(gCarb)) return false;
        if (!weightOk(g)) return false;
        return true;
      };
      // Every garnish meeting the rules is an equally valid pick — choosing
      // randomly among them (instead of always the first match in the JSON's
      // fixed order) is what actually gives week-to-week variety.
      let candidates = eligible.filter(fitsRules);
      // Relax "not used yet this week" before giving up entirely, so a slot
      // never goes without a side just because the week is running low on
      // fresh garnishes (still respects the cena time cap, day carb rule and
      // kcal cap).
      if (candidates.length === 0) {
        candidates = eligible.filter((g) => {
          if (isPanGarnish(g)) return false;
          if (isCena && g.time > CENA_MAX_GARNISH_TIME) return false;
          const gCarb = carbOfGarnish(g);
          if (gCarb && dayCarbs.has(gCarb)) return false;
          if (!weightOk(g)) return false;
          return true;
        });
      }
      // Last resort: relax the kcal cap too, so a segundo is never left
      // without any garnish at all just because every remaining option
      // would push the comida over budget.
      if (candidates.length === 0) {
        candidates = eligible.filter((g) => {
          if (isPanGarnish(g)) return false;
          if (isCena && g.time > CENA_MAX_GARNISH_TIME) return false;
          const gCarb = carbOfGarnish(g);
          if (gCarb && dayCarbs.has(gCarb)) return false;
          return true;
        });
      }
      // Cena-only final fallback: bread. It's excluded from every tier above
      // because a baguette plated next to a normal segundo reads as
      // redundant — but a cena main that's shellfish-in-the-shell or another
      // light single-ingredient plate (mejillones, navajas…) with NO other
      // eligible side left this week would otherwise ship completely bare,
      // which is exactly what was reported as "una cena no puede ser solo
      // navajas/mejillones, es incompleta". Pan is a normal way to round out
      // that kind of cena in practice, so it's better than nothing here even
      // though it's never proactively chosen while a non-bread side exists.
      if (candidates.length === 0 && isCena) {
        candidates = eligible.filter((g) => {
          if (!isPanGarnish(g)) return false;
          const gCarb = carbOfGarnish(g);
          return !(gCarb && dayCarbs.has(gCarb));
        });
      }
      // Avoid a garnish that duplicates the main's headline ingredient
      // ("Bacalao con tomate" + "Ensalada de tomate"). For a segundo, also guard
      // against repeating the day's primero star — otherwise "Ensalada de tomate"
      // (primero) + "Atún con ensalada de tomate" (garnish) reads as double
      // tomato. Only narrow the pool when a non-clashing option remains — never
      // leave a slot bare.
      const primeroRecipe =
        mealType === "comida"
          ? poolById[slotAssignments.find((s) => s.slotId === `${daySlug}_comida_1`)?.recipeId]
          : null;
      const nonClashing = candidates.filter(
        (g) =>
          !garnishClashesWithMain(g, recipe) &&
          (!primeroRecipe || !garnishClashesWithMain(g, primeroRecipe)),
      );
      if (nonClashing.length > 0) candidates = nonClashing;
      // If the day already leans vegetable (veg primero or a veg side already
      // placed), prefer a starch garnish so the comida stays balanced. Only
      // narrow the pool when non-veg options exist — never leave a slot bare.
      if (dayHasVeg[daySlug]) {
        const nonVeg = candidates.filter((g) => !isVegGarnish(g));
        if (nonVeg.length > 0) candidates = nonVeg;
      } else if (dayHasStarchMain[daySlug]) {
        // The day's main already carries a starch (e.g. arroz de primero); prefer
        // a vegetable garnish so the comida isn't a double-carb bomb. Only narrow
        // the pool when a veg option remains — never leave a slot bare.
        const veg = candidates.filter((g) => isVegGarnish(g));
        if (veg.length > 0) candidates = veg;
      }
      if (candidates.length > 0) {
        garnish = candidates[Math.floor(Math.random() * candidates.length)];
      }
    }

    if (!garnish) return slot;

    // Batch-cook mode: reuse the first garnish of the period (whole week /
    // weekdays / weekend) instead of picking a new side every day.
    const isWeekend = WEEKEND.has(daySlug);
    if (garnishRepeat === "week" && weekAnchor) {
      garnish = safeGarnishes.find((g) => g.id === weekAnchor) ?? garnish;
    } else if (garnishRepeat === "weekdays" && !isWeekend && weekdayAnchor) {
      garnish = safeGarnishes.find((g) => g.id === weekdayAnchor) ?? garnish;
    } else if (garnishRepeat === "weekend" && isWeekend && weekendAnchor) {
      garnish = safeGarnishes.find((g) => g.id === weekendAnchor) ?? garnish;
    } else if (garnishRepeat === "week" && !weekAnchor) {
      weekAnchor = garnish.id;
    } else if (garnishRepeat === "weekdays" && !isWeekend && !weekdayAnchor) {
      weekdayAnchor = garnish.id;
    } else if (garnishRepeat === "weekend" && isWeekend && !weekendAnchor) {
      weekendAnchor = garnish.id;
    }

    usedGarnishIds.add(garnish.id);

    // Register garnish carb so later slots in the same day don't repeat it
    const gCarb = carbOfGarnish(garnish);
    if (gCarb) {
      if (!dayUsedCarbs[daySlug]) dayUsedCarbs[daySlug] = new Set();
      dayUsedCarbs[daySlug].add(gCarb);
    }
    // Register a veg side so the rest of the day avoids piling on more veg.
    if (isVegGarnish(garnish)) dayHasVeg[daySlug] = true;

    return { ...slot, garnishId: garnish.id };
  });
}
