/* =========================================================================
   CATÁLOGO COMPARTIDO
   -------------------------------------------------------------------------
   Lo consume index.html (render y armado del link de avafin) y api/lead.js
   (resolución de nombres). Una sola fuente para los dos.

   Espejo de PRODUCTS/STORES en qrs/create_store_full_setup.py. Los montos
   viven en CENTAVOS y como string, igual que allá, porque son los que se
   mandan tal cual en la URL de avafin. Los pesos se derivan (ver helpers al
   final) para no tener dos copias del mismo número que se puedan desfasar.

     cost       — product_cost en centavos  → precio de contado
     loan       — loan_amount con-enganche en centavos
                  enganche = (cost − loan) / 100
     av         — product_name EXACTO que espera avafin. No es el nombre que
                  se muestra: avafin lo usa para identificar el producto junto
                  con product_key + store_name. Si no coincide, el redirect
                  da error. No lo "corrijas" aunque tenga erratas o espacios
                  de más — así está registrado del otro lado.
     name       — nombre que ve el cliente
     primerPago — primer pago quincenal en PESOS, escenario CON enganche,
                  según la lista del negocio. null = pendiente; la página no
                  inventa una cifra.
     img        — false mientras no exista img/{clave}.jpg
     specs      — chips de ficha técnica del mock. Sin esto se cae a un chip
                  de marca y uno de categoría.
   ======================================================================== */

export const PRODUCTS = {
  "30553": { name: "Colchón Pillow Individual", cat: "Colchones",
             cost: "139900", loan: "111900", primerPago: 265.88,
             av: "Colchón Pillow Ind" },

  "30552": { name: "Colchón Pillow Matrimonial", cat: "Colchones",
             cost: "179900", loan: "143900", primerPago: 341.91,
             av: "Colchón Pillon Mat" },

  "30555": { name: "Colchón Individual en Caja", cat: "Colchones",
             cost: "199900", loan: "169900", primerPago: 403.70,
             av: "Colchón Ind en Caja 17Cm 37 x 37 x 110 cms" },

  "30554": { name: "Colchón Matrimonial en Caja", cat: "Colchones",
             cost: "259900", loan: "233900", primerPago: 555.77,
             av: "Colchón Mat en Caja 17Cm 37 x 37 x 110 cms" },

  "30782": { name: 'Asador Compact 18"', brand: "Weber", cat: "Cocina",
             cost: "179900", loan: "143900", primerPago: 341.91,
             av: 'Asador Weber Compact 18"' },

  "30664": { name: "Batería 20 piezas", brand: "T-fal", cat: "Cocina",
             cost: "199900", loan: "169900", primerPago: 403.70,
             av: "Batería  TFAL 20 piezas," },

  "30665": { name: "Batería 26 piezas", brand: "T-fal", cat: "Cocina",
             cost: "179900", loan: "152900", primerPago: 363.30,
             av: "Batería TFAL 26 piezas" },

  "30690": { name: "Hidrolavadora K2 Horizontal", brand: "Kärcher", cat: "Hogar",
             cost: "149900", loan: "119900", primerPago: 293.98, badge: "Más vendido",
             av: "Karcher K2 horizontal" },

  "30680": { name: 'Pantalla Smart 32" Roku', brand: "Hisense", cat: "Pantallas",
             cost: "249900", loan: "224900", primerPago: 534.38, badge: "Más vendido",
             av: 'Pantalla Smart 32" Hisense Roku' },

  "30742": { name: "Horno de Microondas Panasonic 1.3 ft³ Negro", brand: "Panasonic", cat: "Cocina",
             cost: "219900", loan: "191300", primerPago: 454.54, badge: "Más vendido",
             av: "Horno de Microondas Panasonic 1.3 ft ",
             specs: [{ icono: "rayo", texto: "1100 W" },
                     { icono: "caja", texto: "1.3 ft³ · 36.8 L" },
                     { icono: "color", texto: "Negro espejo" }] },

  "30743": { name: 'ONE BODY 15"', brand: "STF", cat: "Cómputo",
             cost: "269900", loan: "229400", primerPago: 545.07,
             av: 'ONE BODY 15" STF' },

  "30688": { name: "Generador de Vapor Express Essential", brand: "T-fal", cat: "Hogar",
             cost: "179900", loan: "152900", primerPago: 363.30,
             av: "Express Essential Blue" },

  "30744": { name: "Refrigerador 7.3 pies", brand: "White Westinghouse", cat: "Línea blanca",
             cost: "659900", loan: "626900", primerPago: 1489.59,
             av: "Refrigerador 7.3 pies White Westinghouse" },

  "27385": { name: "Lavadora Semiautomática 15 kg", brand: "White Westinghouse", cat: "Línea blanca",
             cost: "399900", loan: "359900", primerPago: 855.16,
             av: "Lavadora Semiautomática White Westinghouse 15Kg" },

  "30466": { name: "Estufa 4 quemadores a gas", brand: "Acros", cat: "Línea blanca",
             cost: "399900", loan: "359900", primerPago: 855.16,
             av: "Estufa Acros 4 quemadores a gas" },

  "29744": { name: "Bicicleta Eléctrica", cat: "Transporte",
             cost: "599900", loan: "539900", primerPago: 1282.86, badge: "Nuevo",
             av: "BICICLETA ELECTRICA" },

  "31007": { name: "Hielera con llantas 47 latas 57 L", brand: "Coleman", cat: "Hogar",
             cost: "159900", loan: "143900", primerPago: 341.91, badge: "Nuevo",
             av: "HIELERA CON LLANTAS 47 LATAS 57L COLEMAN" },

  "31336": { name: 'Pantalla Smart 32"', brand: "Hisense", cat: "Pantallas",
             cost: "249900", loan: "224900", primerPago: 534.38, badge: "Más vendido",
             av: 'PANTALLA HISENSE SMART 32"' },

  "30995": { name: "Freidora Digital 7.5 L", brand: "Oster", cat: "Cocina",
             cost: "149900", loan: "134900", primerPago: 210.53, badge: "Nuevo",
             av: "FREIDORA DIGITAL 7.5L OSTER" },

  "30996": { name: "Asador Smokey Joe", brand: "Weber", cat: "Cocina",
             cost: "159900", loan: "143900", primerPago: 341.91, badge: "Nuevo",
             av: "ASADOR WEBER SMOKEY JOE" },

  "31361": { name: "Multiestilizador 6 pzas", brand: "UNIQ", cat: "Hogar",
             cost: "279900", loan: "251900", primerPago: 598.54, badge: "Nuevo",
             av: "MULTIESTILIZADOR UNIQ 6 PCS" },

  /* --- Pendientes: falta primer pago del negocio y falta foto. Ver README. --- */

  "31618": { name: "Horno Microondas 1.5 ft³", cat: "Cocina",
             cost: "249900", loan: "224900", primerPago: null, img: false,
             av: "JUNS26 Horno Micro 1.5 CMKT" },

  "31619": { name: "Frigobar 1.7 Acero", cat: "Línea blanca",
             cost: "199900", loan: "179900", primerPago: null, img: false,
             av: "JUNS26 Frigobar 1.7 Acero" },

  "32275": { name: 'Pantalla 43" Roku Frameless', cat: "Pantallas",
             cost: "369900", loan: "332900", primerPago: null, img: false, badge: "Nuevo",
             av: 'Pantalla 43" JV Roku Frameless' },

  "32633": { name: "Curl Secret Rizador", cat: "Hogar",
             cost: "159900", loan: "143900", primerPago: null, img: false, badge: "Nuevo",
             av: "Curl Secret Rizador" },

  "27386": { name: "Refrigerador 7.3 pies WWH", brand: "White Westinghouse", cat: "Línea blanca",
             cost: "449900", loan: "404900", primerPago: null, img: false, badge: "Nuevo",
             av: "Refrigerador 7.3 pies WWH" },
};

