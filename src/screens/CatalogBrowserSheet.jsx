import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Search,
  SlidersHorizontal,
  X,
  Plus,
  Check,
  Clock,
  Flame,
  Baby,
  Drumstick,
  Fish,
  Egg,
  Wheat,
  Soup,
  Salad,
  Coffee,
  Apple,
  IceCream,
  Bean,
  Utensils,
  Tag,
  ChevronRight,
  ChevronLeft,
  BarChart3,
  Sparkles,
  Heart,
  Globe,
  Users2,
  ThumbsUp,
  MessageCircle,
  Lock,
  ChevronDown,
  Trash2,
  Pencil,
  Ban,
  RotateCcw,
  BookOpen,
  NotebookPen,
  CalendarDays,
  Zap,
  Folder as FolderIcon,
  FolderPlus,
  Droplets,
  Sun,
  Snowflake,
  MilkOff,
} from "lucide-react";
import { recipeCatalog, recipeCatalogById } from "../data/recipeCatalog.js";
import { loadRecipeStats } from "../lib/social.js";
import { isMontaje } from "../data/recipeSchema.js";
import { isCompatibleWith } from "../lib/substitutions.js";
import guarnicionesData from "../data/recipes/guarniciones.json";
import salsasData from "../data/recipes/salsas.json";
import { dishImageUrl, dishImageForRecipe } from "../assets/dishes/dishImages.js";
import { deckImg } from "../lib/dishPhotoOptimize.js";
import { allFolders, collectionRecipeIds, collectionCounts, DISCARDED_ID } from "../lib/recipeCollections.js";

// Carpeta virtual: todo lo que has guardado, sin filtrar por carpeta.
export const ALL_ID = "__all__";

// Arte de cada carpeta fija, reusando las ilustraciones que ya existen — las
// tres facetas coinciden con el criterio real del filtro (gourmet = apetecible,
// rápido, peques), así que la imagen dice la verdad sobre lo que hay dentro.
// Las carpetas del usuario no tienen arte propio y caen en la genérica.
const COLLECTION_ART = {
  [ALL_ID]: { Icon: NotebookPen, img: "/avatares/cards/empty_recetas_propias.jpg" },
  dia_a_dia: { Icon: CalendarDays, img: "/avatares/cards/comidas.jpg" },
  ocasion_especial: { Icon: Sparkles, img: "/categories/faceta_gourmet.webp" },
  cena_rapida: { Icon: Zap, img: "/categories/faceta_rapido.webp" },
  hijos: { Icon: Baby, img: "/categories/faceta_ninos.webp" },
  [DISCARDED_ID]: { Icon: Trash2, img: "/avatares/cards/empty_descartes.jpg" },
};

const CUSTOM_FOLDER_ART = { Icon: FolderIcon, img: "/avatares/cards/otros.jpg" };

export const folderArt = (id) => COLLECTION_ART[id] ?? CUSTOM_FOLDER_ART;
import { favoriteRecipeIds, getFavoriteScope, isRecipeFavorite, applyFavoriteScopePick } from "../lib/recipeVotes.js";
import { categoryImageSrc, proteinImageSrc } from "../lib/ingredientImages.js";
import { RecipeProvenance } from "../components/RecipeProvenance.jsx";
import { FavoriteScopeModal } from "../components/FavoriteScopeModal.jsx";
import { EmptyIllustration, SegmentedTabBar, SegmentedTabButton } from "../components/ui.jsx";

const GARNISHES = guarnicionesData;
const GARNISH_BY_ID = Object.fromEntries(guarnicionesData.map((g) => [g.id, g]));
const SALSAS = salsasData;
const SALSA_BY_ID = Object.fromEntries(salsasData.map((s) => [s.id, s]));

const GREEN = "#2d5a3d";

const CATEGORY_META = {
  legumbres:          { label: "Legumbres",     icon: Bean,           color: "#b9770e", img: "/categories/legumbres.png" },
  carnes:             { label: "Carnes",         icon: Drumstick,      color: "#c0392b", img: "/categories/carnes.png" },
  pescados:           { label: "Pescados",       icon: Fish,           color: "#2f6f9f", img: "/categories/pescados.png" },
  huevos:             { label: "Huevos",         icon: Egg,            color: "#d4a017", img: "/categories/huevos.png" },
  pasta_arroces:      { label: "Pasta y arroz",  icon: Wheat,          color: "#cf7833", img: "/categories/pasta_arroces.png" },
  sopas_cremas:       { label: "Sopas y cremas", icon: Soup,           color: "#8a6cc4", img: "/categories/sopas_cremas.png" },
  ensaladas_verduras: { label: "Verduras",       icon: Salad,          color: "#3f9656", img: "/categories/ensaladas_verduras.png" },
  platos_unicos:      { label: "Platos únicos",  icon: Utensils,       color: "#5a7066", img: "/categories/platos_unicos.png" },
  cenas_rapidas:      { label: "Cenas rápidas",  icon: Soup,           color: "#d56b9a", img: "/categories/cenas_rapidas.png" },
  bebes:              { label: "Bebés",           icon: Baby,           color: "#6cb4c4", img: "/categories/bebes.png" },
  desayunos:          { label: "Desayunos",       icon: Coffee,         color: "#c98a3a", img: "/categories/desayunos.png" },
  meriendas:          { label: "Meriendas",       icon: Apple,          color: "#4a9d6b", img: "/categories/meriendas.png" },
  postres:            { label: "Postres",         icon: IceCream,       color: "#c463a0", img: "/categories/postres.png" },
  guarniciones:       { label: "Guarnición",      icon: Salad,          color: "#3f9656", img: "/categories/guarniciones.png" },
  salsas:             { label: "Salsas",          icon: Droplets,       color: "#c2703d", img: "/categories/salsas.png" },
};

// Estante horizontal de facetas (eje secundario) sobre la barra de búsqueda.
// A diferencia de CATEGORY_META (qué es el plato), esto es cómo se usa —
// no son categorías nuevas, son lentes sobre el mismo catálogo. "wired"
// marca cuáles ya tienen filtro real detrás. gourmet filtra por `apetecible`
// (2026-08-28: el campo llevaba desde siempre en el schema pero sin curar en
// ninguna receta — se está rellenando aparte, por lotes, en los JSON del
// catálogo); verano/invierno filtran por `season` (ese campo sí ya tenía
// datos reales en el catálogo, solo faltaba conectar el chip).
const FACET_META = {
  ninos:    { label: "Para peques", img: "/categories/faceta_ninos.webp", wired: true, color: "#d56b9a", Icon: Baby },
  // "rapido" filtra por `montaje` (isMontaje) — se monta, no se cocina de
  // verdad (tostas, sándwiches, gazpachos...) — no por tiempo/dificultad
  // como antes, que colaba cualquier plato rápido aunque requiriera cocinar.
  rapido:   { label: "Cenas rápidas", img: "/categories/faceta_rapido.webp", wired: true, color: "#cf7833", Icon: Clock },
  gourmet:  { label: "Platos gourmet", img: "/categories/faceta_gourmet.webp", wired: true, color: "#a97e21", Icon: Sparkles },
  verano:   { label: "De verano", img: "/categories/faceta_verano.webp", wired: true, color: "#e0a83a", Icon: Sun },
  invierno: { label: "De invierno", img: "/categories/faceta_invierno.webp", wired: true, color: "#4f5c78", Icon: Snowflake },
  // Filtra por isCompatibleWith("lactosa_fina"): entran tanto los platos que ya
  // no llevan lácteos como los que los llevan pero se pueden cambiar por su
  // versión sin lactosa. La pregunta es "qué puedo comer", no "qué hay que
  // tocar" — eso lo dice el distintivo de la ficha.
  //
  // OJO: es la INTOLERANCIA, no la alergia a la leche. Un producto sin lactosa
  // conserva la proteína láctea, así que un alérgico no puede guiarse por este
  // filtro; para él la receta se excluye en filterRecipes y no aparece.
  sin_lactosa: { label: "Sin lactosa", wired: true, color: "#4a7ab8", Icon: MilkOff },
};

const DEFAULT_COLOR = "#5a7066";
export function categoryColor(cat) {
  return CATEGORY_META[cat]?.color ?? DEFAULT_COLOR;
}

export function categoryIcon(cat) {
  return CATEGORY_META[cat]?.icon ?? Utensils;
}

export function isKnownCategory(cat) {
  return Boolean(cat) && Object.prototype.hasOwnProperty.call(CATEGORY_META, cat);
}

const DIFFICULTY_LABEL = { facil: "Fácil", normal: "Media", elaborada: "Difícil" };
const TIME_OPTIONS = [
  { value: 0, label: "Cualquiera" },
  { value: 20, label: "≤ 20 min" },
  { value: 30, label: "≤ 30 min" },
  { value: 45, label: "≤ 45 min" },
];

