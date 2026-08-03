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
     img        — false mientras no exista img/{clave}.jpg
     specs      — chips de ficha técnica del mock. Sin esto se cae a un chip
                  de marca y uno de categoría.
   ======================================================================== */

export const PRODUCTS = {
  "30553": { name: "Colchón Pillow Individual", category: "Colchones",
             cost: "139900", loan: "111900", av: "Colchón Pillow Ind" },

  "30552": { name: "Colchón Pillow Matrimonial", category: "Colchones",
             cost: "179900", loan: "143900", av: "Colchón Pillon Mat" },

  "30555": { name: "Colchón Individual en Caja", category: "Colchones",
             cost: "199900", loan: "169900", av: "Colchón Ind en Caja 17Cm 37 x 37 x 110 cms" },

  "30554": { name: "Colchón Matrimonial en Caja", category: "Colchones",
             cost: "259900", loan: "233900", av: "Colchón Mat en Caja 17Cm 37 x 37 x 110 cms" },

  "30782": { name: 'Asador Compact 18"', brand: "Weber", category: "Cocina",
             cost: "179900", loan: "143900", av: 'Asador Weber Compact 18"' },

  "30664": { name: "Batería 20 piezas", brand: "T-fal", category: "Cocina",
             cost: "199900", loan: "169900", av: "Batería  TFAL 20 piezas," },

  "30665": { name: "Batería 26 piezas", brand: "T-fal", category: "Cocina",
             cost: "179900", loan: "152900", av: "Batería TFAL 26 piezas" },

  "30690": { name: "Hidrolavadora K2 Horizontal", brand: "Kärcher", category: "Hogar",
             cost: "149900", loan: "119900", badge: "Más vendido",
             av: "Karcher K2 horizontal" },

  "30680": { name: 'Pantalla Smart 32" Roku', brand: "Hisense", category: "Pantallas",
             cost: "249900", loan: "224900", badge: "Más vendido",
             av: 'Pantalla Smart 32" Hisense Roku' },

  "30742": { name: "Horno de Microondas Panasonic 1.3 ft³ Negro", brand: "Panasonic", category: "Cocina",
             cost: "219900", loan: "191300", badge: "Más vendido",
             av: "Horno de Microondas Panasonic 1.3 ft ",
             specs: [{ icon: "bolt", text: "1100 W" },
                     { icon: "box", text: "1.3 ft³ · 36.8 L" },
                     { icon: "color", text: "Negro espejo" }] },

  "30743": { name: 'ONE BODY 15"', brand: "STF", category: "Cómputo",
             cost: "269900", loan: "229400", av: 'ONE BODY 15" STF' },

  "30688": { name: "Generador de Vapor Express Essential", brand: "T-fal", category: "Hogar",
             cost: "179900", loan: "152900", av: "Express Essential Blue" },

  "30744": { name: "Refrigerador 7.3 pies", brand: "White Westinghouse", category: "Línea blanca",
             cost: "659900", loan: "626900", av: "Refrigerador 7.3 pies White Westinghouse" },

  "27385": { name: "Lavadora Semiautomática 15 kg", brand: "White Westinghouse", category: "Línea blanca",
             cost: "399900", loan: "359900", av: "Lavadora Semiautomática White Westinghouse 15Kg" },

  "30466": { name: "Estufa 4 quemadores a gas", brand: "Acros", category: "Línea blanca",
             cost: "399900", loan: "359900", av: "Estufa Acros 4 quemadores a gas" },

  "29744": { name: "Bicicleta Eléctrica", category: "Transporte",
             cost: "599900", loan: "539900", badge: "Nuevo",
             av: "BICICLETA ELECTRICA" },

  "31007": { name: "Hielera con llantas 47 latas 57 L", brand: "Coleman", category: "Hogar",
             cost: "159900", loan: "143900", badge: "Nuevo",
             av: "HIELERA CON LLANTAS 47 LATAS 57L COLEMAN" },

  "31336": { name: 'Pantalla Smart 32"', brand: "Hisense", category: "Pantallas",
             cost: "249900", loan: "224900", badge: "Más vendido",
             av: 'PANTALLA HISENSE SMART 32"' },

  "30995": { name: "Freidora Digital 7.5 L", brand: "Oster", category: "Cocina",
             cost: "149900", loan: "134900", badge: "Nuevo",
             av: "FREIDORA DIGITAL 7.5L OSTER" },

  "30996": { name: "Asador Smokey Joe", brand: "Weber", category: "Cocina",
             cost: "159900", loan: "143900", badge: "Nuevo",
             av: "ASADOR WEBER SMOKEY JOE" },

  "31361": { name: "Multiestilizador 6 pzas", brand: "UNIQ", category: "Hogar",
             cost: "279900", loan: "251900", badge: "Nuevo",
             av: "MULTIESTILIZADOR UNIQ 6 PCS" },

  /* --- Pendientes: falta primer pago del negocio. Los dos primeros también
         siguen sin foto (img: false). Ver README. --- */

  "31618": { name: "Horno Microondas 1.5 ft³", category: "Cocina",
             cost: "249900", loan: "224900", img: false,
             av: "JUNS26 Horno Micro 1.5 CMKT" },

  "31619": { name: "Frigobar 1.7 Acero", category: "Línea blanca",
             cost: "199900", loan: "179900", img: false,
             av: "JUNS26 Frigobar 1.7 Acero" },

  "32275": { name: 'Pantalla 43" Roku Frameless', category: "Pantallas",
             cost: "369900", loan: "332900", badge: "Nuevo",
             av: 'Pantalla 43" JV Roku Frameless' },

  "32633": { name: "Curl Secret Rizador", category: "Hogar",
             cost: "159900", loan: "143900", badge: "Nuevo",
             av: "Curl Secret Rizador" },

  "27386": { name: "Refrigerador 7.3 pies WWH", brand: "White Westinghouse", category: "Línea blanca",
             cost: "449900", loan: "404900", badge: "Nuevo",
             av: "Refrigerador 7.3 pies WWH" },
};