/* Espejo de STORES en create_store_full_setup.py. */
export const STORES = [
  { code: "3670", slug: "PlazaExhibimex",   name: "Exhibimex" },
  { code: "1869", slug: "Tulyehualco5",     name: "Tulyehualco 5" },
  { code: "1960", slug: "Cisnes",           name: "Cisnes" },
  { code: "3330", slug: "SanBernabe2",      name: "San Bernabé 2" },
  { code: "1931", slug: "Tetiz",            name: "Tetiz" },
  { code: "3471", slug: "Queretaro",        name: "Querétaro" },
  { code: "1955", slug: "Postes",           name: "Postes" },
  { code: "2635", slug: "GaleanaNativitas", name: "Galeana Nativitas" },
];

/* Tetiz y Postes no cobran enganche: allá loan_amount == product_cost. */
export const SIN_ENGANCHE = new Set(["1931", "1955"]);

/* Constante de create_store_full_setup.py (segundos de vigencia del link). */
export const VALIDITY = "172800";

/* Identifica ESTA variante de landing en los reportes. No viene de la URL: lo
   pone el servidor, para que no se pueda falsear desde el navegador. Cuando
   exista una segunda variante, cada página deberá declarar la suya. */
export const UTM_CAMPAIGN = "landing_installements";

export const AVAFIN_BASE = "https://www.avafin.com.mx/tiendas";

/* store_id llega como código numérico ("3670") o como slug ("PlazaExhibimex"),
   porque los QR impresos usan el slug. Se acepta cualquiera de los dos. */
export function findStore(raw) {
  const v = String(raw || "").trim();
  if (!v) return null;
  return (
    STORES.find((s) => s.code === v || s.slug.toLowerCase() === v.toLowerCase()) || null
  );
}

/* ---- Derivados de cost/loan, en pesos ---- */

export const contado = (p) => Number(p.cost) / 100;

/* Monto que se financia. En las tiendas sin enganche se financia todo. */
export const loanAmount = (p, store) =>
  SIN_ENGANCHE.has(store.code) ? p.cost : p.loan;

export const enganche = (p, store) =>
  (Number(p.cost) - Number(loanAmount(p, store))) / 100;

/* -------------------------------------------------------------------------
   URL de avafin — mismo formato y mismos parámetros que build_long_url() en
   qrs/create_store_full_setup.py, que es el originalURL detrás de los QR
   impresos. Cualquier cambio aquí tiene que hacerse también allá, o el
   tráfico web y el de tienda dejarán de apuntar al mismo lugar.
   ---------------------------------------------------------------------- */
export function avafinUrl(productId, p, store) {
  const params = new URLSearchParams({
    product_key: productId,
    product_name: p.av,
    product_cost: p.cost,
    loan_amount: loanAmount(p, store),
    validity: VALIDITY,
    store_name: store.code,
  });
  return `${AVAFIN_BASE}?${params}`;
}
