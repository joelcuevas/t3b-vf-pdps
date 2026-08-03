/* =========================================================================
   POST /api/lead
   -------------------------------------------------------------------------
   Único punto de escritura hacia la hoja de Google. La página nunca habla
   con Apps Script directamente: si lo hiciera, el secreto viviría en el JS
   del navegador y cualquiera podría inyectar filas.

   Dos acciones sobre la MISMA fila, amarradas por `sid`:

     action: "scan"    al abrir la ficha. Abre la fila con el contexto
                       (tienda, producto, utm) y la hora del escaneo.
     action: "submit"  al enviar el teléfono. Completa esa misma fila.

   `sid` lo genera el navegador con crypto.randomUUID(). Es impredecible, así
   que hace de contraseña de su propia fila: nadie puede completar la de otro.
   Antes esto era un id secuencial firmado con HMAC, lo que obligaba al
   cliente a ESPERAR la respuesta del escaneo antes de poder enviar — y esa
   respuesta puede tardar segundos. Generarlo en el navegador quita la espera
   y quita la firma.

   El navegador manda solo store_id / product_id / phone / utm. Los NOMBRES
   (store_name, product_name) se resuelven aquí contra catalog.js, no se
   confían al cliente — así la hoja nunca guarda un nombre inventado.

   Variables de entorno (Vercel → Settings → Environment Variables):
     SHEET_WEBHOOK_URL — URL /exec de la implementación de Apps Script
     SHEET_SECRET      — mismo valor que la constante SECRET del script
   ======================================================================== */

import { PRODUCTS, findStore, displayedPayment, UTM_CAMPAIGN } from "../catalog.js";
import { clasificar } from "../pnn.js";

// Apps Script serializa las escrituras con LockService y bajo carga tarda
// segundos. El timeout corta la ESPERA, no la escritura: al otro lado la fila
// puede haberse escrito igual. Por eso los reintentos solo son seguros ahora
// que Apps Script deduplica por sesión — antes, cada timeout dejaba una fila
// de más.
const TIMEOUT_MS = 15000;
const ATTEMPTS = 3;
const TERMS = [4, 8, 12];
const TERM_DEFAULT = 8;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const { SHEET_WEBHOOK_URL, SHEET_SECRET } = process.env;
  if (!SHEET_WEBHOOK_URL || !SHEET_SECRET) {
    console.error("[lead] faltan SHEET_WEBHOOK_URL o SHEET_SECRET");
    return res.status(500).json({ ok: false, error: "config" });
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};

  // El contexto del enlace se valida igual en las dos acciones: sin tienda o
  // sin producto no hay fila que abrir ni que completar.
  const store = findStore(body.store_id);
  if (!store) return res.status(400).json({ ok: false, error: "invalid_store" });

  const productId = String(body.product_id || "").trim();
  const product = PRODUCTS[productId];
  if (!product) return res.status(400).json({ ok: false, error: "invalid_product" });

  // Un UUID trae solo hex y guiones. Se recorta en vez de rechazarse: sin
  // sesión el lead entra igual, solo que como fila suelta.
  const session_id = String(body.sid || "").replace(/[^0-9a-zA-Z-]/g, "").slice(0, 64);

  // utm_source es texto libre que viene de la URL: se limpia antes de escribirlo.
  const utm_source = String(body.utm_source || "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, 120);

  const contexto = {
    session_id,
    store_id: store.code,
    store_name: store.name,
    product_id: productId,
    product_name: product.name,
    utm_source,
    // No se toma del cliente: identifica la variante de landing y se fija aquí.
    utm_campaign: UTM_CAMPAIGN,
  };

  // --- Escaneo ----------------------------------------------------------
  // Un intento y ya. El cliente no espera esta respuesta ni la lee: si no se
  // escribe, el envío abre la fila él solo. Reintentar solo alargaría una
  // función que a nadie le urge.
  if (body.action === "scan") {
    const bot = clasificarBot(req, body);

    // La razón NO va a la hoja —no hay columna para ella— pero sí al log de
    // Vercel, que es donde se revisa un veredicto que no cuadra y donde se
    // reafinan los pesos. Sin esto, "Bot" en la hoja sería un dictamen sin
    // manera de comprobarlo.
    if (bot.marca) {
      console.log(
        "[lead] escaneo marcado:", bot.marca,
        "| razones:", bot.razones.join(","),
        "| tienda:", store.code, "| producto:", productId,
        "| ua:", bot.ua || "(sin ua)"
      );
    }

    try {
      const r = await writeToSheet(SHEET_WEBHOOK_URL, SHEET_SECRET, {
        action: "scan",
        ...contexto,
        // Único campo del escaneo que no es contexto del enlace. En la fila de
        // un escaneo esta columna todavía no puede significar "teléfono
        // válido": no hay teléfono. Ver el bloque "¿Bot?" más abajo.
        phone_valid: bot.marca,
      });
      return res.status(200).json({ ok: true, id: r.id });
    } catch (err) {
      console.warn("[lead] escaneo no registrado:", err && err.message);
      return res.status(200).json({ ok: false, error: "scan_unavailable" });
    }
  }

  // --- Envío ------------------------------------------------------------
  const phone = String(body.phone || "").replace(/\D/g, "");
  if (phone.length !== 10) {
    return res.status(400).json({ ok: false, error: "invalid_phone" });
  }

  // Contra el Plan Nacional de Numeración: "Móvil", "Fijo" o "Inválido".
  // A propósito NO rechaza nada — el lead entra igual y el juicio queda en la
  // hoja, para poder medir cuántos números malos llegan antes de decidir si
  // vale la pena bloquearlos en la página.
  const phone_valid = clasificar(phone);

  // Quincenas elegidas en el selector. Si llega algo fuera de la lista se cae
  // al default en vez de escribir basura en la hoja.
  const enviado = Number(body.user_input_2);
  const user_input_2 = TERMS.includes(enviado) ? enviado : TERM_DEFAULT;

  // El monto NO se toma del cliente: se recalcula con la misma función que
  // pinta el botón, así la hoja no puede terminar con una cifra que la página
  // nunca mostró. Mismo criterio que store_name y product_name.
  const user_input_1 = displayedPayment(product, store, user_input_2);

  const lead = {
    action: "submit",
    ...contexto,
    phone,
    phone_valid,
    user_input_1, // monto quincenal del botón elegido, en pesos
    user_input_2, // quincenas de ese botón
  };

  // --- Escritura en la hoja --------------------------------------------
  let lastError = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const r = await writeToSheet(SHEET_WEBHOOK_URL, SHEET_SECRET, lead);
      return res.status(200).json({ ok: true, id: r.id });
    } catch (err) {
      lastError = err;
      if (attempt < ATTEMPTS) await wait(attempt * 400);
    }
  }

  // Sin base de datos no hay a dónde reintentar después: el lead solo
  // sobrevive en los logs de Vercel. Se registra completo a propósito para
  // poder rescatarlo a mano. Ver README → "Riesgo asumido".
  console.error(
    "[lead] PERDIDO tras " + ATTEMPTS + " intentos:",
    JSON.stringify(lead),
    "causa:",
    lastError && lastError.message
  );
  return res.status(502).json({ ok: false, error: "sheet_unavailable" });
}