/* -------------------------------------------------------------------------
   Padrón oficial de tiendas.

     code — id oficial; es lo que se manda a avafin como store_name
     slug — nombre oficial, sin espacios; es el prefijo de los short links
            de short.io y se acepta como store_id en la URL
     name — cómo se le muestra al cliente

   Ojo: create_store_full_setup.py todavía solo conoce 9 de estas 17, y una
   de las suyas —3330 SanBernabe2— no está en el padrón oficial (aquí es
   888 Sanbernabe). Hay que homologar ese script también.
   ---------------------------------------------------------------------- */
export const STORES = [
  { code: "3670", slug: "PlazaExhibimex",   name: "Plaza Exhibimex" },
  { code: "1931", slug: "Tetiz",            name: "Tetiz" },
  { code: "1955", slug: "Postes",           name: "Postes" },
  { code: "1960", slug: "Cisnes",           name: "Cisnes" },
  { code: "1869", slug: "Tulyehualco5",     name: "Tulyehualco 5" },
  { code: "3471", slug: "Queretaro",        name: "Querétaro" },
  { code: "2635", slug: "GaleanaNativitas", name: "Galeana Nativitas" },
  { code: "2918", slug: "CaminoReal3",      name: "Camino Real 3" },
  { code: "2613", slug: "TlahuacCentro",    name: "Tláhuac Centro" },
  { code: "3343", slug: "LaMonera",         name: "La Monera" },
  { code: "2145", slug: "AvMexicoLaCruz",   name: "Av. México La Cruz" },
  { code: "1129", slug: "Larondalla",       name: "La Rondalla" },
  { code: "2499", slug: "Tulyehualco6",     name: "Tulyehualco 6" },
  { code: "1322", slug: "LaTurba2",         name: "La Turba 2" },
  { code: "2758", slug: "Muyuguarda",       name: "Muyuguarda" },
  { code: "829",  slug: "Culhuacan",        name: "Culhuacán" },
  { code: "888",  slug: "Sanbernabe",       name: "San Bernabé" },
];

/* Tetiz y Postes no cobran enganche: allá loan_amount == product_cost. */
export const NO_DOWN_PAYMENT_STORES = new Set(["1931", "1955"]);

/* Constante de create_store_full_setup.py (segundos de vigencia del link). */
export const VALIDITY = "172800";