function norm(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function titleCase(s) {
  const t = String(s ?? "").trim().replace(/_/g, " ");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

function isRealProtein(p) {
  const n = norm(p);
  return Boolean(n) && n !== "none" && n !== "null" && n !== "ninguna" && n !== "ninguno";
}

function isGuarnicionRecipe(r) {
  return r?.type === "guarnicion" || r?.mealRole?.includes?.("guarnicion");
}

function isSalsaRecipe(r) {
  return r?.type === "salsa" || r?.mealRole?.includes?.("salsa");
}

const MAIN_MEAL_ROLES = new Set(["primero", "segundo", "plato_unico", "cena"]);

/** Plato elegible para un hueco de comida/cena (picker del menú). */
function isGatePickPlato(r) {
  if (!r) return false;
  if (r.type === "guarnicion" || r.category === "guarniciones") return false;
  const roles = r.mealRole ?? [];
  if (roles.some((role) => MAIN_MEAL_ROLES.has(role))) return true;
  // Sin roles explícitos de plato principal: excluir solo guarnición pura.
  return roles.length === 0 || !roles.every((role) => role === "guarnicion");
}

function sortByNameQuery(items, q) {
  const sorted = [...items];
  if (q) {
    sorted.sort((a, b) => {
      const aStarts = norm(a.name).startsWith(q) ? 0 : 1;
      const bStarts = norm(b.name).startsWith(q) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.name.localeCompare(b.name);
    });
  } else {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  }
  return sorted;
}

export function categoryLabel(cat) {
  return CATEGORY_META[cat]?.label ?? titleCase(cat);
}

function CategoryIcon({ category, size = 22 }) {
  const Icon = CATEGORY_META[category]?.icon ?? Utensils;
  return <Icon size={size} color={categoryColor(category)} strokeWidth={2} />;
}

/**
 * Bottom-sheet catalog browser. Lets the user search & filter the real recipe
 * catalog and add dishes they already know how to cook to their weekly repeats.
 *
 * @param {() => void} onClose
 * @param {Set<string>} addedIds  catalog ids already added as fixed dishes
 * @param {Object<string,string>} garnishByCatalogId  { [catalogId]: garnishId }
 * @param {(recipe: object) => void} onAdd
 * @param {(catalogId: string) => void} onRemove
 * @param {(recipe: object, garnishId: string|null) => void} onSetGarnish
 */
export function CatalogBrowserSheet({
  inline = false, onClose, addedIds = new Set(), garnishByCatalogId = {},
  salsaByCatalogId = {}, onSetSalsa,
  onAdd, onRemove, onSetGarnish, extraRecipes = [],
  // Horizontal padding applied in inline mode (non-inline always uses 18px).
  inlinePadding = 0,
  // Reference mode: read-only browsing. No add/garnish actions — cards show
  // owner + vote info instead.
  reference = false,
  // Land on the categories grid first, same as `reference` browsing, but
  // without giving up add/garnish actions — used by "¿Qué repetimos?" so
  // picking fixed dishes still gets the "browse by category" landing.
  browseCategories = false,
  // Gate-pick mode (recipe planner): search platos and/or guarniciones from the
  // same browser used in ¿Qué repetimos?, with tap-to-select instead of add.
  gatePick = false,
  // When set ("plato" | "guarnicion"), the gate picker is locked to that type
  // and the Todos/Platos/Guarniciones toggle is hidden (used by the recipe
  // planner's review step, where the type is already decided).
  gatePickType = null,
  // Manual slot pick from the menu: show Mis recetas / Favoritas / Catálogo tabs.
  gatePickSourceTabs = false,
  selectedPlatoId = null,
  selectedGarnishId = null,
  onPickPlato,
  onPickGarnish,
  extraGarnishes = [],
  // User votes keyed by recipe id: { v: 'up'|'down' (rating), fav: 'all'|string[] (favorite scope) }.
  recipeVotes = {},
  // Carpetas: recipeId → folder ids, y las carpetas propias del usuario
  // (las 4 fijas de Inspíranos son constantes, ver lib/recipeCollections.js).
  recipeCollections = {},
  recipeFolders = [],
  onCreateFolder,
  onDeleteFolder,
  onSetRecipeFolders,
  // Selectable menu-group labels for per-group favorites (e.g. ["Adultos",
  // "Niños"]); when there's more than one, tapping the heart opens a picker
  // instead of favoriting for everyone right away.
  scopeGroups = [],
  onSetFavoriteScope,
  // Tap a recipe in reference mode to open dish detail.
  onOpenRecipe,
  // When provided, fully replaces the bundled catalog as the browse source
  // (used by "Mis recetas" to browse only the user's own recipes).
  sourceRecipes = null,
  // When provided, restricts results to these recipe ids ("Favoritas" tab).
  favoriteIds = null,
  // When provided (Set of base ids), restricts the browsable pool to just those
  // recipes — used by the "Cena rápida" / "Plato único" quick pickers so the grid
  // only shows dishes valid for that slot type.
  restrictToIds = null,
  // Custom empty-state copy (favorites / mine have their own wording).
  emptyLabel = null,
  // Optional second line under the title, shown non-bold (mirrors Descartados).
  emptySubtitle = null,
  // Optional fixed box height so the illustration matches its sibling empty
  // states (Recetas: Mis recetas / Favoritas / Descartados share one size).
  emptyMinHeight = undefined,
  // Solid teal footer band (white copy) to match sibling empty states.
  emptySolidBand = false,
  // Optional illustration shown instead of the icon tile in the empty state.
  emptyImg = null,
  // Reference mode only: lets user-owned recipes change visibility inline.
  onChangeVisibility = null,
  // Reference mode only: lets the owner delete their own recipes inline.
  onDeleteRecipe = null,
  // "Mis recetas" view: edit action + edit/delete icons rendered outside the
  // card, and the "Tuya" badge hidden (redundant when all are yours).
  onEditRecipe = null,
  ownRecipesView = false,
  // Reference/browse mode: preview a catalog dish paired with a garnish (opens
  // DishDetail in browse mode — does not save to Mis recetas).
  onBrowseGarnishCombo = null,
  // Demo only: preselect a category so we land straight on its dish list (with
  // real thumbnails) instead of the category grid.
  initialCategory = null,
  // Catálogo tab: set of catalog ids the user already discarded (para siempre).
  // Shows a toggle button on each card; onDiscardRecipe marks one, onRecoverRecipe clears it.
  discardedIds = null,
  onDiscardRecipe = null,
  onRecoverRecipe = null,
}) {
  const [query, setQuery] = useState("");
  // mine | favorites | catalog. Al cambiar un plato del menú se abre en "Mis
  // recetas": si has guardado algo, lo que quieres poner ahí casi siempre está
  // entre lo tuyo, no entre 539 del catálogo. Si aún no tienes nada, abrir en
  // una lista vacía sería peor, así que se cae al catálogo.
  const [sourceTab, setSourceTab] = useState(() =>
    gatePickSourceTabs && favoriteRecipeIds(recipeVotes).length > 0 ? "mine" : "catalog",
  );

  const resolvedFavoriteIds = useMemo(
    () => favoriteIds ?? (gatePickSourceTabs ? new Set(favoriteRecipeIds(recipeVotes)) : null),
    [favoriteIds, gatePickSourceTabs, recipeVotes],
  );

  // "Mis recetas" = lo que el usuario ha hecho suyo, ya sea creándolo o
  // marcándolo favorito en el catálogo (2026-08-27: "Favoritas" se fusionó
  // aquí — es una sola lista de la que decides qué entra en tu menú, no dos
  // pestañas separadas).
  const mineRecipes = useMemo(() => {
    // Ojo: NO usa `resolvedFavoriteIds` — esa variable colapsa a partir de la
    // prop `favoriteIds`, que en otro sitio del componente (isBrowseCatalog)
    // significa "restringe TODO el catálogo a solo favoritas". Aquí solo
    // queremos la lista de favoritas para construir "Mis recetas", sin tocar
    // ese comportamiento — se calcula aparte, directo de `recipeVotes`.
    const favIds = new Set(favoriteRecipeIds(recipeVotes));
    if (favIds.size === 0) return extraRecipes;
    const seen = new Set(extraRecipes.map((r) => r.id));
    const favorited = recipeCatalog.filter((r) => favIds.has(r.id) && !seen.has(r.id));
    return [...extraRecipes, ...favorited];
  }, [extraRecipes, recipeVotes]);

  // La tile "Mis recetas" del grid de categorías filtra al vuelo por tuyas +
  // favoritas, mismo mecanismo que una categoría pero sin tocar `cats`.
  const [viewingMine, setViewingMine] = useState(false);
  // Como le va a lo que publicaste: se pide UNA vez al entrar en Mis Recetas
  // y solo para lo tuyo publicado. Fuera de ahi no se pregunta nada.
  const [socialStats, setSocialStats] = useState({});

  // OJO al sitio: este efecto va DESPUES de viewingMine y socialStats, no
  // antes. El array de dependencias se evalua durante el render -no dentro
  // del callback-, asi que colocado arriba leia dos const que aun no
  // existian y reventaba la pantalla entera con "Cannot access ... before
  // initialization". El build no lo ve: es correcto sintacticamente.
  useEffect(() => {
    if (!viewingMine) return;
    const ids = mineRecipes
      .filter((r) => r.source === "user" && (r.visibility ?? "private") !== "private")
      .map((r) => r.id);
    if (ids.length === 0) return;
    let alive = true;
    loadRecipeStats(ids).then((s) => { if (alive) setSocialStats(s); });
    return () => { alive = false; };
  }, [viewingMine, mineRecipes]);

  // Set version of the same "tuyas + favoritas" pool, para la tile "Mis
  // recetas" del grid de categorías (filtro por id, no por categoría).
  const mineIds = useMemo(() => new Set(mineRecipes.map((r) => r.id)), [mineRecipes]);

  const fullCatalog = useMemo(
    () => {
      // El Recetario Estrella es el único catálogo elegible para un hueco del
      // menú (ver filterRecipes.isPrimaryCatalog): un plato del "fondo de
      // armario" antiguo no trae guarnición ni salsa propia, y dejarlo elegir
      // aquí es lo que colaba un plato así en el menú para que pairGarnishes
      // le pegara encima una guarnición automática — el plato "recargado"
      // reportado. Las recetas propias del usuario siempre valen, sean o no
      // Recetario Estrella.
      const onlyPrimaryCatalog = (list) => list.filter((r) => r.source === "user" || Boolean(r.estrella));

      if (gatePickSourceTabs && gatePick) {
        if (sourceTab === "mine") return mineRecipes;
        return onlyPrimaryCatalog(
          extraRecipes.length > 0 ? [...recipeCatalog, ...extraRecipes] : recipeCatalog,
        );
      }
      const base = sourceRecipes
        ? sourceRecipes
        : extraRecipes.length > 0
          ? [...recipeCatalog, ...extraRecipes]
          : recipeCatalog;
      return onlyPrimaryCatalog(base);
    },
    [gatePickSourceTabs, gatePick, sourceTab, sourceRecipes, extraRecipes, mineRecipes],
  );
  const platoCatalog = useMemo(
    () => fullCatalog.filter((r) => (gatePick ? isGatePickPlato(r) : !isGuarnicionRecipe(r))),
    [fullCatalog, gatePick],
  );
  const garnishCatalog = useMemo(() => {
    const seen = new Set(GARNISHES.map((g) => g.id));
    const merged = [...GARNISHES];
    for (const g of extraGarnishes) {
      if (g?.id && !seen.has(g.id)) {
        seen.add(g.id);
        merged.push(g);
      }
    }
    return merged;
  }, [extraGarnishes]);
  // Bundled guarniciones live outside recipeCatalog — merge them for browse/search.
  const catalogGarnishBrowseList = useMemo(() => {
    const seen = new Set();
    const merged = [];
    for (const g of garnishCatalog) {
      if (!g?.id || seen.has(g.id)) continue;
      seen.add(g.id);
      merged.push(g);
    }
    for (const r of fullCatalog) {
      if (isGuarnicionRecipe(r) && r.id && !seen.has(r.id)) {
        seen.add(r.id);
        merged.push(r);
      }
    }
    return merged;
  }, [garnishCatalog, fullCatalog]);
  // salsas.json vive fuera de recipeCatalog (mismo motivo que guarniciones —
  // ver recipeCatalog.js): se mezcla aquí solo para navegar/buscar en el
  // catálogo de referencia, nunca es un hueco de menú por sí misma.
  const catalogSalsaBrowseList = useMemo(() => {
    const seen = new Set(SALSAS.map((s) => s.id));
    const merged = [...SALSAS];
    for (const r of fullCatalog) {
      if (isSalsaRecipe(r) && r.id && !seen.has(r.id)) {
        seen.add(r.id);
        merged.push(r);
      }
    }
    // Mismo criterio que fullCatalog: en Catálogo, solo salsas con foto real.
    if (reference && browseCategories) {
      return merged.filter((s) => Boolean(dishImageUrl(s.id)));
    }
    return merged;
  }, [fullCatalog, reference, browseCategories]);
  // all | plato | guarnicion — locked to gatePickType when provided.
  const [typeFilter, setTypeFilter] = useState(gatePickType ?? "all");
  useEffect(() => {
    if (gatePickType) setTypeFilter(gatePickType);
  }, [gatePickType]);
  useEffect(() => {
    if (!gatePickSourceTabs || !gatePick) return;
    setQuery("");
    setCats(new Set());
    setProteins(new Set());
    setMaxTime(0);
    setDifficulties(new Set());
    setKidOnly(false);
  }, [sourceTab, gatePickSourceTabs, gatePick]);
  const [showFilters, setShowFilters] = useState(false);
  // Carpeta de Inspíranos que se está viendo (o null). Un solo id en vez de un
  // booleano por carpeta: son mutuamente excluyentes al navegar.
  const [viewingCollection, setViewingCollection] = useState(null);
  // Raíz de "Mis recetas": solo carpetas, ninguna receta suelta. Las recetas
  // viven dentro de una carpeta — "Todas" es la que las contiene a todas.
  const inMineRoot = viewingMine && !viewingCollection;

  const collectionIds = useMemo(() => {
    if (!viewingCollection || viewingCollection === ALL_ID) return null;
    // "Descartados" no vive en recipeCollections: son los rechazos de menú.
    if (viewingCollection === DISCARDED_ID) return discardedIds ?? new Set();
    return collectionRecipeIds(recipeCollections, viewingCollection);
  }, [viewingCollection, recipeCollections, discardedIds]);
  const folderCounts = useMemo(
    () => collectionCounts(recipeCollections, recipeFolders),
    [recipeCollections, recipeFolders],
  );
  const [creatingFolder, setCreatingFolder] = useState(false);
  // Receta cuyo selector de carpetas está abierto.
  const [folderPickerFor, setFolderPickerFor] = useState(null);
  const [cats, setCats] = useState(() => (initialCategory ? new Set([initialCategory]) : new Set()));
  const [proteins, setProteins] = useState(() => new Set());
  const [maxTime, setMaxTime] = useState(0);
  const [difficulties, setDifficulties] = useState(() => new Set());
  const [kidOnly, setKidOnly] = useState(false);
  // Facetas de faceta única activable (gourmet/verano/invierno). verano e
  // invierno son mutuamente excluyentes (season es un valor único por
  // receta) — activar una desactiva la otra, ver toggleFacet.
  const [activeFacets, setActiveFacets] = useState(() => new Set());
  // Ilustraciones de faceta que aun no existen (404) — fallback a icono.
  const [brokenFacetImgs, setBrokenFacetImgs] = useState(() => new Set());
  const [garnishFor, setGarnishFor] = useState(null);
  const [salsaFor, setSalsaFor] = useState(null);
  const [combineFor, setCombineFor] = useState(null); // catalog dish → pick garnish to preview combined
  const [scopeFor, setScopeFor] = useState(null); // recipe being favorited via the group picker

  const { allCats, allProteins } = useMemo(() => {
    const c = new Set();
    const p = new Set();
    const source = gatePick ? platoCatalog : fullCatalog;
    for (const r of source) {
      if (r.category && !isGuarnicionRecipe(r)) c.add(r.category);
      if (isRealProtein(r.mainProtein)) p.add(r.mainProtein);
    }
    if (!gatePick && catalogGarnishBrowseList.length > 0) c.add("guarniciones");
    if (!gatePick && catalogSalsaBrowseList.length > 0) c.add("salsas");
    return {
      allCats: [...c].sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b))),
      allProteins: [...p].sort((a, b) => titleCase(a).localeCompare(titleCase(b))),
    };
  }, [fullCatalog, gatePick, platoCatalog, catalogGarnishBrowseList.length, catalogSalsaBrowseList.length]);

  const gourmetOnly = activeFacets.has("gourmet");
  const rapidoOnly = activeFacets.has("rapido");
  const seasonFilter = activeFacets.has("verano") ? "verano" : activeFacets.has("invierno") ? "invierno" : null;
  const sinLactosaOnly = activeFacets.has("sin_lactosa");

  const activeFilterCount =
    cats.size +
    proteins.size +
    difficulties.size +
    (maxTime ? 1 : 0) +
    (kidOnly ? 1 : 0) +
    (gourmetOnly ? 1 : 0) +
    (rapidoOnly ? 1 : 0) +
    (seasonFilter ? 1 : 0) +
    (sinLactosaOnly ? 1 : 0);

  const platoResults = useMemo(() => {
    const q = norm(query);
    const filtered = platoCatalog.filter((r) => {
      if (restrictToIds && !restrictToIds.has(r.id)) return false;
      if (viewingMine && (!viewingCollection || viewingCollection === ALL_ID) && !mineIds.has(r.id)) return false;
      if (collectionIds && !collectionIds.has(r.id)) return false;
      if (q && !norm(r.name).includes(q)) return false;
      if (cats.size && !cats.has(r.category)) return false;
      if (proteins.size && !proteins.has(r.mainProtein)) return false;
      if (maxTime && (r.time ?? 999) > maxTime) return false;
      if (difficulties.size && !difficulties.has(r.difficulty)) return false;
      if (kidOnly && !r.kidFriendly) return false;
      if (gourmetOnly && !r.apetecible) return false;
      if (rapidoOnly && !isMontaje(r)) return false;
      if (seasonFilter && r.season !== seasonFilter) return false;
      if (sinLactosaOnly && !isCompatibleWith(r, "lactosa_fina")) return false;
      return true;
    });
    return sortByNameQuery(filtered, q);
  }, [query, cats, proteins, maxTime, difficulties, kidOnly, gourmetOnly, rapidoOnly, seasonFilter, sinLactosaOnly, platoCatalog, restrictToIds, viewingMine, mineIds, collectionIds]);

  const garnishResults = useMemo(() => {
    const q = norm(query);
    const filtered = garnishCatalog.filter((g) => !q || norm(g.name).includes(q));
    return sortByNameQuery(filtered, q);
  }, [query, garnishCatalog]);

  const results = useMemo(() => {
    if (gatePick) {
      if (typeFilter === "plato") {
        return platoResults.map((item) => ({ kind: "plato", item }));
      }
      if (typeFilter === "guarnicion") {
        return garnishResults.map((item) => ({ kind: "guarnicion", item }));
      }
      return sortByNameQuery(
        [
          ...platoResults.map((item) => ({ kind: "plato", item, name: item.name })),
          ...garnishResults.map((item) => ({ kind: "guarnicion", item, name: item.name })),
        ],
        norm(query),
      ).map(({ kind, item }) => ({ kind, item }));
    }

    const q = norm(query);

    // Mis recetas: mostrar TODAS las propias (incl. guarniciones), sin la lógica
    // de catálogo que las oculta cuando no hay búsqueda activa.
    if (sourceRecipes) {
      const filtered = fullCatalog.filter((r) => {
        if (q && !norm(r.name).includes(q)) return false;
        if (cats.size) {
          const catKey = isGuarnicionRecipe(r) ? "guarniciones" : r.category;
          if (!catKey || !cats.has(catKey)) return false;
        }
        if (proteins.size && !proteins.has(r.mainProtein)) return false;
        if (maxTime && (r.time ?? 999) > maxTime) return false;
        if (difficulties.size && !difficulties.has(r.difficulty)) return false;
        if (kidOnly && !r.kidFriendly) return false;
        if (gourmetOnly && !r.apetecible) return false;
        if (rapidoOnly && !isMontaje(r)) return false;
        if (seasonFilter && r.season !== seasonFilter) return false;
        if (sinLactosaOnly && !isCompatibleWith(r, "lactosa_fina")) return false;
        return true;
      });
      return sortByNameQuery(filtered, q);
    }

    const onlyGuarniciones = cats.size === 1 && cats.has("guarniciones");
    const onlySalsas = cats.size === 1 && cats.has("salsas");
    const includeGuarniciones = onlyGuarniciones || (cats.size === 0 && Boolean(q)) || (cats.has("guarniciones") && cats.size > 1);
    const includeSalsas = onlySalsas || (cats.size === 0 && Boolean(q)) || (cats.has("salsas") && cats.size > 1);
    const includePlatos = !onlyGuarniciones && !onlySalsas;

    const matchesCommon = (r) => {
      if (favoriteIds && !favoriteIds.has(r.id)) return false;
      // "Mis recetas" (tile del grid): sin esto se activaba el modo pero nadie
      // filtraba en ESTA lista — platoResults sí lo aplicaba, pero no es la
      // que se pinta aquí — así que salía el catálogo entero, como si fuera
      // una categoría más.
      if (viewingMine && (!viewingCollection || viewingCollection === ALL_ID) && !mineIds.has(r.id)) return false;
      if (collectionIds && !collectionIds.has(r.id)) return false;
      if (restrictToIds && !restrictToIds.has(r.id)) return false;
      if (q && !norm(r.name).includes(q)) return false;
      if (maxTime && (r.time ?? 999) > maxTime) return false;
      if (difficulties.size && !difficulties.has(r.difficulty)) return false;
      if (kidOnly && !r.kidFriendly) return false;
      if (gourmetOnly && !r.apetecible) return false;
      if (rapidoOnly && !isMontaje(r)) return false;
      if (seasonFilter && r.season !== seasonFilter) return false;
      if (sinLactosaOnly && !isCompatibleWith(r, "lactosa_fina")) return false;
      return true;
    };

    const out = [];
    if (includePlatos) {
      for (const r of fullCatalog) {
        if (isGuarnicionRecipe(r)) continue;
        if (cats.size && !cats.has(r.category)) continue;
        if (proteins.size && !proteins.has(r.mainProtein)) continue;
        if (matchesCommon(r)) out.push(r);
      }
    }
    if (includeGuarniciones) {
      for (const g of catalogGarnishBrowseList) {
        if (cats.size && !cats.has("guarniciones")) continue;
        if (matchesCommon(g)) out.push(g);
      }
    }
    if (includeSalsas) {
      for (const s of catalogSalsaBrowseList) {
        if (cats.size && !cats.has("salsas")) continue;
        if (matchesCommon(s)) out.push(s);
      }
    }
    return sortByNameQuery(out, q);
  }, [gatePick, typeFilter, platoResults, garnishResults, query, cats, proteins, maxTime, difficulties, kidOnly, gourmetOnly, rapidoOnly, seasonFilter, sinLactosaOnly, fullCatalog, favoriteIds, restrictToIds, catalogGarnishBrowseList, catalogSalsaBrowseList, sourceRecipes, viewingMine, mineIds, collectionIds]);

  const gatePickMinePlatoCount = useMemo(
    () => mineRecipes.filter(isGatePickPlato).length,
    [mineRecipes],
  );

  const gatePickTabEmpty = useMemo(() => {
    if (!gatePickSourceTabs || !gatePick) return null;
    if (sourceTab === "mine") {
      if (mineRecipes.length === 0) {
        return {
          img: "/avatares/cards/empty_recetas_propias.jpg",
          title: "Aún no tienes recetas propias ni favoritas",
          subtitle: "Prueba en Catálogo — el corazón en cualquier receta la guarda aquí.",
        };
      }
      if (gatePickMinePlatoCount === 0) {
        return {
          img: "/avatares/cards/empty_recetas_propias.jpg",
          title: "Ninguna encaja como plato",
          subtitle: "Las que tienes son solo guarnición. Elige un plato en Catálogo.",
        };
      }
    }
    return null;
  }, [gatePickSourceTabs, gatePick, sourceTab, mineRecipes.length, gatePickMinePlatoCount]);

  // Sin paginado ni scroll infinito: cada catálogo se pinta entero de una vez
  // y el scroll nativo llega hasta el final (2026-08-28) — el tope 10/20/50
  // no aportaba nada salvo un clic extra.
  const visible = results;

  const selectedPlato = selectedPlatoId
    ? platoCatalog.find((r) => r.id === selectedPlatoId) ?? null
    : null;
  const selectedGarnish = selectedGarnishId
    ? garnishCatalog.find((g) => g.id === selectedGarnishId) ?? GARNISH_BY_ID[selectedGarnishId]
    : null;

  const showPlatoFilters = !gatePick || typeFilter !== "guarnicion";

  const clearFilters = () => {
    setCats(new Set());
    setViewingMine(false);
    setViewingCollection(null);
    setProteins(new Set());
    setMaxTime(0);
    setDifficulties(new Set());
    setKidOnly(false);
    // Las facetas del estante (gourmet/rápido/verano/invierno) también son
    // filtros: sin esto, "Volver" devolvía a la rejilla con una faceta aún
    // activa y sin nada en la UI que lo indicara.
    setActiveFacets(new Set());
  };

  const goBackToCategories = () => {
    // Dentro de una carpeta, "Volver" sube a la raíz de Mis recetas, no al
    // grid de categorías.
    if (viewingCollection) {
      setViewingCollection(null);
      setQuery("");
      return;
    }
    setQuery("");
    clearFilters();
    setShowFilters(false);
  };

  const px = inline ? inlinePadding : 18;

  // Full-catalog browse mode (not gate-pick, not a scoped/limited list like
  // favorites or "mis recetas"): land on a categories grid first instead of
  // dumping all recipes at once. Picking a category (or typing a search)
  // reveals the normal filtered list.
  const isBrowseCatalog =
    (reference || browseCategories || (gatePick && gatePickSourceTabs && sourceTab === "catalog"))
    && !favoriteIds
    && !sourceRecipes;
  // Una faceta activa es, como una categoría, "ya he elegido qué ver": sin
  // contarla aquí la rejilla se quedaba puesta y los platos filtrados no se
  // llegaban a pintar nunca — tocabas "Cenas rápidas" y solo se iluminaba la
  // tesela.
  const anyFacetActive = kidOnly || activeFacets.size > 0;
  const showCategoryGrid =
    isBrowseCatalog && cats.size === 0 && !viewingMine && !viewingCollection && !query.trim() && !anyFacetActive;
  // En la rejilla de inicio (fuera de gatePick) el estante de facetas ya
  // cubre "explorar" — la barra de busqueda/filtros solo aparece al entrar
  // en una categoria o al buscar, no compitiendo con el estante arriba.
  const hideSearchOnGrid = !gatePick && showCategoryGrid;
  const categoryCounts = useMemo(() => {
    const counts = {};
    for (const r of fullCatalog) {
      if (r.category && !isGuarnicionRecipe(r)) {
        counts[r.category] = (counts[r.category] ?? 0) + 1;
      }
    }
    if (catalogGarnishBrowseList.length > 0) {
      counts.guarniciones = catalogGarnishBrowseList.length;
    }
    if (catalogSalsaBrowseList.length > 0) {
      counts.salsas = catalogSalsaBrowseList.length;
    }
    return counts;
  }, [fullCatalog, catalogGarnishBrowseList.length, catalogSalsaBrowseList.length]);

  // Sobre platoCatalog (no fullCatalog): es la misma base que filtran los
  // resultados reales al tocar la faceta, así el número de la esquina
  // coincide siempre con lo que se ve después.
  const facetCounts = useMemo(() => {
    const counts = { ninos: 0, rapido: 0, gourmet: 0, verano: 0, invierno: 0 };
    for (const r of platoCatalog) {
      if (r.kidFriendly) counts.ninos++;
      if (isMontaje(r)) counts.rapido++;
      if (r.apetecible) counts.gourmet++;
      if (r.season === "verano") counts.verano++;
      if (r.season === "invierno") counts.invierno++;
    }
    return counts;
  }, [platoCatalog]);

  const styleBlock = (
    <style>{`
      @keyframes sheetUp {
        from { transform: translateY(28px); opacity: 0; }
        to   { transform: translateY(0);    opacity: 1; }
      }
      @keyframes cardIn {
        from { opacity: 0; transform: translateY(6px) scale(0.98); }
        to   { opacity: 1; transform: translateY(0)   scale(1);    }
      }
      @keyframes checkPop {
        0%   { transform: scale(1); }
        45%  { transform: scale(1.2); }
        100% { transform: scale(1); }
      }
      .catalog-sheet-inner { animation: sheetUp .22s cubic-bezier(.25,.9,.4,1) both; }
      .catalog-card-enter  { animation: cardIn .16s ease-out both; }
      .catalog-added-pop   { animation: checkPop .18s ease-out both; }
    `}</style>
  );

  function toggleFacet(id) {
    if (id === "ninos") {
      setKidOnly((v) => !v);
      return;
    }
    // rapido/gourmet/verano/invierno: chips independientes, salvo
    // verano↔invierno, mutuamente excluyentes porque `season` es un único
    // valor por receta.
    setActiveFacets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (id === "verano") next.delete("invierno");
        if (id === "invierno") next.delete("verano");
        next.add(id);
      }
      return next;
    });
  }

  const facetActive = {
    ninos: kidOnly,
    rapido: rapidoOnly,
    sin_lactosa: sinLactosaOnly,
    gourmet: activeFacets.has("gourmet"),
    verano: activeFacets.has("verano"),
    invierno: activeFacets.has("invierno"),
  };

  const searchRow = (
    <>
      {gatePickSourceTabs && gatePick && (
        <div style={{ padding: `12px ${px}px 0`, marginBottom: 12, flexShrink: 0 }}>
          <SegmentedTabBar>
            {[
              { id: "mine", label: "Mis recetas", count: gatePickMinePlatoCount, Icon: NotebookPen },
              { id: "catalog", label: "Catálogo", Icon: BookOpen },
            ].map((opt) => (
              <SegmentedTabButton
                key={opt.id}
                selected={sourceTab === opt.id}
                onClick={() => setSourceTab(opt.id)}
                label={opt.label}
                count={opt.count ?? 0}
                Icon={opt.Icon}
              />
            ))}
          </SegmentedTabBar>
        </div>
      )}
      {gatePick && !gatePickType && (
        <div style={{ display: "flex", gap: 6, marginBottom: 10, padding: `0 ${px}px`, flexShrink: 0 }}>
          {[
            { id: "all", label: "Todos" },
            { id: "plato", label: "Platos" },
            { id: "guarnicion", label: "Guarniciones" },
          ].map((opt) => {
            const active = typeFilter === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setTypeFilter(opt.id)}
                style={{
                  flex: 1, padding: "8px 6px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit",
                  border: `1.5px solid ${active ? GREEN : "#e8efe9"}`,
                  background: active ? GREEN : "#fff",
                  color: active ? "#fff" : "#5a7066",
                  fontSize: 12, fontWeight: 800,
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, padding: `0 ${px}px`, flexShrink: 0 }}>
        <div
          style={{
            flex: 1, display: "flex", alignItems: "center", gap: 8,
            height: 42, padding: "0 12px", borderRadius: 12,
            background: "#f4f7f5", border: "1.5px solid #e8efe9",
          }}
        >
          <Search size={16} color="#9ab0a1" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={gatePick ? "Buscar plato o guarnición…" : "Buscar plato…"}
            style={{
              flex: 1, border: "none", background: "transparent", outline: "none",
              fontSize: 13.5, color: "#1a3a24", fontFamily: "inherit", minWidth: 0,
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Limpiar búsqueda"
              style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, display: "flex" }}
            >
              <X size={15} color="#9ab0a1" />
            </button>
          )}
        </div>
        {isBrowseCatalog && !showCategoryGrid ? (
          <button
            type="button"
            onClick={goBackToCategories}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              height: 42, padding: "0 14px", borderRadius: 12, cursor: "pointer",
              border: `1.5px solid ${GREEN}`,
              background: "#f4f7f5",
              color: GREEN,
              fontSize: 13, fontWeight: 800, fontFamily: "inherit", flexShrink: 0,
            }}
          >
            <ChevronLeft size={16} strokeWidth={2.5} />
            Volver
          </button>
        ) : showPlatoFilters ? (
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            style={{
              position: "relative", display: "inline-flex", alignItems: "center", gap: 7,
              height: 42, padding: "0 14px", borderRadius: 12, cursor: "pointer",
              border: `1.5px solid ${showFilters || activeFilterCount ? GREEN : "#e8efe9"}`,
              background: showFilters || activeFilterCount ? GREEN : "#f4f7f5",
              color: showFilters || activeFilterCount ? "#fff" : "#5a7066",
              fontSize: 13, fontWeight: 800, fontFamily: "inherit", flexShrink: 0,
            }}
          >
            <SlidersHorizontal size={16} />
            Filtros
            {activeFilterCount > 0 && (
              <span
                style={{
                  minWidth: 18, height: 18, borderRadius: 999, padding: "0 5px",
                  background: "#fff", color: GREEN, fontSize: 11, fontWeight: 900,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                }}
              >
                {activeFilterCount}
              </span>
            )}
          </button>
        ) : null}
      </div>
    </>
  );

  const countRow = results.length === 0 ? null : (
    <div style={{ padding: `10px ${px}px 6px`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#7a9485", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {gatePick
          ? `${results.length} ${results.length === 1 ? "resultado" : "resultados"}`
          : `${results.length} ${results.length === 1 ? "plato" : "platos"}`}
      </p>
    </div>
  );

  const categoryBackRow = null; // now integrated into the search row

  // Categorías (eje "qué es") y facetas (eje "cómo se usa") ya no viven en
  // dos sitios separados (lista + estante horizontal aparte) — se fusionan
  // en un único grid de 3 columnas. Cada tile conserva su propio gesto: una
  // categoría navega al listado filtrado, una faceta se enciende/apaga en
  // el sitio (mismo toggleFacet de siempre).
  // Las carpetas NO viven aquí: son un nivel más abajo, dentro de "Mis
  // recetas" (ver FolderRail), porque organizan lo que ya has guardado, no el
  // catálogo entero.
  // Sin facetas (peques / cenas rápidas / gourmet / verano / invierno): tres de
  // ellas eran el mismo corte que una carpeta de Mis recetas con distinto
  // nombre y distinto contenido (la faceta, todo el catálogo; la carpeta, solo
  // lo tuyo), y tener los dos ejes a la vez confundía. El filtrado por faceta
  // sigue existiendo dentro de Filtros; lo que desaparece es la tile.
  const gridTiles = [
    { kind: "mine", id: "__mine__" },
    ...allCats.map((catId) => ({ kind: "category", id: catId })),
  ];

  const categoryGrid = (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 10,
        padding: `2px ${px}px 4px`,
      }}
    >
      {gridTiles.map((tile, i) => {
        const isFacet = tile.kind === "facet";
        const isMine = tile.kind === "mine";
        const meta = isFacet
          ? FACET_META[tile.id]
          : isMine
            ? { img: "/avatares/cards/empty_recetas_propias.jpg" }
            : CATEGORY_META[tile.id];
        const Icon = isMine ? NotebookPen : isFacet ? meta.Icon : (meta?.icon ?? Utensils);
        const color = isMine ? GREEN : isFacet ? meta.color : categoryColor(tile.id);
        const active = isMine ? viewingMine : isFacet ? facetActive[tile.id] : false;
        const broken = isFacet && brokenFacetImgs.has(tile.id);
        const label = isMine ? "Mis recetas" : isFacet ? meta.label : categoryLabel(tile.id);
        const count = isMine ? mineIds.size : isFacet ? facetCounts[tile.id] ?? 0 : categoryCounts[tile.id] ?? 0;
        // "Mis recetas" siempre se puede abrir, aunque tengas 0: la raíz
        // muestra las carpetas (Todas, Descartados...), no el mensaje
        // genérico de "sin resultados" — ese solo sale fuera de inMineRoot.
        const disabled = false;
        const onTileClick = () => {
          if (disabled) return;
          if (isMine) {
            setViewingMine(true);
            setViewingCollection(null);
            setCats(new Set());
          } else if (isFacet) {
            toggleFacet(tile.id);
          } else {
            setViewingMine(false);
            setViewingCollection(null);
            setCats(new Set([tile.id]));
          }
        };
        const hasImg = isFacet ? !broken : Boolean(meta?.img);
        return (
          <button
            key={`${tile.kind}-${tile.id}`}
            type="button"
            // El tour de Recetas apunta aqui: "Mis recetas" dejo de ser pestaña
            // (2026-08-27) y es una tesela mas del grid, asi que el ancla vive
            // en la tesela y no en una barra de pestañas que ya no existe.
            data-coach={isMine ? "recipes-mine" : undefined}
            onClick={onTileClick}
            disabled={disabled}
            className="catalog-card-enter"
            style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
              padding: 0, border: "none", background: "transparent",
              cursor: disabled ? "default" : "pointer", fontFamily: "inherit", textAlign: "center",
              opacity: disabled ? 0.45 : 1,
              animationDelay: `${i < 18 ? i * 14 : 0}ms`,
            }}
          >
            <div
              style={{
                position: "relative", width: "100%", aspectRatio: "1 / 1",
                borderRadius: 14, overflow: "hidden", background: "#f4f7f5",
                boxShadow: active ? "0 0 0 3px rgba(45,90,61,.35)" : "none",
              }}
            >
              {hasImg ? (
                <img
                  src={meta.img}
                  alt=""
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                  onError={isFacet ? () => setBrokenFacetImgs((prev) => new Set(prev).add(tile.id)) : undefined}
                />
              ) : (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: `${color}18` }}>
                  <Icon size={26} color={color} strokeWidth={2} />
                </div>
              )}

              {count !== null && (
                <span
                  style={{
                    position: "absolute", top: 6, right: 6,
                    minWidth: 22, height: 22, padding: "0 5px", borderRadius: "50%",
                    background: "rgba(255,255,255,.92)", color: "#142f1d",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10.5, fontWeight: 800,
                    boxShadow: "0 1px 4px rgba(20,47,29,.16)",
                  }}
                >
                  {count}
                </span>
              )}
            </div>

            <span
              style={{
                fontSize: 12, fontWeight: 800, lineHeight: 1.2,
                color: active ? GREEN : "#142f1d",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%",
              }}
            >
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );

  const selectedRow = gatePick && (selectedPlato || selectedGarnish) ? (
    <div style={{ padding: `0 ${px}px 8px`, display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
      {selectedPlato && (
        <SelectedChip
          kind="plato"
          label={selectedPlato.name}
          onClear={() => onPickPlato?.(null)}
        />
      )}
      {selectedGarnish && (
        <SelectedChip
          kind="guarnicion"
          label={selectedGarnish.name}
          onClear={() => onPickGarnish?.(null)}
        />
      )}
    </div>
  ) : null;

  // Dentro de "Mis recetas" y sin carpeta abierta, las carpetas ocupan huecos
  // del propio grid, como un plato más: van primero y luego las recetas.
  // Antes eran pills en una fila y no escalaba — con muchas carpetas la fila
  // se volvía un carrusel horizontal imposible de escanear.
  const folderTiles = inMineRoot ? (
    <>
      <FolderTile
        label="Todas"
        {...folderArt(ALL_ID)}
        count={mineIds.size}
        onClick={() => setViewingCollection(ALL_ID)}
      />
      {allFolders(recipeFolders).map((f) => (
        <FolderTile
          key={f.id}
          label={f.label}
          {...folderArt(f.id)}
          count={folderCounts[f.id] ?? 0}
          onClick={() => setViewingCollection(f.id)}
          onDelete={f.builtIn || !onDeleteFolder ? null : () => onDeleteFolder(f.id)}
        />
      ))}
      <FolderTile
        label="Descartados"
        {...folderArt(DISCARDED_ID)}
        count={discardedIds?.size ?? 0}
        muted
        onClick={() => setViewingCollection(DISCARDED_ID)}
      />
      {onCreateFolder && <NewFolderTile onClick={() => setCreatingFolder(true)} />}
    </>
  ) : null;

  const cards = (
    <>
      {folderTiles}
      {inMineRoot ? null : gatePick
        ? visible.map((entry, i) => (
            <GatePickCard
              key={`${entry.kind}-${entry.item.id}`}
              kind={entry.kind}
              item={entry.item}
              selected={
                entry.kind === "plato"
                  ? selectedPlatoId === entry.item.id
                  : selectedGarnishId === entry.item.id
              }
              onToggle={() => {
                if (entry.kind === "plato") {
                  onPickPlato?.(selectedPlatoId === entry.item.id ? null : entry.item.id);
                } else {
                  onPickGarnish?.(selectedGarnishId === entry.item.id ? null : entry.item.id);
                }
              }}
              animDelay={i < 12 ? i * 18 : 0}
            />
          ))
        : reference && browseCategories
          ? visible.map((r, i) => (
              <RecipeGridCard
                key={r.id}
                recipe={r}
                favorite={isRecipeFavorite(recipeVotes, r.id)}
                onSetFavoriteScope={onSetFavoriteScope}
                hasScopeChoice={scopeGroups.length > 1}
                onOpenScopePicker={() => setScopeFor(r)}
                onOpenRecipe={onOpenRecipe}
                onOpenFolders={onSetRecipeFolders ? () => setFolderPickerFor(r) : undefined}
                inFolders={(recipeCollections[r.id] ?? []).length}
                // Borrar solo en "Mis recetas" y solo sobre recetas propias:
                // esta tarjeta es la del catálogo, donde no se borra nada.
                onDelete={
                  viewingMine && onDeleteRecipe && r.source === "user"
                    ? () => onDeleteRecipe(r.id)
                    : undefined
                }
                animDelay={i < 12 ? i * 18 : 0}
                // Lo social solo tiene sentido sobre lo TUYO: en el catalogo
                // no hay nada que publicar ni retirar.
                social={
                  viewingMine && r.source === "user"
                    ? { stats: socialStats[r.id] ?? null }
                    : null
                }
              />
            ))
          : visible.map((r, i) => (
              <RecipeCard
                key={r.id}
                recipe={r}
                reference={reference}
                added={addedIds.has(r.id)}
                garnishId={garnishByCatalogId[r.id] ?? null}
                salsaId={salsaByCatalogId[r.id] ?? null}
                onAdd={() => onAdd?.(r)}
                onRemove={() => onRemove?.(r.id)}
                onOpenGarnish={() => setGarnishFor(r)}
                onOpenSalsa={() => setSalsaFor(r)}
                onOpenRecipe={onOpenRecipe}
                favorite={isRecipeFavorite(recipeVotes, r.id)}
                onSetFavoriteScope={onSetFavoriteScope}
                scopeGroups={scopeGroups}
                onOpenScopePicker={() => setScopeFor(r)}
                onChangeVisibility={onChangeVisibility}
                onDelete={onDeleteRecipe && r.source === "user" ? () => onDeleteRecipe(r.id) : undefined}
                onEdit={onEditRecipe && r.source === "user" ? () => onEditRecipe(r) : undefined}
                ownView={ownRecipesView || viewingMine}
                onCombine={onBrowseGarnishCombo && r.type === "principal" && r.source !== "user" ? () => setCombineFor(r) : undefined}
                animDelay={i < 12 ? i * 18 : 0}
                discarded={discardedIds ? discardedIds.has(r.id) : false}
                onDiscard={discardedIds && r.source !== "user" ? (discardedIds.has(r.id) ? () => onRecoverRecipe?.(r.id) : () => onDiscardRecipe?.(r.id)) : undefined}
              />
            ))}
      {results.length === 0 && !inMineRoot && (
        emptyImg || gatePickTabEmpty?.img ? (
          <div style={{ padding: "16px 20px" }}>
            <EmptyIllustration
              img={emptyImg ?? gatePickTabEmpty.img}
              title={emptyLabel ?? gatePickTabEmpty?.title}
              subtitle={emptySubtitle ?? gatePickTabEmpty?.subtitle}
              maxWidth={240}
              minHeight={emptyMinHeight}
              solidBand={emptySolidBand}
              imgAspect="1 / 1"
              imgPosition="center"
            />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "50px 20px", textAlign: "center" }}>
            <div
              style={{
                width: 60,
                height: 60,
                borderRadius: 18,
                background: favoriteIds ? "#fdecef" : "#eef4f0",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {favoriteIds ? <Heart size={26} color="#e0668a" /> : <Search size={26} color="#2d5a3d" />}
            </div>
            <p style={{ margin: 0, fontSize: 13, color: "#7a9485", lineHeight: 1.5, maxWidth: 260 }}>
              {emptyLabel
                ? emptyLabel
                : gatePick
                  ? "No encontramos platos ni guarniciones con esos filtros."
                  : "No encontramos platos con esos filtros."}
            </p>
          </div>
        )
      )}
    </>
  );


  const overlays = (
    <>
      {creatingFolder && onCreateFolder && (
        <NewFolderDialog
          onCreate={(name) => onCreateFolder(name)}
          onClose={() => setCreatingFolder(false)}
        />
      )}
      {folderPickerFor && (
        <FolderPickerSheet
          recipe={folderPickerFor}
          folders={allFolders(recipeFolders)}
          current={recipeCollections[folderPickerFor.id] ?? []}
          onSave={(ids) => onSetRecipeFolders?.(folderPickerFor.id, ids)}
          onCreateFolder={onCreateFolder}
          onClose={() => setFolderPickerFor(null)}
        />
      )}
      {garnishFor && (
        <GarnishPickerSheet
          recipe={garnishFor}
          currentGarnishId={garnishByCatalogId[garnishFor.id] ?? null}
          onSelect={(gid) => { onSetGarnish?.(garnishFor, gid); setGarnishFor(null); }}
          onClose={() => setGarnishFor(null)}
          recipeVotes={recipeVotes}
          scopeGroups={scopeGroups}
          onSetFavoriteScope={onSetFavoriteScope}
          onOpenScopePicker={setScopeFor}
          discardedIds={discardedIds}
          onDiscardRecipe={onDiscardRecipe}
          onRecoverRecipe={onRecoverRecipe}
        />
      )}
      {salsaFor && (
        <SalsaPickerSheet
          recipe={salsaFor}
          currentSalsaId={salsaByCatalogId[salsaFor.id] ?? null}
          onSelect={(sid) => { onSetSalsa?.(salsaFor, sid); setSalsaFor(null); }}
          onClose={() => setSalsaFor(null)}
        />
      )}
      {combineFor && (
        <AddonPickerSheet
          recipe={combineFor}
          garnishCatalog={garnishCatalog}
          onConfirm={({ garnishId, sauceId }) => {
            const g = garnishId ? (GARNISH_BY_ID[garnishId] ?? garnishCatalog.find((x) => x.id === garnishId)) : null;
            const s = sauceId ? SALSA_BY_ID[sauceId] : null;
            if (g || s) onBrowseGarnishCombo?.(combineFor, { garnishId: g?.id, sauceId: s?.id });
            setCombineFor(null);
          }}
          onClose={() => setCombineFor(null)}
          discardedIds={discardedIds}
          onDiscardRecipe={onDiscardRecipe}
          onRecoverRecipe={onRecoverRecipe}
        />
      )}
      {showFilters && (
        <FiltersSheet
          onClose={() => setShowFilters(false)}
          resultCount={results.length}
          allCats={allCats}
          allProteins={allProteins}
          cats={cats}
          setCats={setCats}
          proteins={proteins}
          setProteins={setProteins}
          maxTime={maxTime}
          setMaxTime={setMaxTime}
          difficulties={difficulties}
          setDifficulties={setDifficulties}
          kidOnly={kidOnly}
          setKidOnly={setKidOnly}
          activeFilterCount={activeFilterCount}
          onClear={clearFilters}
        />
      )}
      {scopeFor && (
        <FavoriteScopeModal
          recipeName={scopeFor.name}
          isFavorite={isRecipeFavorite(recipeVotes, scopeFor.id)}
          scope={getFavoriteScope(recipeVotes, scopeFor.id)}
          groups={scopeGroups}
          onPick={(key) => {
            applyFavoriteScopePick(key, { recipeId: scopeFor.id, onSetFavoriteScope });
            setScopeFor(null);
          }}
          onClose={() => setScopeFor(null)}
        />
      )}
    </>
  );

  // Inline mode — embedded straight into a screen (no bottom-sheet chrome).
  if (inline) {
    return (
      <div>
        {styleBlock}
        <div style={{ position: "sticky", top: 0, zIndex: 5, background: "#fff", paddingTop: 12 }}>
          {!hideSearchOnGrid && searchRow}
          {selectedRow}
          {categoryBackRow}
          {!showCategoryGrid && countRow}
        </div>
        {showCategoryGrid ? (
          categoryGrid
        ) : reference && browseCategories ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, padding: `2px ${px}px 0` }}>
            {cards}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: `2px ${px}px 0` }}>
            {cards}
          </div>
        )}
        {overlays}
      </div>
    );
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        zIndex: 200,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="catalog-sheet-inner"
        style={{
          background: "#f5f9f6",
          borderRadius: "20px 20px 0 0",
          width: "100%",
          maxWidth: 420,
          height: "92dvh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {styleBlock}

        {/* ── Header ── */}
        <div style={{ padding: "16px 18px 0", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 900, color: "#142f1d" }}>
                {gatePick ? "Elegir plato" : "Explorar catálogo"}
              </h3>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#7a9485" }}>
                {gatePick
                  ? "Mis recetas, favoritas o catálogo"
                  : "Elige platos que ya sabes cocinar"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              style={{
                border: "none", background: "#f0f4f1", borderRadius: 999,
                width: 32, height: 32, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {!hideSearchOnGrid && searchRow}
        {selectedRow}
        {!showCategoryGrid && countRow}

        <div
          style={
            !showCategoryGrid && reference && browseCategories
              ? { flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "2px 18px 12px", display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }
              : { flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "2px 18px 12px", display: "flex", flexDirection: "column", gap: 8 }
          }
        >
          {showCategoryGrid ? categoryGrid : cards}
        </div>
      </div>

      {overlays}
    </div>
  );
}

const FILTER_ROWS = [
  { key: "cats", label: "Categoría", icon: Tag },
  { key: "proteins", label: "Proteína", icon: Drumstick },
  { key: "time", label: "Tiempo máximo", icon: Clock },
  { key: "difficulty", label: "Dificultad", icon: BarChart3 },
  { key: "extras", label: "Extras", icon: Sparkles },
];

function FiltersSheet({
  onClose, resultCount,
  allCats, allProteins,
  cats, setCats, proteins, setProteins,
  maxTime, setMaxTime, difficulties, setDifficulties,
  kidOnly, setKidOnly,
  activeFilterCount, onClear,
}) {
  const [view, setView] = useState("list");

  const toggleIn = (setter) => (value) =>
    setter((prev) => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });

  const summary = {
    cats: cats.size === 0 ? "Todas" : `${cats.size} ${cats.size === 1 ? "elegida" : "elegidas"}`,
    proteins: proteins.size === 0 ? "Todas" : `${proteins.size} ${proteins.size === 1 ? "elegida" : "elegidas"}`,
    time: TIME_OPTIONS.find((t) => t.value === maxTime)?.label ?? "Cualquiera",
    difficulty:
      difficulties.size === 0
        ? "Cualquiera"
        : [...difficulties].map((d) => DIFFICULTY_LABEL[d]).join(", "),
    extras: kidOnly ? "Niños" : "Ninguno",
  };

  const current = FILTER_ROWS.find((r) => r.key === view);

  const applyBtn = (
    <button
      type="button"
      onClick={onClose}
      style={{
        width: "100%", height: 50, borderRadius: 14, border: "none",
        background: GREEN, color: "#fff", fontSize: 15, fontWeight: 800,
        cursor: "pointer", fontFamily: "inherit",
      }}
    >
      Ver {resultCount} {resultCount === 1 ? "plato" : "platos"}
    </button>
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 210,
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="catalog-sheet-inner"
        style={{
          background: "#f5f9f6", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 420,
          maxHeight: "82dvh", display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        <style>{`
          @keyframes checkPop {
            0%   { transform: scale(0.5); opacity: .4; }
            55%  { transform: scale(1.18); opacity: 1; }
            100% { transform: scale(1); }
          }
          .filter-opt-row {
            transition: background .16s ease;
          }
          .filter-opt-row:hover { background: rgba(45,90,61,.06); }
          .filter-opt-row:active { background: rgba(45,90,61,.11); }
          .filter-check {
            transition: background .18s cubic-bezier(.34,1.4,.6,1),
                        border-color .18s ease,
                        transform .18s cubic-bezier(.34,1.4,.6,1);
          }
          .filter-opt-row:active .filter-check { transform: scale(.88); }
          .filter-check-icon { animation: checkPop .22s cubic-bezier(.34,1.5,.6,1) both; }
        `}</style>

        {/* grabber */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 8, flexShrink: 0 }}>
          <span style={{ width: 38, height: 4, borderRadius: 999, background: "#dde7e0" }} />
        </div>

        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px 12px", flexShrink: 0 }}>
          {view !== "list" ? (
            <button
              type="button"
              onClick={() => setView("list")}
              aria-label="Volver"
              style={iconBtnStyle}
            >
              <ChevronLeft size={18} />
            </button>
          ) : null}
          <h3 style={{ flex: 1, margin: 0, fontSize: 17, fontWeight: 900, color: "#142f1d" }}>
            {view === "list" ? "Filtros" : current?.label}
          </h3>
          {view === "list" && activeFilterCount > 0 && (
            <button
              type="button"
              onClick={onClear}
              style={{
                border: "none", background: "transparent", color: GREEN,
                fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", padding: "4px 6px",
              }}
            >
              Limpiar
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Cerrar" style={iconBtnStyle}>
            <X size={18} />
          </button>
        </div>

        {/* body */}
        <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "0 16px" }}>
          {view === "list" && (
            <div>
              {FILTER_ROWS.map((row, i) => (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => setView(row.key)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 12,
                    padding: "14px 2px", border: "none", background: "transparent",
                    cursor: "pointer", fontFamily: "inherit",
                    borderTop: i === 0 ? "none" : "1px solid #eef3f0",
                  }}
                >
                  <row.icon size={18} color={GREEN} />
                  <span style={{ flex: 1, textAlign: "left", fontSize: 14.5, fontWeight: 700, color: "#142f1d" }}>
                    {row.label}
                  </span>
                  <span
                    style={{
                      fontSize: 12.5, fontWeight: 700,
                      color: summaryActive(row.key, { cats, proteins, maxTime, difficulties, kidOnly }) ? GREEN : "#9ab0a1",
                      maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}
                  >
                    {summary[row.key]}
                  </span>
                  <ChevronRight size={17} color="#c2cfc7" />
                </button>
              ))}
            </div>
          )}

          {view === "cats" && (
            <div style={{ paddingTop: 4 }}>
              <CheckRow
                label="Todas las categorías"
                checked={cats.size === 0}
                onToggle={() => setCats(new Set())}
              />
              {allCats.map((c, i) => (
                <CheckRow
                  key={c}
                  icon={CATEGORY_META[c]?.icon ?? Utensils}
                  iconColor={categoryColor(c)}
                  img={categoryImageSrc(c)}
                  label={categoryLabel(c)}
                  checked={cats.has(c)}
                  last={i === allCats.length - 1}
                  onToggle={() => toggleIn(setCats)(c)}
                />
              ))}
            </div>
          )}
          {view === "proteins" && (
            <div style={{ paddingTop: 4 }}>
              <CheckRow
                label="Todas las proteínas"
                checked={proteins.size === 0}
                onToggle={() => setProteins(new Set())}
              />
              {allProteins.map((p, i) => (
                <CheckRow
                  key={p}
                  img={proteinImageSrc(p)}
                  label={titleCase(p)}
                  checked={proteins.has(p)}
                  last={i === allProteins.length - 1}
                  onToggle={() => toggleIn(setProteins)(p)}
                />
              ))}
            </div>
          )}
          {view === "time" && (
            <div style={{ paddingTop: 4 }}>
              {TIME_OPTIONS.map((t, i) => (
                <CheckRow
                  key={t.value}
                  icon={t.value === 0 ? null : Clock}
                  label={t.label}
                  checked={maxTime === t.value}
                  single
                  last={i === TIME_OPTIONS.length - 1}
                  onToggle={() => setMaxTime(t.value)}
                />
              ))}
            </div>
          )}
          {view === "difficulty" && (
            <div style={{ paddingTop: 4 }}>
              <CheckRow
                label="Cualquier dificultad"
                checked={difficulties.size === 0}
                onToggle={() => setDifficulties(new Set())}
              />
              {Object.keys(DIFFICULTY_LABEL).map((d, i, arr) => (
                <CheckRow
                  key={d}
                  label={DIFFICULTY_LABEL[d]}
                  checked={difficulties.has(d)}
                  last={i === arr.length - 1}
                  onToggle={() => toggleIn(setDifficulties)(d)}
                />
              ))}
            </div>
          )}
          {view === "extras" && (
            <div style={{ paddingTop: 4 }}>
              <CheckRow
                icon={Baby}
                label="Apto para niños"
                checked={kidOnly}
                last
                onToggle={() => setKidOnly((v) => !v)}
              />
            </div>
          )}
        </div>

        {/* footer */}
        <div
          style={{
            padding: "12px 16px calc(14px + env(safe-area-inset-bottom, 0px))",
            borderTop: "1px solid #eef3f0", flexShrink: 0,
          }}
        >
          {applyBtn}
        </div>
      </div>
    </div>
  );
}

function summaryActive(key, { cats, proteins, maxTime, difficulties, kidOnly }) {
  if (key === "cats") return cats.size > 0;
  if (key === "proteins") return proteins.size > 0;
  if (key === "time") return maxTime > 0;
  if (key === "difficulty") return difficulties.size > 0;
  if (key === "extras") return kidOnly;
  return false;
}

function CheckRow({ icon: Icon, iconColor, img, label, checked, single, onToggle, last }) {
  // The illustration wins when there is one; the flat icon stays as the fallback
  // so a missing file degrades instead of leaving the label unaligned.
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = Boolean(img) && !imgFailed;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="filter-opt-row"
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 12,
        padding: showImg ? "8px 10px" : "13px 10px",
        border: "none", background: "transparent",
        cursor: "pointer", fontFamily: "inherit", borderRadius: 10, textAlign: "left",
        borderBottom: last ? "none" : "1px solid rgba(45,110,70,.2)",
      }}
    >
      {showImg ? (
        <span
          style={{
            width: 34, height: 34, borderRadius: 9, flexShrink: 0,
            overflow: "hidden", background: "#f2f7f4",
          }}
        >
          <img
            src={img}
            alt=""
            onError={() => setImgFailed(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        </span>
      ) : Icon ? (
        <span style={{ flexShrink: 0, display: "flex", width: 20, justifyContent: "center" }}>
          <Icon size={18} color={iconColor || GREEN} strokeWidth={2} />
        </span>
      ) : null}
      <span
        style={{
          flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: checked ? 800 : 600,
          color: checked ? GREEN : "#142f1d",
          transition: "color .16s ease",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span
        className="filter-check"
        style={{
          width: 22, height: 22, flexShrink: 0,
          borderRadius: single ? 999 : 6,
          border: `1.5px solid ${checked ? GREEN : "#cdd8d0"}`,
          background: checked ? GREEN : "#fff",
          color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        {checked && <Check className="filter-check-icon" size={14} strokeWidth={3} />}
      </span>
    </button>
  );
}

const iconBtnStyle = {
  border: "none", background: "#f0f4f1", borderRadius: 999,
  width: 32, height: 32, cursor: "pointer", flexShrink: 0,
  display: "flex", alignItems: "center", justifyContent: "center",
};

function SelectedChip({ kind, label, onClear }) {
  const Icon = kind === "guarnicion" ? Salad : Utensils;
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
        borderRadius: 10, border: `1.5px solid ${GREEN}`, background: "#eaf6ee",
      }}
    >
      <Icon size={14} color={GREEN} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: GREEN, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {kind === "guarnicion" ? "Guarnición: " : "Plato: "}{label}
      </span>
      <button
        type="button"
        onClick={onClear}
        aria-label="Quitar selección"
        style={{
          width: 22, height: 22, borderRadius: 6, border: "none", background: "#fff",
          color: GREEN, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}
      >
        <X size={12} />
      </button>
    </div>
  );
}

function GatePickCard({ kind, item, selected, onToggle, animDelay = 0 }) {
  const isPlato = kind === "plato";
  const color = isPlato ? categoryColor(item.category) : "#3f9656";
  const photo = isPlato ? (item.photo ?? dishImageUrl(item.id)) : null;

  return (
    <button
      type="button"
      onClick={onToggle}
      className="catalog-card-enter"
      style={{
        width: "100%", textAlign: "left", cursor: "pointer", fontFamily: "inherit",
        flexShrink: 0, borderRadius: 14,
        border: `1.5px solid ${selected ? "#bfe6cb" : "#eef3f0"}`,
        background: selected ? "#f2fbf5" : "#fff",
        transition: "border-color .15s ease, background .15s ease",
        overflow: "hidden", animationDelay: `${animDelay}ms`,
        padding: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 8 }}>
        <div
          style={{
            width: 52, height: 52, borderRadius: 12, flexShrink: 0, overflow: "hidden",
            boxSizing: "border-box", border: `2.5px solid ${color}`,
            background: `${color}14`, display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {photo ? (
            <img src={deckImg(photo, 104)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : isPlato ? (
            <CategoryIcon category={item.category} size={22} />
          ) : (
            <Salad size={22} color={color} />
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              margin: 0, fontSize: 13.5, fontWeight: 800, color: "#142f1d", lineHeight: 1.25,
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
            }}
          >
            {item.name}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 800, color }}>
              {isPlato ? categoryLabel(item.category) : "Guarnición"}
            </span>
            {item.source === "user" && (
              <span
                style={{
                  fontSize: 10, fontWeight: 800, color: GREEN, background: "#eaf6ee",
                  padding: "2px 6px", borderRadius: 6, letterSpacing: ".2px",
                }}
              >
                Tuya
              </span>
            )}
            {item.time != null && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: "#7a9485" }}>
                <Clock size={11} /> {item.time} min
              </span>
            )}
          </div>
        </div>

        <span
          style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            border: "none", background: selected ? GREEN : "#eaf3ed", color: selected ? "#fff" : GREEN,
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "background .15s ease, color .15s ease",
          }}
        >
          {selected ? <Check size={18} /> : <Plus size={18} />}
        </span>
      </div>
    </button>
  );
}

