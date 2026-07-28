/* =========================================================================
   POST /api/lead
   -------------------------------------------------------------------------
   Único punto de escritura hacia la hoja de Google. La página nunca habla
   con Apps Script directamente: si lo hiciera, el secreto viviría en el JS
   del navegador y cualquiera podría inyectar filas.

   El navegador manda solo store_id / product_id / phone / utm. Los NOMBRES
   (store_name, product_name) se resuelven aquí contra catalog.js, no se
   confían al cliente — así la hoja nunca guarda un nombre inventado.

   Variables de entorno (Vercel → Settings → Environment Variables):
     SHEET_WEBHOOK_URL — URL /exec de la implementación de Apps Script
     SHEET_SECRET      — mismo valor que la constante SECRET del script
   ======================================================================== */

import { PRODUCTS, findStore, UTM_CAMPAIGN } from "../catalog.js";

const TIMEOUT_MS = 8000;
const INTENTOS = 3;
const INPUTS = [4, 8, 12];
const INPUT_DEFAULT = 8;

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

  // --- Validación -------------------------------------------------------
  const phone = String(body.phone || "").replace(/\D/g, "");
  if (phone.length !== 10) {
    return res.status(400).json({ ok: false, error: "phone_invalido" });
  }

  const store = findStore(body.store_id);
  if (!store) return res.status(400).json({ ok: false, error: "store_invalida" });

  const productId = String(body.product_id || "").trim();
  const product = PRODUCTS[productId];
  if (!product) return res.status(400).json({ ok: false, error: "product_invalido" });

  // Quincenas elegidas en el selector. Si llega algo fuera de la lista se cae
  // al default en vez de escribir basura en la hoja.
  const input = INPUTS.includes(Number(body.input)) ? Number(body.input) : INPUT_DEFAULT;

  // utm_source es texto libre que viene de la URL: se limpia antes de escribirlo.
  const utm_source = String(body.utm_source || "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, 120);

  const lead = {
    phone,
    store_id: store.code,
    store_name: store.name,
    product_id: productId,
    product_name: product.name,
    utm_source,
    // No se toma del cliente: identifica la variante de landing y se fija aquí.
    utm_campaign: UTM_CAMPAIGN,
    input,
  };

  // --- Escritura en la hoja --------------------------------------------
  let ultimoError = null;
  for (let intento = 1; intento <= INTENTOS; intento++) {
    try {
      const id = await escribirEnHoja(SHEET_WEBHOOK_URL, SHEET_SECRET, lead);
      return res.status(200).json({ ok: true, id });
    } catch (err) {
      ultimoError = err;
      if (intento < INTENTOS) await esperar(intento * 400);
    }
  }

  // Sin base de datos no hay a dónde reintentar después: el lead solo
  // sobrevive en los logs de Vercel. Se registra completo a propósito para
  // poder rescatarlo a mano. Ver README → "Riesgo asumido".
  console.error(
    "[lead] PERDIDO tras " + INTENTOS + " intentos:",
    JSON.stringify(lead),
    "causa:",
    ultimoError && ultimoError.message
  );
  return res.status(502).json({ ok: false, error: "sheet_no_disponible" });
}

async function escribirEnHoja(url, secret, lead) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: secret, ...lead }),
      signal: ctrl.signal,
      redirect: "follow", // Apps Script redirige a script.googleusercontent.com
    });

    const texto = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${texto.slice(0, 200)}`);

    const data = safeParse(texto);
    if (!data || !data.ok) {
      throw new Error(`respuesta inesperada: ${texto.slice(0, 200)}`);
    }
    return data.id;
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

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
