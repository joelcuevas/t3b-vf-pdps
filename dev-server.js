/* =========================================================================
   Servidor de desarrollo — sin dependencias, sin cuenta de Vercel
   -------------------------------------------------------------------------
     npm run dev     → http://localhost:3000

   Sirve los archivos estáticos y ejecuta api/lead.js igual que lo haría
   Vercel (mismo handler, mismo req/res), así que lo que pruebas aquí es el
   código que se va a desplegar.

   MODO STUB: si no hay SHEET_WEBHOOK_URL, el servidor levanta un receptor
   falso en /__stub y apunta el handler ahí. Puedes probar la página completa
   —validación, envío, pantalla de éxito, folio— antes de tocar Google. Los
   leads se imprimen en la terminal y no se guardan en ningún lado.

   MODO REAL: crea un archivo .env.local (está en .gitignore) con
       SHEET_WEBHOOK_URL=https://script.google.com/macros/s/…/exec
       SHEET_SECRET=el-mismo-secreto-del-script
   y arranca con  npm run dev:real  — escribe en tu hoja de verdad.
   ======================================================================== */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const PORT = process.env.PORT || 3000;
const ROOT = import.meta.dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const STUB = !process.env.SHEET_WEBHOOK_URL;
if (STUB) {
  process.env.SHEET_WEBHOOK_URL = `http://127.0.0.1:${PORT}/__stub`;
  process.env.SHEET_SECRET = "stub-secret";
}

const { default: leadHandler } = await import("./api/lead.js");

// El stub imita a la hoja: `scan` abre una fila, `submit` completa la que le
// digan. Guarda las filas en memoria para que se vea el mismo efecto que en
// Google — una fila por escaneo, no una por lead.
let stubN = 0;
const stubRows = new Map();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (!url.pathname.startsWith("/img/")) {
    console.log(`  ${req.method} ${req.url}`);
  }

  // --- Receptor falso que sustituye a Apps Script ------------------------
  if (url.pathname === "/__stub" && req.method === "POST") {
    const body = JSON.parse(await readBody(req));
    const { token, action, ...lead } = body;
    const sid = lead.session_id;

    // Misma regla que Apps Script: la sesión decide, y repetir no duplica.
    const previa = sid && [...stubRows].find(([, f]) => f.session_id === sid);
    if (previa) {
      const [id, fila] = previa;
      if (action === "scan") {
        console.log(`  ↳ [stub] escaneo repetido de ${sid}, ya es ${id}`);
        return respond(res, 200, { ok: true, id, row: fila.__row });
      }
      if (fila.submitted_at) {
        console.log(`  ↳ [stub] envío repetido sobre ${id}, ignorado`);
        return respond(res, 200, { ok: true, id, row: fila.__row, status: "already_submitted" });
      }
      Object.assign(fila, lead, { submitted_at: new Date() });
      console.log(`  ↳ [stub] ${id} completada (fila ${fila.__row})`, sinInternos(fila));
      return respond(res, 200, { ok: true, id, row: fila.__row });
    }

    const id = "L-DEV-" + String(++stubN).padStart(3, "0");
    const row = stubN + 1;
    const fila = action === "scan"
      ? { ...lead, scanned_at: new Date(), __row: row }
      : { ...lead, submitted_at: new Date(), __row: row };
    stubRows.set(id, fila);
    console.log(`  ↳ [stub] ${action === "scan" ? "escaneo" : "fila completa"} → ${id} (fila ${row})`, sinInternos(fila));
    return respond(res, 200, { ok: true, id, row });
  }

  // --- La función de Vercel ---------------------------------------------
  if (url.pathname === "/api/lead") {
    req.body = req.method === "POST" ? safeParse(await readBody(req)) : null;
    return leadHandler(req, adaptResponse(res));
  }

  // --- Estáticos ---------------------------------------------------------
  const rel = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "content-type": MIME[extname(filePath)] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404");
  }
});

server.listen(PORT, () => {
  const example = `http://localhost:${PORT}/?store_id=3670&product_id=30742&utm=prueba`;
  console.log(`\n  t3b-vf-pdps  ·  ${STUB ? "MODO STUB (no escribe en Google)" : "MODO REAL (escribe en tu hoja)"}`);
  console.log(`\n  ${example}\n`);
});

/* ---------------------------------------------------------------------- */

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d));
    req.on("error", reject);
  });
}

/* Le da a la respuesta de Node la forma que espera un handler de Vercel. */
function adaptResponse(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => respond(res, res.statusCode || 200, obj);
  return res;
}

function respond(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/* La fila que se imprime, sin la contabilidad interna del stub. */
function sinInternos(fila) {
  const { __row, ...resto } = fila;
  return resto;
}