// Inline visibility quick-change pill for user-owned recipes (browse mode).
const VIS_META = {
  public:  { icon: Globe,  label: "Pública",     color: "#2d5a3d", bg: "#e6f3ea" },
  friends: { icon: Users2, label: "Solo amigos", color: "#7a4e00", bg: "#fff8e7" },
  private: { icon: Lock,   label: "Privada",     color: "#5a2d7a", bg: "#f5edfc" },
};

function VisibilityMiniPill({ visibility = "private", onChange }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const [menuPos, setMenuPos] = useState(null);
  const current = VIS_META[visibility] ?? VIS_META.private;
  const Icon = current.icon;

  // The card clips overflow (rounded thumbnail), so an absolutely-positioned
  // dropdown was invisible. Render it in a portal with fixed coords measured
  // from the trigger, and flip above if there's no room below.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const measure = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const MENU_H = 150;
      const below = window.innerHeight - r.bottom;
      const openUp = below < MENU_H && r.top > below;
      setMenuPos({
        left: r.left,
        top: openUp ? undefined : r.bottom + 4,
        bottom: openUp ? window.innerHeight - r.top + 4 : undefined,
      });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = () => setOpen(false);
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open]);

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "3px 8px 3px 6px", borderRadius: 999, border: "none", cursor: "pointer",
          background: current.bg, fontFamily: "inherit",
        }}
      >
        <Icon size={10} color={current.color} />
        <span style={{ fontSize: 10, fontWeight: 700, color: current.color }}>{current.label}</span>
        <ChevronDown size={9} color={current.color} />
      </button>
      {open && menuPos && createPortal(
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed", left: menuPos.left, top: menuPos.top, bottom: menuPos.bottom, zIndex: 400,
            background: "#fff", borderRadius: 12, border: "1.5px solid #e8efe9",
            boxShadow: "0 6px 20px rgba(0,0,0,.12)", minWidth: 146, overflow: "hidden",
          }}
        >
          {Object.entries(VIS_META).map(([id, meta]) => {
            const Ic = meta.icon;
            const active = id === visibility;
            return (
              <button
                key={id}
                type="button"
                onClick={(e) => { e.stopPropagation(); onChange?.(id); setOpen(false); }}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 8,
                  padding: "9px 12px", border: "none", cursor: "pointer",
                  fontFamily: "inherit", textAlign: "left",
                  background: active ? meta.bg : "#fff",
                }}
              >
                <Ic size={13} color={meta.color} />
                <span style={{ fontSize: 12.5, fontWeight: active ? 800 : 600, color: active ? meta.color : "#1a3a24" }}>
                  {meta.label}
                </span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}

function RecipeCard({
  recipe, reference = false, added, garnishId, salsaId, onAdd, onRemove, onOpenGarnish, onOpenSalsa,
  onOpenRecipe, favorite, onSetFavoriteScope, scopeGroups = [], onOpenScopePicker, onChangeVisibility, onDelete, onEdit, onCombine, ownView = false, animDelay = 0,
  discarded = false, onDiscard,
}) {
  const hasScopeChoice = scopeGroups.length > 1 && onOpenScopePicker;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const color = categoryColor(recipe.category);
  const isPrincipal = recipe.type === "principal";
  const garnish = garnishId ? GARNISH_BY_ID[garnishId] : null;
  const salsa = salsaId ? SALSA_BY_ID[salsaId] : null;
  const photo = dishImageForRecipe(recipe, garnishId ?? undefined);

  // "Mis recetas" gets its own full-bleed card: photo fills the whole tile,
  // el nombre va superpuesto sobre un degradado (mismo lenguaje que "Hoy
  // toca" en Dashboard), y el tiempo de preparación va en un círculo arriba
  // a la derecha en vez de en texto suelto — la fila compacta de siempre
  // sigue viva para Favoritas/Catálogo/Descartados.
  const card = ownView ? (
    <div
      className="catalog-card-enter"
      style={{
        position: "relative",
        aspectRatio: "4 / 3",
        borderRadius: 14,
        overflow: "hidden",
        background: "#eef4f0",
        border: `1.5px solid ${added ? "#bfe6cb" : "#eef3f0"}`,
        animationDelay: `${animDelay}ms`,
      }}
    >
      <button
        type="button"
        onClick={reference && onOpenRecipe ? () => onOpenRecipe(recipe) : undefined}
        disabled={!reference || !onOpenRecipe}
        aria-label={`Ver ${recipe.name}`}
        style={{
          position: "absolute", inset: 0, padding: 0, border: "none", background: "transparent",
          cursor: reference && onOpenRecipe ? "pointer" : "default",
        }}
      >
        {photo ? (
          <img src={deckImg(photo, 320)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <CategoryIcon category={recipe.category} size={30} />
          </div>
        )}
      </button>

      <div
        aria-hidden
        style={{
          position: "absolute", left: 0, right: 0, bottom: 0, height: "58%",
          background: "linear-gradient(to top, rgba(0,0,0,.72) 0%, rgba(0,0,0,.16) 65%, transparent 100%)",
          pointerEvents: "none",
        }}
      />
      <p
        style={{
          position: "absolute", left: 10, right: 10, bottom: 9, margin: 0,
          fontSize: 13.5, fontWeight: 800, color: "#fff", lineHeight: 1.25,
          textShadow: "0 1px 3px rgba(0,0,0,.4)",
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        {recipe.name}
      </p>

      {recipe.time != null && (
        <span
          style={{
            position: "absolute", top: 8, right: 8,
            width: 30, height: 30, borderRadius: "50%",
            background: "rgba(255,255,255,.92)", color: "#142f1d",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11.5, fontWeight: 800,
            boxShadow: "0 1px 4px rgba(20,47,29,.16)",
          }}
        >
          {recipe.time}
        </span>
      )}

      {reference && onSetFavoriteScope && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (hasScopeChoice) onOpenScopePicker();
            else onSetFavoriteScope(recipe.id, favorite ? null : "all");
          }}
          aria-label={favorite ? "Quitar de favoritas" : "Añadir a favoritas"}
          title={favorite ? "Quitar de favoritas" : "Añadir a favoritas"}
          style={{
            position: "absolute", top: 8, left: 8,
            width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
            border: "none", cursor: "pointer",
            background: favorite ? "#e0405a" : "rgba(255,255,255,.92)",
            boxShadow: "0 1px 4px rgba(0,0,0,.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <Heart size={12} color={favorite ? "#fff" : "#c9b8ae"} fill={favorite ? "#fff" : "none"} strokeWidth={2.4} />
        </button>
      )}
    </div>
  ) : (
    <div
      className="catalog-card-enter"
      style={{
        flexShrink: 0,
        borderRadius: 14,
        border: `1.5px solid ${added ? "#bfe6cb" : "#eef3f0"}`,
        background: added ? "#f2fbf5" : "#fff",
        transition: "border-color .15s ease, background .15s ease",
        overflow: "hidden",
        animationDelay: `${animDelay}ms`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 8 }}>
        {/* thumbnail — colored ring per category. Heart (top-right) and discard
            (bottom-right) sit on the photo as siblings, never nested buttons. */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <button
            type="button"
            onClick={reference && onOpenRecipe ? () => onOpenRecipe(recipe) : undefined}
            disabled={!reference || !onOpenRecipe}
            aria-label={reference && onOpenRecipe ? `Ver ${recipe.name}` : undefined}
            style={{
              display: "block", padding: 0, border: "none", background: "transparent",
              cursor: reference && onOpenRecipe ? "pointer" : "default",
            }}
          >
            <div
              style={{
                width: 52, height: 52, borderRadius: 12, overflow: "hidden",
                boxSizing: "border-box", border: `2.5px solid ${color}`,
                background: `${color}14`, display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              {photo ? (
                <img src={deckImg(photo, 104)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <CategoryIcon category={recipe.category} size={22} />
              )}
            </div>
          </button>
          {reference && onSetFavoriteScope && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (hasScopeChoice) onOpenScopePicker();
                else onSetFavoriteScope(recipe.id, favorite ? null : "all");
              }}
              aria-label={favorite ? "Quitar de favoritas" : "Añadir a favoritas"}
              title={favorite ? "Quitar de favoritas" : "Añadir a favoritas"}
              style={{
                position: "absolute", top: -6, right: -6,
                width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                border: "2px solid #fff", cursor: "pointer",
                background: favorite ? "#e0405a" : "#fff",
                boxShadow: "0 1px 4px rgba(0,0,0,.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all .15s ease",
                zIndex: 1,
              }}
            >
              <Heart
                size={11}
                color={favorite ? "#fff" : "#c9b8ae"}
                strokeWidth={2.4}
                fill={favorite ? "#fff" : "none"}
              />
            </button>
          )}
          {reference && onDiscard && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDiscard(); }}
              aria-label={discarded ? `Recuperar ${recipe.name}` : `Descartar ${recipe.name}`}
              title={discarded ? "Recuperar (vuelve al catálogo)" : "Descartar (No me gusta)"}
              style={{
                position: "absolute", bottom: -6, right: -6,
                width: 22, height: 22, borderRadius: "50%", flexShrink: 0, cursor: "pointer",
                border: "2px solid #fff",
                background: discarded ? "#c0392b" : "#fff",
                color: discarded ? "#fff" : "#c9adb0",
                boxShadow: "0 1px 4px rgba(0,0,0,.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all .15s ease",
                zIndex: 1,
              }}
            >
              {discarded ? <RotateCcw size={11} /> : <Ban size={11} />}
            </button>
          )}
        </div>

        {/* info — its own open-recipe button (sibling of the thumbnail one) */}
        <button
          type="button"
          onClick={reference && onOpenRecipe ? () => onOpenRecipe(recipe) : undefined}
          disabled={!reference || !onOpenRecipe}
          style={{
            flex: 1, minWidth: 0, display: "block",
            padding: 0, border: "none", background: "transparent",
            cursor: reference && onOpenRecipe ? "pointer" : "default",
            fontFamily: "inherit", textAlign: "left",
          }}
        >
          <p
            style={{
              margin: 0, fontSize: 13.5, fontWeight: 800, color: "#142f1d", lineHeight: 1.25,
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
            }}
          >
            {recipe.name}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 800, color }}>{categoryLabel(recipe.category)}</span>
            {recipe.source === "user" && !ownView && (
              <span
                style={{
                  fontSize: 10, fontWeight: 800, color: GREEN, background: "#eaf6ee",
                  padding: "2px 6px", borderRadius: 6, letterSpacing: ".2px",
                }}
              >
                Tuya
              </span>
            )}
            {favorite && (
              <span style={{ fontSize: 10, fontWeight: 800, color: GREEN, background: "#eaf6ee", padding: "2px 6px", borderRadius: 6 }}>
                Favorita
              </span>
            )}
            {recipe.time != null && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: "#7a9485" }}>
                <Clock size={11} /> {recipe.time} min
              </span>
            )}
            {recipe.kcal != null && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: "#7a9485" }}>
                <Flame size={11} /> {recipe.kcal} kcal
              </span>
            )}
          </div>
          {isPrincipal && added && garnish && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 5, fontSize: 11, fontWeight: 700, color: GREEN }}>
              <Salad size={12} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 170 }}>
                {garnish.name}
              </span>
            </div>
          )}
          {isPrincipal && added && salsa && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 5, fontSize: 11, fontWeight: 700, color: "#c2703d" }}>
              <Droplets size={12} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 170 }}>
                {salsa.name}
              </span>
            </div>
          )}
        </button>

        {/* Reference mode: owner + votes column (+ optional garnish combo).
            Discard lives on the thumbnail, not here. */}
        {reference ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {onCombine && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onCombine(); }}
                aria-label={`Ver ${recipe.name} con guarnición`}
                title="Ver con guarnición"
                style={{
                  width: 34, height: 34, borderRadius: 10, flexShrink: 0, cursor: "pointer",
                  border: `1.5px dashed ${GREEN}`, background: "#fff", color: GREEN,
                  display: "flex", alignItems: "center", justifyContent: "center", position: "relative",
                }}
              >
                <Salad size={16} />
                <span
                  style={{
                    position: "absolute", bottom: -3, right: -3, width: 15, height: 15,
                    borderRadius: "50%", background: GREEN, color: "#fff", border: "1.5px solid #fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <Plus size={9} strokeWidth={3} />
                </span>
              </button>
            )}
            <RecipeProvenance recipe={recipe} />
          </div>
        ) : (
          <>
            {/* garnish icon button — only for principal dishes once added */}
            {isPrincipal && added && (
              <button
                type="button"
                onClick={onOpenGarnish}
                aria-label={garnish ? `Cambiar guarnición de ${recipe.name}` : `Añadir guarnición a ${recipe.name}`}
                title={garnish ? "Cambiar guarnición" : "Añadir guarnición"}
                style={{
                  width: 36, height: 36, borderRadius: 10, flexShrink: 0, cursor: "pointer",
                  border: garnish ? "none" : `1.5px dashed ${GREEN}`,
                  background: garnish ? GREEN : "#fff",
                  color: garnish ? "#fff" : GREEN,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all .12s ease",
                }}
              >
                <Salad size={17} />
              </button>
            )}

            {/* salsa icon button — solo en platos verificados como aptos
                (canReceiveSauce), evita ofrecer salsa a un "Merluza en salsa
                verde" que ya lleva la suya integrada — ver recipeSchema.js */}
            {isPrincipal && added && recipe.canReceiveSauce && (
              <button
                type="button"
                onClick={onOpenSalsa}
                aria-label={salsa ? `Cambiar salsa de ${recipe.name}` : `Añadir salsa a ${recipe.name}`}
                title={salsa ? "Cambiar salsa" : "Añadir salsa"}
                style={{
                  width: 36, height: 36, borderRadius: 10, flexShrink: 0, cursor: "pointer",
                  border: salsa ? "none" : "1.5px dashed #c2703d",
                  background: salsa ? "#c2703d" : "#fff",
                  color: salsa ? "#fff" : "#c2703d",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all .12s ease",
                }}
              >
                <Droplets size={17} />
              </button>
            )}

            {/* add / added toggle */}
            <button
              type="button"
              onClick={added ? onRemove : onAdd}
              aria-label={added ? `Quitar ${recipe.name}` : `Añadir ${recipe.name}`}
              className={added ? "catalog-added-pop" : undefined}
              style={{
                width: 36, height: 36, borderRadius: 10, flexShrink: 0, cursor: "pointer",
                border: "none",
                background: added ? GREEN : "#eaf3ed",
                color: added ? "#fff" : GREEN,
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "background .15s ease, color .15s ease",
              }}
            >
              {added ? <Check size={18} /> : <Plus size={18} />}
            </button>
          </>
        )}
      </div>
    </div>
  );

  // "Mis recetas" view: edit + delete icons live OUTSIDE the card, on the
  // right, as a vertical column (delete asks for confirmation inline).
  if (!ownView || (!onEdit && !onDelete)) return card;
  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>{card}</div>
      <div
        style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 8, flexShrink: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        {confirmDelete ? (
          <>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete?.(); }}
              aria-label={`Borrar ${recipe.name}`}
              title="Confirmar borrado"
              style={{
                width: 38, height: 38, borderRadius: 11, flexShrink: 0, border: "none", cursor: "pointer",
                background: "#c0392b", color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <Trash2 size={16} />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
              aria-label="Cancelar"
              title="Cancelar"
              style={{
                width: 38, height: 38, borderRadius: 11, flexShrink: 0, cursor: "pointer",
                border: "1.5px solid #e8efe9", background: "#fff", color: "#7a9485",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <X size={16} />
            </button>
          </>
        ) : (
          <>
            {onEdit && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onEdit(); }}
                aria-label={`Editar ${recipe.name}`}
                title="Editar receta"
                style={{
                  width: 38, height: 38, borderRadius: 11, flexShrink: 0, cursor: "pointer",
                  border: "1.5px solid #e0e8e3", background: "#fff", color: GREEN,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <Pencil size={15} />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
                aria-label={`Borrar ${recipe.name}`}
                title="Borrar receta"
                style={{
                  width: 38, height: 38, borderRadius: 11, flexShrink: 0, cursor: "pointer",
                  border: "none", background: "#fdecea", color: "#c0392b",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <Trash2 size={15} />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const DIFFICULTY_BADGE_COLOR = { facil: "#2d5a3d", normal: "#a97a1f", elaborada: "#c0392b" };

// "45 min" por debajo de 60; a partir de ahí "1h", "1h15", "1h30"... sin
// minutos si son 0 en punto.
function formatDishTime(totalMin) {
  if (totalMin < 60) return `${totalMin} min`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return mins ? `${hours}h${mins}` : `${hours}h`;
}

// Tile de foto a página completa para el grid de 2 columnas del Catálogo
// (reference + browseCategories, ver RecipesScreen). El Recetario Estrella es
// el único catálogo que se navega aquí, así que toda receta que llega ya
// tiene foto propia — sin guarnición, sin salsa, sin descarte: eso vivía en
// la lista antigua y ya no aplica a este pool.
// Debajo del corazon, no a su lado: arriba a la derecha ya vive favoritos, y
// compartir esquina los pintaba uno encima del otro.
const socialPins = {
  position: "absolute", top: 36, right: 6, zIndex: 2,
  display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-end",
};

const socialPin = {
  display: "inline-flex", alignItems: "center", gap: 3,
  padding: "2px 6px", borderRadius: 999,
  background: "rgba(255,255,255,.92)", color: "#42594c",
  fontSize: 9.5, fontWeight: 800,
};

function RecipeGridCard({
  recipe, favorite, onSetFavoriteScope, hasScopeChoice, onOpenScopePicker, onOpenRecipe, onDelete,
  onOpenFolders, inFolders = 0, animDelay = 0, social = null,
}) {
  const color = categoryColor(recipe.category);
  const photo = dishImageForRecipe(recipe);
  const diffLabel = DIFFICULTY_LABEL[recipe.difficulty];
  const diffColor = DIFFICULTY_BADGE_COLOR[recipe.difficulty] ?? GREEN;
  // Dos toques para borrar: el primero pide confirmación en el propio icono.
  // Sin diálogo, pero tampoco un borrado irreversible a un solo toque.
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="catalog-card-enter" style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, animationDelay: `${animDelay}ms` }}>
      <button
        type="button"
        onClick={onOpenRecipe ? () => onOpenRecipe(recipe) : undefined}
        disabled={!onOpenRecipe}
        aria-label={`Ver ${recipe.name}`}
        style={{
          position: "relative", width: "100%", aspectRatio: "1 / 1",
          padding: 0, border: "none", borderRadius: 14, overflow: "hidden",
          cursor: onOpenRecipe ? "pointer" : "default", fontFamily: "inherit",
          background: `${color}14`,
          boxShadow: "inset 0 0 0 1px #dce8e0",
        }}
      >
        {social?.stats && (social.stats.likes > 0 || social.stats.comments > 0) && (
          <span style={socialPins}>
            {social.stats.likes > 0 && (
              <span style={socialPin}><ThumbsUp size={9} strokeWidth={2.8} /> {social.stats.likes}</span>
            )}
            {social.stats.comments > 0 && (
              <span style={socialPin}><MessageCircle size={9} strokeWidth={2.8} /> {social.stats.comments}</span>
            )}
          </span>
        )}
        {photo ? (
          <img src={deckImg(photo, 280)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          <span style={{ display: "grid", placeItems: "center", width: "100%", height: "100%" }}>
            <CategoryIcon category={recipe.category} size={28} />
          </span>
        )}
        {diffLabel && (
          <span
            style={{
              position: "absolute", top: 6, left: 6,
              fontSize: 10, fontWeight: 800, letterSpacing: ".2px",
              padding: "2.5px 7px", borderRadius: 999,
              background: "rgba(255,255,255,.92)", color: diffColor,
              boxShadow: "0 1px 3px rgba(0,0,0,.15)",
            }}
          >
            {diffLabel}
          </span>
        )}
        {onSetFavoriteScope && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              if (hasScopeChoice) onOpenScopePicker?.();
              else onSetFavoriteScope(recipe.id, favorite ? null : "all");
            }}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.click(); }}
            aria-label={favorite ? "Quitar de favoritas" : "Añadir a favoritas"}
            style={{
              position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: "50%",
              border: "1.5px solid #fff", background: favorite ? "#e0405a" : "rgba(255,255,255,.92)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 1px 3px rgba(0,0,0,.2)", zIndex: 1,
            }}
          >
            <Heart size={12} color={favorite ? "#fff" : "#c9b8ae"} fill={favorite ? "#fff" : "none"} strokeWidth={2.4} />
          </span>
        )}
        {onOpenFolders && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onOpenFolders(); }}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.click(); }}
            aria-label={`Guardar ${recipe.name} en una carpeta`}
            title="Guardar en una carpeta"
            style={{
              position: "absolute", bottom: 6, left: 6, height: 24, minWidth: 24,
              padding: inFolders ? "0 7px" : 0, borderRadius: 999,
              border: "1.5px solid #fff",
              background: inFolders ? GREEN : "rgba(255,255,255,.92)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 3,
              boxShadow: "0 1px 3px rgba(0,0,0,.2)", zIndex: 1,
              fontSize: 10.5, fontWeight: 800, color: "#fff",
            }}
          >
            <FolderIcon size={12} color={inFolders ? "#fff" : "#8aa294"} strokeWidth={2.4} />
            {inFolders > 0 && inFolders}
          </span>
        )}
        {onDelete && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              if (confirmDelete) onDelete();
              else setConfirmDelete(true);
            }}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.click(); }}
            aria-label={confirmDelete ? `Confirmar borrado de ${recipe.name}` : `Borrar ${recipe.name}`}
            title={confirmDelete ? "Toca otra vez para borrar" : "Borrar receta"}
            style={{
              position: "absolute", bottom: 6, right: 6,
              height: 24, minWidth: 24, padding: confirmDelete ? "0 8px" : 0,
              borderRadius: 999,
              border: "1.5px solid #fff",
              background: confirmDelete ? "#c0392b" : "rgba(255,255,255,.92)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
              boxShadow: "0 1px 3px rgba(0,0,0,.2)", zIndex: 1,
              fontSize: 10.5, fontWeight: 800, color: "#fff",
            }}
          >
            <Trash2 size={12} color={confirmDelete ? "#fff" : "#c0392b"} strokeWidth={2.4} />
            {confirmDelete && "Borrar"}
          </span>
        )}
      </button>
      <div>
        <p
          style={{
            margin: 0, fontSize: 12.5, fontWeight: 800, color: "#142f1d", lineHeight: 1.25,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}
        >
          {recipe.name}
        </p>
        {recipe.time != null && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, marginTop: 3, fontSize: 10.5, color: "#7a9485" }}>
            <Clock size={10} /> {formatDishTime(recipe.time)}
          </span>
        )}
      </div>
    </div>
  );
}

