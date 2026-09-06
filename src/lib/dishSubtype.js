/**
 * Finer-grained subtype detection, one level below the coarse protein GROUPS
 * (carne/pescado/legumbres/huevos) that aiPlanner.js and validateMenu.js
 * already dedupe by. Those groups collapse every legume into "legumbres" and
 * every mussel/clam/prawn into "pescado", so a week can legally repeat
 * garbanzos twice (still under the legumbres/semana cap) or serve two
 * shellfish-only cenas back to back without either rule ever seeing it.
 *
 * Like recipeDiversity.js's recipeProteinKey, this is name/ingredient text
 * matching rather than a new catalog field: no recipe in the catalog records
 * "which legume" or "which shellfish family" it is, and adding + backfilling
 * that field for ~2000 recipes is a much bigger change than the variety gap
 * it would close. Returns null when nothing matches, so callers can treat
 * "no subtype detected" as "nothing to dedupe against" rather than a clash.
 */

function normalizedText(recipe) {
  const ing = (recipe?.ingredients ?? []).map((i) => i.name).join(" ");
  return `${recipe?.name ?? ""} ${ing}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

const LEGUME_SUBTYPES = [
  [/garbanz/, "garbanzo"],
  [/lentej/, "lenteja"],
  [/alubi|judia blanca|judión|fabe/, "alubia"],
  [/haba/, "haba"],
  [/guisante/, "guisante"],
];

/** e.g. "garbanzo" | "lenteja" | "alubia" | "haba" | "guisante" | null */
export function legumeSubtypeOf(recipe) {
  if (!recipe) return null;
  const text = normalizedText(recipe);
  for (const [pattern, subtype] of LEGUME_SUBTYPES) {
    if (pattern.test(text)) return subtype;
  }
  return null;
}

// Ordered so a dish naming both a mollusk and a crustacean (e.g. "Fideuá con
// mejillones y gambas") is filed under its shellfish family, not "pescado" —
// checked before the broader fish patterns.
const MARISCO_SUBTYPES = [
  [/mejill[oó]n|almeja|navaja|berbereche|zamburi[ñn]a|vieira|percebe/, "molusco"],
  [/gamba|langostino|cigala|bogavante|centollo|nécora|buey de mar|camar[oó]n/, "crustaceo"],
  [/sepia|calamar|pulpo|chipir[oó]n/, "cefalopodo"],
  [/salm[oó]n|caballa|atun|atún|sardina|boquer[oó]n|bonito/, "pescado_azul"],
  [/merluza|bacalao|lenguado|rape|dorada|lubina|gallo\b/, "pescado_blanco"],
];

/** e.g. "molusco" | "crustaceo" | "cefalopodo" | "pescado_azul" | "pescado_blanco" | null */
export function mariscoSubtypeOf(recipe) {
  if (!recipe) return null;
  const text = normalizedText(recipe);
  for (const [pattern, subtype] of MARISCO_SUBTYPES) {
    if (pattern.test(text)) return subtype;
  }
  return null;
}

// A cena made only of shellfish-in-the-shell (mejillones, navajas, almejas…)
// reads as a tapa, not a full dinner course — the family the family reported
// as "super incompleta" is exactly the "molusco" subtype above.
export function isShellOnlyMarisco(recipe) {
  return mariscoSubtypeOf(recipe) === "molusco";
}