/* Identifica ESTA variante de landing en los reportes. No viene de la URL: lo
   pone el servidor, para que no se pueda falsear desde el navegador. Cuando
   exista una segunda variante, cada página deberá declarar la suya. */
export const UTM_CAMPAIGN = "dangler_select_payment";

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

export const cashPrice = (p) => Number(p.cost) / 100;

/* Monto que se financia. En las tiendas sin enganche se financia todo. */
export const loanAmount = (p, store) =>
  NO_DOWN_PAYMENT_STORES.has(store.code) ? p.cost : p.loan;

export const downPayment = (p, store) =>
  (Number(p.cost) - Number(loanAmount(p, store))) / 100;

/* -------------------------------------------------------------------------
   MODELO DE CRÉDITO
   -------------------------------------------------------------------------
   Mismo modelo que calcAmortizacion() en flows/endpoint.js: capital =
   préstamo/n, interés = saldo insoluto × 0.7% diario × días del periodo, IVA
   16% sobre el interés. Verificado 28-jul-2026 contra una tabla real de avafin
   (clave 30466, préstamo 3599, 12 parcialidades, primer pago 18/08/2026).

   Como el capital es fijo y el saldo baja parejo, las dos cifras publicadas
   son lineales en el préstamo y se reducen a un factor cada una:

     primer pago = préstamo × (1/n + K × d1)
     total       = préstamo × (1 + K × (d1 + PERIODO × (n−1)/2))

   d1 es lo único que cambia entre cotizaciones: son los días entre el cálculo
   y la fecha de primer pago que elige el cliente. Publicamos el escenario
   estándar (14 días, 12 quincenas) y el pie de página lo dice, porque el
   número real depende de cuándo y para qué fecha se cotice.

   d1 = 14 —no 21— desde el 3-ago-2026: es el offset que usa avafin de la
   aprobación al primer pago, el mismo FIRST_OFFSET_DAYS de flows/endpoint.js.
   Con 21 los tres botones salían inflados en préstamo × K × 7 (p. ej. +$230
   en la clave 27386), parejo en los tres plazos porque d1 solo pesa en el
   interés del primer periodo.

   El factor queda ~$0.06 por debajo del total que cobra avafin, que redondea
   periodo por periodo. Se acepta a cambio de tener una sola fórmula: la cifra
   es de referencia, no la carátula del crédito.
   ---------------------------------------------------------------------- */
export const DAILY_RATE = 0.007;
export const IVA_RATE = 0.16;
export const INSTALLMENTS = 12;
export const FIRST_PAYMENT_DAYS = 14;
export const PERIOD_DAYS = 16;

const K = DAILY_RATE * (1 + IVA_RATE);

/* Los factores dependen del plazo n. INSTALLMENTS (12) es el escenario que se
   publica por default; el selector de la ficha cotiza además 8 y 4. */
export const firstPaymentFactor = (n = INSTALLMENTS) => 1 / n + K * FIRST_PAYMENT_DAYS;
export const totalFactor = (n = INSTALLMENTS) =>
  1 + K * (FIRST_PAYMENT_DAYS + (PERIOD_DAYS * (n - 1)) / 2);

export const FIRST_PAYMENT_FACTOR = firstPaymentFactor();
export const TOTAL_FACTOR = totalFactor();

const round2 = (n) => Math.round(n * 100) / 100;

/* En las tiendas sin enganche loanAmount() ya devuelve el costo completo, así
   que las dos funciones sirven para los dos escenarios sin ramificar. */
export const firstPayment = (p, store, n = INSTALLMENTS) =>
  round2((Number(loanAmount(p, store)) / 100) * firstPaymentFactor(n));

export const totalPayment = (p, store, n = INSTALLMENTS) =>
  round2((Number(loanAmount(p, store)) / 100) * totalFactor(n));

/* La cifra tal como se publica en el selector: a la decena de ARRIBA, para
   que nunca quede por debajo de lo que cobra avafin. Vive aquí y no en la
   página porque api/lead.js la vuelve a calcular para escribirla en la hoja:
   si cada lado hiciera su propio redondeo, el lead podría no coincidir con
   el botón que tocó el cliente. */
export const displayedPayment = (p, store, n = INSTALLMENTS) =>
  Math.ceil(firstPayment(p, store, n) / 10) * 10;

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