// Small centered popup shown when tapping the heart on a recipe card in a
// multi-group household: picks whether the favorite applies to everyone or
// to one specific group, in a single tap.
export function GarnishPickerSheet({
  recipe, currentGarnishId, onSelect, onClose, title, subtitle,
  previewPrincipalId = null,
  recipeVotes = {}, scopeGroups = [], onSetFavoriteScope, onOpenScopePicker,
  discardedIds = null, onDiscardRecipe, onRecoverRecipe,
}) {
  const hasScopeChoice = scopeGroups.length > 1 && onOpenScopePicker;
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 220,
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="catalog-sheet-inner"
        style={{
          background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 420,
          maxHeight: "82dvh", display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        {/* grabber */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 8, flexShrink: 0 }}>
          <span style={{ width: 38, height: 4, borderRadius: 999, background: "#dde7e0" }} />
        </div>

        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px 12px", flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 900, color: "#142f1d" }}>{title ?? "Elige guarnición"}</h3>
            {subtitle !== null && (
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#7a9485", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {subtitle ?? `para ${recipe.name}`}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" style={iconBtnStyle}>
            <X size={18} />
          </button>
        </div>

        {/* Grid 3× — miniatura entera de la guarnición + nombre debajo */}
        <div
          style={{
            flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch",
            padding: "8px 16px calc(24px + env(safe-area-inset-bottom, 0px))",
            display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12,
            alignContent: "start",
          }}
        >
          {GARNISHES.map((g) => {
            const enriched = recipeCatalogById[g.id] ?? g;
            const cardRecipe = { ...enriched, category: enriched.category ?? "guarniciones" };
            const label = capitalizeGarnishLabel(g.shortName ?? g.name);
            return (
              <GarnishGridTile
                key={g.id}
                garnish={g}
                principalId={previewPrincipalId}
                label={label}
                selected={g.id === currentGarnishId}
                onSelect={() => onSelect(g.id === currentGarnishId ? null : g.id)}
                favorite={isRecipeFavorite(recipeVotes, g.id)}
                onSetFavoriteScope={onSetFavoriteScope}
                hasScopeChoice={hasScopeChoice}
                onOpenScopePicker={() => onOpenScopePicker?.(cardRecipe)}
                discarded={discardedIds ? discardedIds.has(g.id) : false}
                onDiscard={onDiscardRecipe ? () => onDiscardRecipe(g.id) : undefined}
                onRecover={onRecoverRecipe ? () => onRecoverRecipe(g.id) : undefined}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Mismo patrón que GarnishPickerSheet, simplificado: una salsa no tiene combo
// de foto con el plato (solo su propia foto) ni favoritos/descartes propios.
export function SalsaPickerSheet({ recipe, currentSalsaId, onSelect, onClose, title, subtitle }) {
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 220,
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="catalog-sheet-inner"
        style={{
          background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 420,
          maxHeight: "82dvh", display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 8, flexShrink: 0 }}>
          <span style={{ width: 38, height: 4, borderRadius: 999, background: "#dde7e0" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px 12px", flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 900, color: "#142f1d" }}>{title ?? "Elige salsa"}</h3>
            {subtitle !== null && (
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#7a9485", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {subtitle ?? `para ${recipe.name}`}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" style={iconBtnStyle}>
            <X size={18} />
          </button>
        </div>
        <div
          style={{
            flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch",
            padding: "8px 16px calc(24px + env(safe-area-inset-bottom, 0px))",
            display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12,
            alignContent: "start",
          }}
        >
          {SALSAS.map((s) => (
            <SalsaGridTile
              key={s.id}
              salsa={s}
              selected={s.id === currentSalsaId}
              onSelect={() => onSelect(s.id === currentSalsaId ? null : s.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SalsaGridTile({ salsa, selected, onSelect }) {
  const [failed, setFailed] = useState(false);
  const rawPhoto = dishImageUrl(salsa.id);
  const photo = rawPhoto && !failed ? deckImg(rawPhoto, 280) : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={salsa.name}
        style={{
          position: "relative", width: "100%", aspectRatio: "1 / 1", padding: 0,
          border: "none", borderRadius: 14, overflow: "hidden", cursor: "pointer",
          fontFamily: "inherit", background: "#fbf1ea",
          boxShadow: selected ? "inset 0 0 0 3px #0f766e, 0 0 0 3px rgba(15,118,110,.25)" : "inset 0 0 0 1px #ecd9cb",
        }}
      >
        {photo ? (
          <img
            src={photo}
            alt=""
            loading="lazy"
            onError={() => setFailed(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <span style={{ display: "grid", placeItems: "center", width: "100%", height: "100%" }}>
            <Droplets size={28} color="#c2703d" />
          </span>
        )}
        {selected && (
          <span
            aria-hidden
            style={{
              position: "absolute", top: 6, left: 6, width: 22, height: 22, borderRadius: "50%",
              border: "1.5px solid #fff", background: "#0f766e",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 1px 3px rgba(0,0,0,.2)", zIndex: 1,
            }}
          >
            <Check size={13} color="#fff" strokeWidth={3} />
          </span>
        )}
      </button>
      <span style={{ fontSize: 11, fontWeight: 800, color: "#142f1d", textAlign: "center", lineHeight: 1.25, padding: "0 1px 2px" }}>
        {salsa.name}
      </span>
    </div>
  );
}

// "Ver combinado": elegir guarnición y/o salsa para previsualizar un plato
// combinado, con control segmentado (Guarnición / Salsa / Ambas) y un CTA
// "Elegir" fijo al fondo — a diferencia de GarnishPickerSheet, tocar una
// tarjeta la marca como seleccionada pero NO cierra el sheet; hay que
// confirmar con el botón.
function AddonPickerSheet({
  recipe, garnishCatalog, onConfirm, onClose,
  discardedIds = null, onDiscardRecipe, onRecoverRecipe,
}) {
  const canSalsa = Boolean(recipe.canReceiveSauce);
  const [tab, setTab] = useState("guarnicion");
  const [garnishId, setGarnishId] = useState(null);
  const [sauceId, setSauceId] = useState(null);

  const showGarnishGrid = tab === "guarnicion" || tab === "ambas";
  const showSalsaGrid = canSalsa && (tab === "salsa" || tab === "ambas");

  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 220,
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="catalog-sheet-inner"
        style={{
          background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 420,
          maxHeight: "82dvh", display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 8, flexShrink: 0 }}>
          <span style={{ width: 38, height: 4, borderRadius: 999, background: "#dde7e0" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px 12px", flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 900, color: "#142f1d" }}>Combinar plato</h3>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#7a9485", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              Ver {recipe.name} combinado
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" style={iconBtnStyle}>
            <X size={18} />
          </button>
        </div>

        {canSalsa && (
          <div style={{ padding: "0 16px 12px", flexShrink: 0 }}>
            <SegmentedTabBar>
              <SegmentedTabButton selected={tab === "guarnicion"} onClick={() => setTab("guarnicion")} label="Guarnición" accent={GREEN} />
              <SegmentedTabButton selected={tab === "salsa"} onClick={() => setTab("salsa")} label="Salsa" accent="#c2703d" />
              <SegmentedTabButton selected={tab === "ambas"} onClick={() => setTab("ambas")} label="Ambas" accent="#0f766e" />
            </SegmentedTabBar>
          </div>
        )}

        <div
          style={{
            flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch",
            padding: "0 16px 20px",
          }}
        >
          {showGarnishGrid && (
            <>
              {tab === "ambas" && (
                <p style={{ margin: "4px 0 8px", fontSize: 11.5, fontWeight: 800, color: GREEN, letterSpacing: ".2px" }}>
                  GUARNICIÓN
                </p>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginBottom: tab === "ambas" ? 18 : 0 }}>
                {garnishCatalog.map((g) => {
                  const label = capitalizeGarnishLabel(g.shortName ?? g.name);
                  return (
                    <GarnishGridTile
                      key={g.id}
                      garnish={g}
                      label={label}
                      selected={g.id === garnishId}
                      onSelect={() => setGarnishId(g.id === garnishId ? null : g.id)}
                      discarded={discardedIds ? discardedIds.has(g.id) : false}
                      onDiscard={onDiscardRecipe ? () => onDiscardRecipe(g.id) : undefined}
                      onRecover={onRecoverRecipe ? () => onRecoverRecipe(g.id) : undefined}
                    />
                  );
                })}
              </div>
            </>
          )}
          {showSalsaGrid && (
            <>
              {tab === "ambas" && (
                <p style={{ margin: "4px 0 8px", fontSize: 11.5, fontWeight: 800, color: "#c2703d", letterSpacing: ".2px" }}>
                  SALSA
                </p>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
                {SALSAS.map((s) => (
                  <SalsaGridTile
                    key={s.id}
                    salsa={s}
                    selected={s.id === sauceId}
                    onSelect={() => setSauceId(s.id === sauceId ? null : s.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* CTA fijo al fondo — nunca se desplaza con el scroll de la cuadrícula. */}
        <div style={{ padding: "12px 16px calc(14px + env(safe-area-inset-bottom, 0px))", borderTop: "1px solid #eef3f0", flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => onConfirm({ garnishId, sauceId })}
            style={{
              width: "100%", padding: "13px 16px", borderRadius: 13, border: "none",
              background: "#0f766e", color: "#fff", fontSize: 14.5, fontWeight: 800,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Elegir
          </button>
        </div>
      </div>
    </div>
  );
}

function capitalizeGarnishLabel(text) {
  const s = String(text ?? "").trim();
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function GarnishGridTile({
  garnish, principalId = null, label, selected, onSelect,
  favorite, onSetFavoriteScope, hasScopeChoice, onOpenScopePicker,
  discarded, onDiscard, onRecover,
}) {
  const [failed, setFailed] = useState(false);
  const rawPhoto = principalId
    ? (dishImageUrl(principalId, garnish.id) ?? dishImageUrl(garnish.id))
    : dishImageUrl(garnish.id);
  const photo = rawPhoto && !failed ? deckImg(rawPhoto, 280) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={label}
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "1 / 1",
          padding: 0,
          border: "none",
          borderRadius: 14,
          overflow: "hidden",
          cursor: "pointer",
          fontFamily: "inherit",
          background: "#eef4ef",
          boxShadow: selected ? "inset 0 0 0 3px #0f766e, 0 0 0 3px rgba(15,118,110,.25)" : "inset 0 0 0 1px #dce8e0",
          opacity: discarded ? 0.45 : 1,
        }}
      >
        {photo ? (
          <img
            src={photo}
            alt=""
            loading="lazy"
            onError={() => setFailed(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <span style={{ display: "grid", placeItems: "center", width: "100%", height: "100%" }}>
            <Salad size={28} color="#3f9656" />
          </span>
        )}
        {selected && (
          <span
            aria-hidden
            style={{
              position: "absolute", top: 6, left: 6, width: 22, height: 22, borderRadius: "50%",
              border: "1.5px solid #fff", background: "#0f766e",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 1px 3px rgba(0,0,0,.2)", zIndex: 1,
            }}
          >
            <Check size={13} color="#fff" strokeWidth={3} />
          </span>
        )}
        {onSetFavoriteScope && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              if (hasScopeChoice) onOpenScopePicker?.();
              else onSetFavoriteScope(garnish.id, favorite ? null : "all");
            }}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.click(); }}
            aria-label={favorite ? "Quitar de favoritas" : "Añadir a favoritas"}
            style={{
              position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: "50%",
              border: "1.5px solid #fff", background: favorite ? "#e0405a" : "rgba(255,255,255,.92)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 1px 3px rgba(0,0,0,.2)", zIndex: 1,
            }}
          >
            <Heart size={11} color={favorite ? "#fff" : "#c9b8ae"} fill={favorite ? "#fff" : "none"} strokeWidth={2.4} />
          </span>
        )}
      </button>
      <span
        style={{
          fontSize: 11, fontWeight: 800, color: "#142f1d", textAlign: "center",
          lineHeight: 1.25, padding: "0 1px 2px",
        }}
      >
        {label}
      </span>
    </div>
  );
}

function NoGarnishPickCard({ selected, onSelect }) {
  const color = "#9ab0a1";
  return (
    <button
      type="button"
      onClick={onSelect}
      className="catalog-card-enter"
      style={{
        width: "100%", textAlign: "left", cursor: "pointer", fontFamily: "inherit",
        flexShrink: 0, borderRadius: 14, padding: 0,
        border: `1.5px solid ${selected ? "#bfe6cb" : "#eef3f0"}`,
        background: selected ? "#f2fbf5" : "#fff",
        transition: "border-color .15s ease, background .15s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 8 }}>
        <div
          style={{
            width: 52, height: 52, borderRadius: 12, flexShrink: 0,
            boxSizing: "border-box", border: `2.5px dashed ${color}`,
            background: "#f4f8f5", display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <Ban size={20} color={color} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 800, color: selected ? GREEN : "#142f1d", lineHeight: 1.25 }}>
            Sin guarnición
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 11, color: "#7a9485" }}>Solo el plato principal</p>
        </div>
        <span
          style={{
            width: 34, height: 34, borderRadius: 10, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: selected ? GREEN : "#eaf3ed", color: selected ? "#fff" : GREEN,
          }}
        >
          {selected ? <Check size={18} /> : <Plus size={18} />}
        </span>
      </div>
    </button>
  );
}

function GarnishPickCard({
  recipe, selected, onSelect, favorite, onSetFavoriteScope, hasScopeChoice, onOpenScopePicker,
  discarded, onDiscard, onRecover, animDelay = 0,
}) {
  const color = categoryColor(recipe.category);
  const photo = dishImageForRecipe(recipe);

  return (
    <div
      className="catalog-card-enter"
      style={{
        flexShrink: 0, borderRadius: 14,
        border: `1.5px solid ${selected ? "#bfe6cb" : "#eef3f0"}`,
        background: selected ? "#f2fbf5" : "#fff",
        transition: "border-color .15s ease, background .15s ease",
        animationDelay: `${animDelay}ms`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 8 }}>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <div
            style={{
              width: 52, height: 52, borderRadius: 12, overflow: "hidden",
              boxSizing: "border-box", border: `2.5px solid ${color}`,
              background: `${color}14`, display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            {photo ? (
              <img src={deckImg(photo, 104)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <Salad size={22} color={color} />
            )}
          </div>
          {onSetFavoriteScope && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (hasScopeChoice) onOpenScopePicker?.();
                else onSetFavoriteScope(recipe.id, favorite ? null : "all");
              }}
              aria-label={favorite ? "Quitar de favoritas" : "Añadir a favoritas"}
              title={favorite ? "Quitar de favoritas" : "Añadir a favoritas"}
              style={{
                position: "absolute", top: -6, right: -6,
                width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                border: "2px solid #fff", cursor: "pointer",
                background: favorite ? "#e0405a" : "#fff",
                boxShadow: "0 1px 4px rgba(0,0,0,.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all .15s ease", zIndex: 1,
              }}
            >
              <Heart
                size={11}
                color={favorite ? "#fff" : "#c9b8ae"}
                strokeWidth={2.4}
                fill={favorite ? "#fff" : "none"}
              />
            </button>
          )}
          {(onDiscard || onRecover) && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); discarded ? onRecover?.() : onDiscard?.(); }}
              aria-label={discarded ? `Recuperar ${recipe.name}` : `Descartar ${recipe.name}`}
              title={discarded ? "Recuperar (vuelve al catálogo)" : "Descartar (No me gusta)"}
              style={{
                position: "absolute", bottom: -6, right: -6,
                width: 22, height: 22, borderRadius: "50%", flexShrink: 0, cursor: "pointer",
                border: "2px solid #fff",
                background: discarded ? "#c0392b" : "#fff",
                color: discarded ? "#fff" : "#c9adb0",
                boxShadow: "0 1px 4px rgba(0,0,0,.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all .15s ease", zIndex: 1,
              }}
            >
              {discarded ? <RotateCcw size={11} /> : <Ban size={11} />}
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onSelect}
          style={{
            flex: 1, minWidth: 0, display: "block",
            padding: 0, border: "none", background: "transparent",
            cursor: "pointer", fontFamily: "inherit", textAlign: "left",
          }}
        >
          <p
            style={{
              margin: 0, fontSize: 13.5, fontWeight: 800, color: "#142f1d", lineHeight: 1.25,
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
            }}
          >
            {recipe.name}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 800, color }}>{categoryLabel(recipe.category)}</span>
            {favorite && (
              <span style={{ fontSize: 10, fontWeight: 800, color: GREEN, background: "#eaf6ee", padding: "2px 6px", borderRadius: 6 }}>
                Favorita
              </span>
            )}
            {recipe.time != null && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: "#7a9485" }}>
                <Clock size={11} /> {recipe.time} min
              </span>
            )}
            {recipe.kcal != null && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: "#7a9485" }}>
                <Flame size={11} /> {recipe.kcal} kcal
              </span>
            )}
          </div>
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            onClick={onSelect}
            aria-label={selected ? `Quitar ${recipe.name}` : `Elegir ${recipe.name}`}
            style={{
              width: 34, height: 34, borderRadius: 10, flexShrink: 0, cursor: "pointer",
              border: "none", background: selected ? GREEN : "#eaf3ed", color: selected ? "#fff" : GREEN,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            {selected ? <Check size={18} /> : <Plus size={18} />}
          </button>
          <RecipeProvenance recipe={recipe} />
        </div>
      </div>
    </div>
  );
}


// ── Carpetas (dentro de "Mis recetas") ───────────────────────────────────────

/**
 * Carpeta como tile del grid de 2 columnas, con la misma silueta que una
 * tarjeta de receta (cuadrada, esquinas iguales) para que se lea como "un
 * plato más" — solo que sin foto, con icono sobre color.
 */
function FolderTile({ label, Icon, img, count, onClick, onDelete, muted = false }) {
  const accent = muted ? "#8aa294" : GREEN;
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = Boolean(img) && !imgFailed;
  return (
    <div className="catalog-card-enter" style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <button
        type="button"
        onClick={onClick}
        aria-label={`Abrir carpeta ${label}`}
        style={{
          position: "relative", width: "100%", aspectRatio: "1 / 1",
          padding: 0, borderRadius: 14, overflow: "hidden", cursor: "pointer",
          border: showImg ? "none" : `1.5px dashed ${accent}44`,
          background: showImg ? "#f4f7f5" : `${accent}0f`,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8,
          fontFamily: "inherit",
        }}
      >
        {showImg ? (
          <>
            <img
              src={img}
              alt=""
              loading="lazy"
              onError={() => setImgFailed(true)}
              style={{
                position: "absolute", inset: 0, width: "100%", height: "100%",
                objectFit: "cover", filter: muted ? "grayscale(.55)" : "none",
              }}
            />
            {/* El conteo va sobre la foto, así que necesita su propio fondo
                para leerse igual sobre una imagen clara o una oscura. */}
            <span
              style={{
                position: "absolute", bottom: 6, left: 6,
                padding: "2px 8px", borderRadius: 999,
                background: "rgba(255,255,255,.92)", color: accent,
                fontSize: 13, fontWeight: 900, lineHeight: 1.5,
                boxShadow: "0 1px 3px rgba(0,0,0,.18)",
              }}
            >
              {count}
            </span>
          </>
        ) : (
          <>
            <Icon size={30} color={accent} strokeWidth={1.9} />
            <span style={{ fontSize: 19, fontWeight: 900, color: accent, lineHeight: 1 }}>{count}</span>
          </>
        )}
        {onDelete && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.click(); }}
            aria-label={`Borrar carpeta ${label}`}
            style={{
              position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: "50%",
              border: "1.5px solid #fff", background: "rgba(255,255,255,.92)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 1px 3px rgba(0,0,0,.18)",
            }}
          >
            <X size={11} color="#c0392b" strokeWidth={3} />
          </span>
        )}
      </button>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: "#142f1d", lineHeight: 1.25, minWidth: 0 }}>
        {label}
      </div>
    </div>
  );
}

function NewFolderTile({ onClick }) {
  return (
    <div className="catalog-card-enter" style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <button
        type="button"
        onClick={onClick}
        style={{
          width: "100%", aspectRatio: "1 / 1", padding: 0, borderRadius: 14, cursor: "pointer",
          border: `1.5px dashed ${GREEN}66`, background: "#fff",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8,
          fontFamily: "inherit",
        }}
      >
        <FolderPlus size={28} color={GREEN} strokeWidth={2} />
      </button>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: GREEN, lineHeight: 1.25 }}>Crear carpeta</div>
    </div>
  );
}

const newFolderChip = {
  display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
  padding: "6px 11px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit",
  border: `1.5px dashed ${GREEN}66`, background: "#fff", color: GREEN,
  fontSize: 12, fontWeight: 800, whiteSpace: "nowrap",
};

/** Diálogo mínimo de "¿cómo se llama la carpeta?". */
function NewFolderDialog({ onCreate, onClose }) {
  const [name, setName] = useState("");
  const trimmed = name.trim();
  return (
    <div
      onClick={onClose}
      className="mp-overlay-in"
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 320, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="mp-sheet-up"
        style={{ background: "#fff", borderRadius: 20, padding: 18, width: "100%", maxWidth: 340 }}
      >
        <div style={{ fontSize: 16, fontWeight: 900, color: "#142f1d" }}>Nueva carpeta</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "#42594c", marginTop: 4 }}>
          Para agrupar recetas a tu manera: «Cumpleaños», «Del abuelo»…
        </div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && trimmed) { onCreate(trimmed); onClose(); } }}
          placeholder="Nombre de la carpeta"
          maxLength={40}
          style={{
            width: "100%", boxSizing: "border-box", marginTop: 14,
            padding: "11px 12px", borderRadius: 12,
            border: "1.5px solid #d7e6dc", fontSize: 14, fontFamily: "inherit", color: "#142f1d",
          }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button type="button" onClick={onClose} style={{ flex: 1, padding: "11px", borderRadius: 12, border: "1.5px solid #d7e6dc", background: "#fff", color: "#42594c", fontSize: 13.5, fontWeight: 800, fontFamily: "inherit", cursor: "pointer" }}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={!trimmed}
            onClick={() => { onCreate(trimmed); onClose(); }}
            style={{ flex: 1, padding: "11px", borderRadius: 12, border: "none", background: trimmed ? GREEN : "#c2d2c8", color: "#fff", fontSize: 13.5, fontWeight: 800, fontFamily: "inherit", cursor: trimmed ? "pointer" : "default" }}
          >
            Crear
          </button>
        </div>
      </div>
    </div>
  );
}

/** Selector de carpetas de UNA receta: marca/desmarca y guarda al cerrar. */
export function FolderPickerSheet({ recipe, folders, current, onSave, onCreateFolder, onClose }) {
  const [picked, setPicked] = useState(() => new Set(current ?? []));
  const [creating, setCreating] = useState(false);
  const toggle = (id) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div
      onClick={onClose}
      className="mp-overlay-in"
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 300, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="mp-sheet-up"
        style={{ background: "#f5f9f6", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 420, maxHeight: "80dvh", display: "flex", flexDirection: "column", padding: 18, boxSizing: "border-box" }}
      >
        <div style={{ fontSize: 16, fontWeight: 900, color: "#142f1d" }}>Guardar en…</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "#42594c", marginTop: 3 }}>{recipe.name}</div>

        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
          {folders.map((f) => {
            const on = picked.has(f.id);
            const Icon = folderArt(f.id).Icon;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => toggle(f.id)}
                aria-pressed={on}
                style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%",
                  padding: "11px 12px", borderRadius: 14, cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                  border: `2px solid ${on ? GREEN : "#d7e6dc"}`, background: on ? "#eef6f0" : "#fff",
                }}
              >
                <Icon size={16} color={on ? GREEN : "#8aa294"} strokeWidth={2.4} />
                <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: "#142f1d" }}>{f.label}</span>
                {on && <Check size={15} color={GREEN} strokeWidth={3} />}
              </button>
            );
          })}
          {onCreateFolder && (
            <button type="button" onClick={() => setCreating(true)} style={{ ...newFolderChip, justifyContent: "center", padding: "11px 12px", borderRadius: 14 }}>
              <FolderPlus size={14} strokeWidth={2.6} /> Nueva carpeta
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => { onSave([...picked]); onClose(); }}
          style={{ marginTop: 14, padding: "13px", borderRadius: 14, border: "none", background: GREEN, color: "#fff", fontSize: 14, fontWeight: 800, fontFamily: "inherit", cursor: "pointer" }}
        >
          Guardar
        </button>

        {creating && (
          <NewFolderDialog
            onCreate={(name) => {
              const id = onCreateFolder(name);
              if (id) setPicked((prev) => new Set([...prev, id]));
            }}
            onClose={() => setCreating(false)}
          />
        )}
      </div>
    </div>
  );
}