/* ---- ¿Bot? -------------------------------------------------------------
   "Bot" aquí NO quiere decir malicioso. Quiere decir **esta apertura no es un
   cliente calificable**: nadie a quien se le pueda dar seguimiento, contar
   como escaneo de la campaña ni comparar contra las demás tiendas.

   Caen tres cosas distintas bajo la misma etiqueta, y da igual cuál sea:

     · programas — el preview de WhatsApp/Facebook cuando un vendedor comparte
       el link, monitores de uptime, escáneres, crawlers.
     · headless — automatización que se ve como Chrome normal hasta que se le
       pregunta por webdriver.
     · escritorio — alguien del equipo, de oficina o de sistemas abriendo el
       link desde una laptop. Perfectamente legítimo y aun así no es un
       cliente: el QR está pegado en el piso de venta y se escanea con la
       cámara de un teléfono. Una laptop nunca es un escaneo.

   Marca la fila; NUNCA la rechaza. El escaneo se escribe igual y el juicio
   queda en la hoja, mismo criterio que la clasificación del PNN: primero
   medir cuánto llega, y ya con el dato decidir si vale la pena filtrarlo.

   El veredicto se escribe en `phone_valid`, la columna que ya existe. En una
   fila de escaneo está vacía por definición —no hay teléfono que clasificar
   hasta que alguien envía el formulario— así que ahí cabe el juicio sobre
   quién abrió la ficha sin estorbarle a nada. Si esa persona después sí deja
   su número, el envío pisa la marca con "Móvil"/"Fijo"/"Inválido": la fila
   ya es un lead y de un lead lo que importa es si el número sirve.

   El piso está alto de entrada: esta ruta solo se alcanza desde el JS de la
   ficha (sendBeacon), así que un crawler que nada más hace GET a la URL corta
   jamás llega hasta aquí. La hoja ya está medio limpia por construcción y
   estas reglas son para lo que sí ejecuta JavaScript.

   Los pesos están para poder moverlos: la razón va completa al log de Vercel,
   así que se recalibra mirando escaneos reales en vez de adivinar.
   ---------------------------------------------------------------------- */

