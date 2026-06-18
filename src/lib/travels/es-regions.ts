/**
 * Deterministic Spanish city/town → autonomous community map.
 *
 * Detecting a *domestic* trip means comparing a payment's region against the
 * user's home region, so we can't depend on a (often weak, local) LLM getting
 * every town right — a single miss on the home city silently disables all
 * domestic detection. Spanish communities are stable facts, so we resolve the
 * common cases here and fall back to the LLM only for towns not listed.
 *
 * Region labels match the fixed list used in the LLM prompt
 * (`locations.ts` → ES_COMMUNITIES) so cached and static values compare equal.
 * Keys are normalized via `cityKey` (lowercase, single-spaced).
 */
import { cityKey } from "./parse-location";

const M = "Madrid";
const PV = "País Vasco";
const CAT = "Cataluña";
const CV = "Comunidad Valenciana";
const AND = "Andalucía";
const GAL = "Galicia";
const ARA = "Aragón";
const CLM = "Castilla-La Mancha";
const CYL = "Castilla y León";
const AST = "Asturias";
const CANT = "Cantabria";
const NAV = "Navarra";
const RIO = "La Rioja";
const MUR = "Región de Murcia";
const EXT = "Extremadura";
const BAL = "Islas Baleares";
const CAN = "Canarias";

/** city (normalized) → autonomous community. */
const CITY_REGION: Record<string, string> = {
  // ── Comunidad de Madrid ──────────────────────────────────────────────
  madrid: M,
  alcorcon: M,
  mostoles: M,
  fuenlabrada: M,
  leganes: M,
  getafe: M,
  alcobendas: M,
  "alcala de henares": M,
  "san sebastian de los reyes": M,
  pozuelo: "Madrid",
  "pozuelo de alarcon": M,
  "las rozas": M,
  "torrejon de ardoz": M,
  parla: M,
  coslada: M,
  valdemoro: M,
  "rivas vaciamadrid": M,
  majadahonda: M,
  "collado villalba": M,
  aranjuez: M,
  "arganda del rey": M,
  boadilla: M,
  "boadilla del monte": M,
  pinto: M,
  "colmenar viejo": M,
  "tres cantos": M,
  "san fernando de henares": M,
  galapagar: M,
  villaviciosa: M,
  navalcarnero: M,
  // ── País Vasco ───────────────────────────────────────────────────────
  bilbao: PV,
  donostia: PV,
  "donostia san": PV,
  "donostia-san": PV,
  "donostia/san": PV,
  "san sebastian": PV,
  vitoria: PV,
  "vitoria-gasteiz": PV,
  barakaldo: PV,
  getxo: PV,
  irun: PV,
  errenteria: PV,
  urnieta: PV,
  eibar: PV,
  basauri: PV,
  gipuzkoa: PV,
  guipuzcoa: PV,
  hondarribia: PV,
  tolosa: PV,
  // ── Cataluña ─────────────────────────────────────────────────────────
  barcelona: CAT,
  hospitalet: CAT,
  "l'hospitalet": CAT,
  badalona: CAT,
  terrassa: CAT,
  sabadell: CAT,
  tarragona: CAT,
  lleida: CAT,
  girona: CAT,
  mataro: CAT,
  reus: CAT,
  "sant cugat": CAT,
  manresa: CAT,
  "sant joan despi": CAT,
  "s j desvern": CAT,
  sitges: CAT,
  figueres: CAT,
  // ── Comunidad Valenciana ─────────────────────────────────────────────
  valencia: CV,
  alicante: CV,
  elche: CV,
  castellon: CV,
  "castellon de la plana": CV,
  torrevieja: CV,
  gandia: CV,
  alzira: CV,
  paterna: CV,
  benidorm: CV,
  denia: CV,
  orihuela: CV,
  sagunto: CV,
  ontinyent: CV,
  xativa: CV,
  // ── Andalucía ────────────────────────────────────────────────────────
  sevilla: AND,
  malaga: AND,
  cordoba: AND,
  granada: AND,
  jerez: AND,
  "jerez de la frontera": AND,
  almeria: AND,
  huelva: AND,
  cadiz: AND,
  jaen: AND,
  marbella: AND,
  "dos hermanas": AND,
  fuengirola: AND,
  osuna: AND,
  ronda: AND,
  estepona: AND,
  torremolinos: AND,
  benalmadena: AND,
  mijas: AND,
  motril: AND,
  // ── Galicia ──────────────────────────────────────────────────────────
  santiago: GAL,
  "santiago de compostela": GAL,
  "a coruna": GAL,
  coruna: GAL,
  vigo: GAL,
  ourense: GAL,
  lugo: GAL,
  pontevedra: GAL,
  ferrol: GAL,
  sarria: GAL,
  "santiago de comp": GAL,
  sanxenxo: GAL,
  vilagarcia: GAL,
  // ── Aragón ───────────────────────────────────────────────────────────
  zaragoza: ARA,
  huesca: ARA,
  teruel: ARA,
  pedrola: ARA,
  calatayud: ARA,
  // ── Castilla-La Mancha ───────────────────────────────────────────────
  toledo: CLM,
  albacete: CLM,
  "ciudad real": CLM,
  cuenca: CLM,
  guadalajara: CLM,
  talavera: CLM,
  almansa: CLM,
  puertollano: CLM,
  // ── Castilla y León ──────────────────────────────────────────────────
  valladolid: CYL,
  leon: CYL,
  burgos: CYL,
  salamanca: CYL,
  palencia: CYL,
  zamora: CYL,
  avila: CYL,
  segovia: CYL,
  soria: CYL,
  ponferrada: CYL,
  // ── Asturias ─────────────────────────────────────────────────────────
  oviedo: AST,
  gijon: AST,
  aviles: AST,
  // ── Cantabria ────────────────────────────────────────────────────────
  santander: CANT,
  torrelavega: CANT,
  // ── Navarra ──────────────────────────────────────────────────────────
  pamplona: NAV,
  tudela: NAV,
  iruna: NAV,
  // ── La Rioja ─────────────────────────────────────────────────────────
  logrono: RIO,
  calahorra: RIO,
  // ── Región de Murcia ─────────────────────────────────────────────────
  murcia: MUR,
  cartagena: MUR,
  lorca: MUR,
  molina: MUR,
  // ── Extremadura ──────────────────────────────────────────────────────
  badajoz: EXT,
  caceres: EXT,
  merida: EXT,
  plasencia: EXT,
  // ── Islas Baleares ───────────────────────────────────────────────────
  palma: BAL,
  "palma de mallorca": BAL,
  ibiza: BAL,
  eivissa: BAL,
  manacor: BAL,
  // ── Canarias ─────────────────────────────────────────────────────────
  "las palmas": CAN,
  "santa cruz de tenerife": CAN,
  "la laguna": CAN,
  telde: CAN,
  arona: CAN,
  arrecife: CAN,
};

/**
 * Autonomous community for a Spanish city/town, or null when unknown (the LLM
 * fallback then handles it). Accent-insensitive on the lookup key so "Córdoba"
 * and "Cordoba" both resolve.
 */
export function esRegion(city: string | null | undefined): string | null {
  if (!city) return null;
  const key = cityKey(city);
  if (CITY_REGION[key]) return CITY_REGION[key];
  // Retry without diacritics (descriptions are usually unaccented already).
  const noAccent = key.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return CITY_REGION[noAccent] ?? null;
}
