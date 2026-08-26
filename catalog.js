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
     av         — product_name que se manda a avafin. No es el nombre que se
                  muestra al cliente. Se forma normalizando la descripción de
                  la hoja fuente (mayúsculas/acentos correctos); avafin no
                  guarda un catálogo propio contra el cual emparejar, así que
                  no es una clave que deba coincidir con algo registrado del
                  otro lado. No lo "corrijas" sin necesidad — los productos
                  dados de alta antes del 13-ago-2026 quedaron como calco
                  literal de la hoja, erratas y espacios de más incluidos.
     name       — nombre que ve el cliente
     img        — false mientras no exista img/{clave}.jpg
     specs      — chips de ficha técnica del mock. Sin esto se cae a un chip
                  de marca y uno de categoría.
   ======================================================================== */

export const PRODUCTS = {
  "30553": { name: "Colchón Pillow Ind", category: "Colchones",
             cost: "139900", loan: "111900", av: "Colchón Pillow Ind" },

  "30552": { name: "Colchón Pillon Mat", category: "Colchones",
             cost: "179900", loan: "143900", av: "Colchón Pillon Mat" },

  "30555": { name: "Colchón Ind en Caja 17Cm 37 x 37 x 110 cms", category: "Colchones",
             cost: "199900", loan: "169900", av: "Colchón Ind en Caja 17Cm 37 x 37 x 110 cms" },

  "30554": { name: "Colchón Mat en Caja 17Cm 37 x 37 x 110 cms", category: "Colchones",
             cost: "259900", loan: "233900", av: "Colchón Mat en Caja 17Cm 37 x 37 x 110 cms" },

  "30782": { name: 'Asador Weber Compact 18"', brand: "Weber", category: "Cocina",
             cost: "179900", loan: "143900", av: 'Asador Weber Compact 18"' },

  "30664": { name: "Batería  TFAL 20 piezas,", brand: "T-fal", category: "Cocina",
             cost: "199900", loan: "169900", av: "Batería  TFAL 20 piezas," },

  "30665": { name: "Batería TFAL 26 piezas", brand: "T-fal", category: "Cocina",
             cost: "179900", loan: "152900", av: "Batería TFAL 26 piezas" },

  "30690": { name: "Karcher K2 horizontal", brand: "Kärcher", category: "Hogar",
             cost: "149900", loan: "119900", badge: "Más vendido",
             av: "Karcher K2 horizontal" },

  "30680": { name: 'Pantalla Smart 32" Hisense Roku', brand: "Hisense", category: "Pantallas",
             cost: "249900", loan: "224900", badge: "Más vendido",
             av: 'Pantalla Smart 32" Hisense Roku' },

  "30742": { name: "Horno de Microondas Panasonic 1.3 ft", brand: "Panasonic", category: "Cocina",
             cost: "219900", loan: "191300", badge: "Más vendido",
             av: "Horno de Microondas Panasonic 1.3 ft ",
             specs: [{ icon: "bolt", text: "1100 W" },
                     { icon: "box", text: "1.3 ft³ · 36.8 L" },
                     { icon: "color", text: "Negro espejo" }] },

  "30743": { name: 'BOCINA ONE BODY 15" STF', brand: "STF", category: "Cómputo",
             cost: "269900", loan: "229400", av: 'ONE BODY 15" STF' },

  "30688": { name: "PLANCHA Express Essential Blue", brand: "T-fal", category: "Hogar",
             cost: "179900", loan: "152900", av: "Express Essential Blue" },

  "30744": { name: "Refrigerador 7.3 pies White Westinghouse", brand: "White Westinghouse", category: "Línea blanca",
             cost: "659900", loan: "626900", av: "Refrigerador 7.3 pies White Westinghouse" },

  "27385": { name: "Lavadora Semiautomática White Westinghouse 15Kg", brand: "White Westinghouse", category: "Línea blanca",
             cost: "399900", loan: "359900", av: "Lavadora Semiautomática White Westinghouse 15Kg" },

  "30466": { name: "Estufa Acros 4 quemadores a gas", brand: "Acros", category: "Línea blanca",
             cost: "399900", loan: "359900", av: "Estufa Acros 4 quemadores a gas" },

  "29744": { name: "BICICLETA ELECTRICA", category: "Transporte",
             cost: "599900", loan: "539900", badge: "Nuevo",
             av: "BICICLETA ELECTRICA" },

  "31007": { name: "HIELERA CON LLANTAS 47 LATAS 57L COLEMAN", brand: "Coleman", category: "Hogar",
             cost: "159900", loan: "143900", badge: "Nuevo",
             av: "HIELERA CON LLANTAS 47 LATAS 57L COLEMAN" },

  "31336": { name: 'PANTALLA HISENSE SMART 32"', brand: "Hisense", category: "Pantallas",
             cost: "249900", loan: "224900", badge: "Más vendido",
             av: 'PANTALLA HISENSE SMART 32"' },

  "30995": { name: "FREIDORA DIGITAL 7.5L OSTER", brand: "Oster", category: "Cocina",
             cost: "149900", loan: "134900", badge: "Nuevo",
             av: "FREIDORA DIGITAL 7.5L OSTER" },

  "30996": { name: "ASADOR WEBER SMOKEY JOE", brand: "Weber", category: "Cocina",
             cost: "159900", loan: "143900", badge: "Nuevo",
             av: "ASADOR WEBER SMOKEY JOE" },

  "31361": { name: "MULTIESTILIZADOR UNIQ 6 PCS", brand: "UNIQ", category: "Hogar",
             cost: "279900", loan: "251900", badge: "Nuevo",
             av: "MULTIESTILIZADOR UNIQ 6 PCS" },

  /* --- Pendientes: falta primer pago del negocio. Ver README. --- */

  "31618": { name: "Horno de Microondas 1.5 White-Westinghouse", category: "Cocina",
             cost: "249900", loan: "224900",
             av: "JUNS26 Horno Micro 1.5 CMKT" },

  /* Mismo cost/loan que 33196 y misma descripción ("Frigobar 1.7 Acero" vs
     "Frigobar 1.7 CuFt Acero Inox") — es el mismo modelo (Magic Chef
     HMAR17STM, Home Depot México) cargado en dos altas distintas. Reusa la
     foto de 33196 mientras no haya una propia. */
  "31619": { name: "Frigobar 1.7 Acero Inox JVC", category: "Línea blanca",
             cost: "199900", loan: "179900",
             av: "JUNS26 Frigobar 1.7 Acero" },

  "32275": { name: "43'' JV Roku Frameless", category: "Pantallas",
             cost: "369900", loan: "332900", badge: "Nuevo",
             av: 'Pantalla 43" JV Roku Frameless' },

  "32633": { name: "Curl secret rizador", category: "Hogar",
             cost: "159900", loan: "143900", badge: "Nuevo",
             av: "Curl Secret Rizador" },

  "27386": { name: "Refrigerador 7.3 pies wwh ", brand: "White Westinghouse", category: "Línea blanca",
             cost: "449900", loan: "404900", badge: "Nuevo",
             av: "Refrigerador 7.3 pies WWH" },

  /* --- Nuevos 13-ago-2026. "av" es tentativo (mismo contrato que arriba).
         loan = cost − (10% de cost redondeado hacia arriba a la decena de
         peso más cercana), regla del owner. "Lavadora Doble Tina 15 KGS" de
         la misma hoja se omite: clave PENDIENTE en avafin. Imágenes
         sourced de la web el 13-ago-2026 — ver reporte de esa fecha para
         cuáles son match exacto vs. aproximación genérica. --- */
  "32954": { name: "Regulador de voltaje para refrigeradores y lavadoras", category: "Hogar",
             cost: "129900", loan: "116900", badge: "Nuevo",
             av: "Regulador de Voltaje para Refrigeradores y Lavadoras" },

  "33020": { name: 'UNIBODY PORTATIL TWS TRIPLE 8"', brand: "Misik", category: "Audio",
             cost: "129900", loan: "116900", badge: "Nuevo",
             av: 'Bocina Unibody Portátil TWS Triple 8"' },

  "33102": { name: "HORNO DE MICROONDAS 1.0", category: "Cocina",
             cost: "189900", loan: "170900", badge: "Nuevo",
             av: "Horno de Microondas 1.0" },

  "33018": { name: "HIDROLAVADORA K PORTATIL", brand: "Kärcher", category: "Hogar",
             cost: "129900", loan: "116900", badge: "Nuevo",
             av: "Hidrolavadora K Portátil" },

  "33195": { name: "Refrigerador 7.3 pies despachador de agua ", category: "Línea blanca",
             cost: "499900", loan: "449900", badge: "Nuevo",
             av: "Refrigerador 7.3 Pies Despachador de Agua" },

  "33196": { name: "Frigobar 1.7 cuft acero inox", category: "Línea blanca",
             cost: "199900", loan: "179900", badge: "Nuevo",
             av: "Frigobar 1.7 CuFt Acero Inox" },

  "32561": { name: "JVC 40'' Roku Framless ", brand: "JVC", category: "Pantallas",
             cost: "349900", loan: "314900", badge: "Nuevo",
             av: 'JVC 40" Roku Frameless' },

  "36681": { name: "MINI ELIPTICA ELECTRICA C/RC FUNCION DE ESCALADORA ", category: "Fitness",
             cost: "169900", loan: "152900", badge: "Nuevo",
             av: "Mini Elíptica Eléctrica C/RC Función de Escaladora" },

  "36682": { name: "BICICLETA FIJA  SPORTE PARA SMARTPHONE RUEDA DE INERCIA 8KG ", category: "Fitness",
             cost: "289900", loan: "260900", badge: "Nuevo",
             av: "Bicicleta Fija con Soporte para Smartphone y Rueda de Inercia" },

  "36683": { name: "CAMINADORA ELECTRICA C/RC", category: "Fitness",
             cost: "249900", loan: "224900", badge: "Nuevo",
             av: "Caminadora Eléctrica C/RC" },

  /* --- Nuevos 24-ago-2026, homologados desde "18082026 - articulos Venta
         Financiada.xlsx" (hoja Calculos Enganche, fuente de verdad). Sin
         imagen todavía (img/{clave}.jpg no existe, cae a placeholder). --- */
  "33277": { name: "T-fal Batería de Cocina Supercook Titanium 23 Piezas, Antiadherente Reforzado con Titanio", brand: "T-fal", category: "Cocina",
             cost: "179900", loan: "152900", badge: "Nuevo",
             av: "Batería T-fal Supercook Titanium 23 Piezas" },

  "33417": { name: "HORNO MICROONDAS WESTING HOUSE 1.5FT ", brand: "White Westinghouse", category: "Cocina",
             cost: "279900", loan: "251900", badge: "Nuevo",
             av: "Horno de Microondas Westinghouse 1.5 ft" },

  "33248": { name: "LAVADORA DOBLE TINA 15 KGS", category: "Línea blanca",
             cost: "449900", loan: "404900", badge: "Nuevo",
             av: "Lavadora Doble Tina 15 KGS" },

  /* --- Nuevos 25-ago-2026, homologados desde "25082026 - articulos Venta
         Financiada.xlsx" (hoja Calculos Enganche, fuente de verdad). Sin
         imagen todavía (img/{clave}.jpg no existe, cae a placeholder).
         category inferida (el excel no trae columna de categoría) — revisar. --- */
  "33348": { name: "Licuadora Wave", category: "Cocina",
             cost: "69900", loan: "64900", badge: "Nuevo",
             av: "Licuadora Wave" },

  "32330": { name: "Licuadora roja 800w", category: "Cocina",
             cost: "55900", loan: "50900", badge: "Nuevo",
             av: "Licuadora roja 800w" },

  "33103": { name: "HORNO DE MICROONDAS 0.9", category: "Cocina",
             cost: "174900", loan: "147900", badge: "Nuevo",
             av: "Horno de Microondas 0.9" },

  "33360": { name: "ASPIRADORA 3 EN 1 LUCKY", category: "Hogar",
             cost: "59900", loan: "54900", badge: "Nuevo",
             av: "Aspiradora 3 en 1 Lucky" },

  "32963": { name: "Plancha Elegance Led Titan Keratin Bvt", category: "Hogar",
             cost: "59900", loan: "54900", badge: "Nuevo",
             av: "Plancha Elegance Led Titan Keratin Bvt" },

  "32964": { name: "Cepillo H Mod  Avocado Power Brush 3D 110", category: "Hogar",
             cost: "69900", loan: "64900", badge: "Nuevo",
             av: "Cepillo H Mod Avocado Power Brush 3D 110" },

  "32965": { name: "Máquina cortadora ", category: "Hogar",
             cost: "59900", loan: "54900", badge: "Nuevo",
             av: "Máquina cortadora" },

  "33021": { name: "Licuadora Portatil de doble aspa", category: "Cocina",
             cost: "59900", loan: "54900", badge: "Nuevo",
             av: "Licuadora Portatil de doble aspa" },

  "33422": { name: "Procesador de alimentos ", category: "Cocina",
             cost: "55900", loan: "50900", badge: "Nuevo",
             av: "Procesador de alimentos" },

  "33423": { name: "Batidora de pedestal RCA", brand: "RCA", category: "Cocina",
             cost: "59900", loan: "54900", badge: "Nuevo",
             av: "Batidora de pedestal RCA" },

  "33425": { name: "Refrigerador mini RCA", brand: "RCA", category: "Línea blanca",
             cost: "119900", loan: "107900", badge: "Nuevo",
             av: "Refrigerador mini RCA" },

  "33491": { name: "Parrilla Hibrida", category: "Cocina",
             cost: "69900", loan: "64900", badge: "Nuevo",
             av: "Parrilla Hibrida" },
};