// Autodeclarados. Un bot honesto se anuncia en el user-agent y con eso basta.
const UA_BOT = /bot\b|crawler|spider|slurp|facebookexternalhit|whatsapp|telegram|slackbot|discord|twitterbot|linkedin|embedly|preview|headless|phantom|puppeteer|playwright|selenium|python-requests|curl\/|wget|axios|okhttp|java\/|go-http|lighthouse|pagespeed|gtmetrix|uptime|pingdom|monitor|scanner|semrush|ahrefs|screaming/i;

// Un teléfono siempre dice cuál es en el user-agent. Que no lo diga es la
// señal, no que diga "Windows".
const UA_MOVIL = /android|iphone|ipad|ipod|mobile|windows phone/i;

// Todo navegador de verdad —incluidos los de dentro de Facebook, Instagram o
// WhatsApp— arrastra "Mozilla" y "AppleWebKit" o "Gecko" por herencia
// histórica. Un user-agent que no dice ser un navegador no es una persona.
const UA_NAVEGADOR = /mozilla|applewebkit|gecko|opera|trident/i;

// Un teléfono de verdad no llega a esto ni de lejos. Una laptop lo pasa de
// una: es el ancho de una sola señal dura.
const CORTE = 75;

const SEÑALES = [
  /* Duras: cada una marca sola. */
  { peso: 100, razon: "ua_bot",       test: (s) => UA_BOT.test(s.ua) },
  { peso: 100, razon: "sin_ua",       test: (s) => !s.ua },
  { peso: 100, razon: "no_navegador", test: (s) => s.ua && !UA_NAVEGADOR.test(s.ua) },
  { peso: 100, razon: "webdriver",    test: (s) => s.wd === true },
  // Basta el user-agent, sin importar de quién sea la laptop ni desde dónde
  // entre: el QR se escanea con la cámara de un teléfono, así que una
  // apertura desde escritorio no es un escaneo y no hay caso en que lo sea.
  { peso: 100, razon: "escritorio",   test: (s) => s.ua && !UA_MOVIL.test(s.ua) },

  /* Blandas: hacen falta dos. Sirven para el escritorio que se disfraza de
     teléfono —un UA móvil se copia y pega, el hardware no— y para lo que el
     user-agent no alcanza a delatar solo. */
  // Un teléfono siempre reporta táctil. Un UA móvil sin táctil es emulación.
  { peso: 40,  razon: "sin_touch",    test: (s) => s.tp === false },
  { peso: 40,  razon: "sin_idioma",   test: (s) => !s.idioma },
  // Misma idea: ninguna pantalla de teléfono es tan ancha, ni acostada.
  { peso: 40,  razon: "pantalla_ancha", test: (s) => s.sw >= 1024 },
  // Solo no basta: hay VPN y hay roaming, y un falso positivo aquí borraría
  // un escaneo real. Con cualquier otra cosa al lado, sí.
  { peso: 45,  razon: "fuera_mx",     test: (s) => s.country && s.country !== "MX" },
];

function clasificarBot(req, body) {
  const h = req.headers || {};
  const ua = String(h["user-agent"] || "").slice(0, 400);

  const señas = {
    ua,
    idioma: String(h["accept-language"] || "").trim(),
    // Lo pone Vercel en el borde; el cliente no puede tocarlo. Vacío en local
    // y en algunos planes: vacío = sin señal, no = sospechoso.
    country: String(h["x-vercel-ip-country"] || "").trim().toUpperCase(),
    // Del navegador. Un bot podría mentir, pero entonces ya no es de los que
    // esto pretende cazar.
    wd: body.wd === true,
    // null cuando la página no logró medirlo (Safari privado, un try que se
    // cayó). null NO dispara `sin_touch`: no saber no es una señal.
    tp: typeof body.tp === "boolean" ? body.tp : null,
    sw: Number(body.sw) > 0 ? Number(body.sw) : 0,
  };

  let puntos = 0;
  const razones = [];
  for (const s of SEÑALES) {
    if (s.test(señas)) {
      puntos += s.peso;
      razones.push(s.razon);
    }
  }

  return {
    // Lo que se escribe en phone_valid: "Bot" o vacío, nada más. Vacío deja
    // la celda como estaba antes de todo esto, y quiere decir "esto sí se ve
    // como un cliente calificable".
    marca: puntos >= CORTE ? "Bot" : "",
    razones,
    ua,
  };
}

/* ---- Apps Script ------------------------------------------------------- */

async function writeToSheet(url, secret, payload) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: secret, ...payload }),
      signal: ctrl.signal,
      redirect: "follow", // Apps Script redirige a script.googleusercontent.com
    });

    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);

    const data = safeParse(text);
    if (!data || !data.ok) {
      throw new Error(`respuesta inesperada: ${text.slice(0, 200)}`);
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