/* -------------------------------------------------------------------------
   Padrón oficial de tiendas.

     code — id oficial; es lo que se manda a avafin como store_name
     slug — nombre oficial, sin espacios; es el prefijo de los short links
            de short.io y se acepta como store_id en la URL
     name — cómo se le muestra al cliente

   Ojo: create_store_full_setup.py homologó las 16 con enganche/sin-enganche
   confirmado el 13-ago-2026 (falta 888 Sanbernabe, que no tiene tabla de
   enganche confirmada). Ese script además tiene 3330 SanBernabe2, que no
   está en este padrón — no homologado.
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

/* Tiendas sin enganche: allá loan_amount == product_cost. Tetiz/Postes desde
   siempre; las otras 6 agregadas 13-ago-2026 según la tabla de enganche del
   owner (columna "Enganche" = NO). Espejo de SIN_ENGANCHE_CODES en
   qrs/create_store_full_setup.py. */
export const NO_DOWN_PAYMENT_STORES = new Set([
  "1931", "1955", "2145", "1129", "3343", "1322", "2758", "829",
]);

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
   16% sobre el interés.

   Como el capital es fijo y el saldo baja parejo, las dos cifras publicadas
   son lineales en el préstamo y se reducen a un factor cada una:

     primer pago = préstamo × (1/n + K × d1)
     total       = préstamo × (1 + K × (d1 + PERIODO × (n−1)/2))

   d1 = 16 (25-ago-2026, decisión del owner: usar el dato duro del excel como
   fuente para todo). El excel ("Calculos Enganche" del xlsx raíz) trae sus
   propias columnas PRIMER PAGO / TOTAL A PAGAR ya calculadas para n=12;
   verificado que esta fórmula con d1=16 las reproduce EXACTO (a nivel de
   precisión de punto flotante, las 39 filas) — por eso d1=16 y no un valor
   independiente. El PDP también cotiza n=8 y n=4 (selector de plazos), para
   los que el excel no trae columna — no queda otra que extender la misma
   fórmula ya calibrada contra el excel, ver [[primerpago-vs-amortizacion]].

   Nota histórica: antes (3-ago a 24-ago-2026) usaba d1=14, verificado 28-jul
   contra una tabla real de avafin (clave 30466) — ese valor NO coincide con
   las columnas del excel (implica d1=16). El owner priorizó el dato duro del
   excel sobre la verificación de avafin.
   ---------------------------------------------------------------------- */
export const DAILY_RATE = 0.007;
export const IVA_RATE = 0.16;
export const INSTALLMENTS = 12;
export const FIRST_PAYMENT_DAYS = 16;
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
