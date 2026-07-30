# t3b-vf-pdps

Páginas de producto por tienda con captura de teléfono. El lead se escribe en
una hoja privada de Google Sheets. **No hay base de datos.**

```
QR / campaña
   └─ /?store_id=3670&product_id=30742&utm_source=whatsapp
        └─ index.html   render del producto + precios de esa tienda
             │           sid = crypto.randomUUID()   ← amarra las dos escrituras
             ├─ al cargar:  POST /api/lead {action:"scan", sid}
             │                └─ Apps Script   abre la fila: id + scanned_at + contexto
             ├─ al enviar:  POST /api/lead {action:"submit", sid}
             │                └─ Apps Script   busca esa sesión y completa SU fila
             │                     └─ Hoja privada de Google
             └─ redirect → avafin.com.mx/tiendas?…   (solicitud del préstamo)
```

## Una fila por escaneo, no por lead

La fila se abre **al cargar la ficha**, no al enviar el teléfono. Así queda
medido el escaneo del QR aunque el cliente nunca deje sus datos, que es lo que
pasa la mayoría de las veces. Dos consecuencias al leer la hoja:

- Una fila con `scanned_at` y **sin** `submitted_at` es normal: alguien
  escaneó y se fue. El número de filas ya **no** es el número de leads;
  cuenta `submitted_at` no vacío.
- El orden de las filas es el de los **escaneos**. El último lead capturado
  no es la última fila; ordena por `submitted_at`.

### La sesión

Lo que amarra las dos escrituras es `session_id`: un `crypto.randomUUID()` que
genera **el navegador** al cargar la ficha y guarda en `sessionStorage`. Apps
Script busca la fila por ese valor.

Que lo genere el cliente es la decisión importante, y se llegó a ella por las
malas. La primera versión hacía que el servidor asignara el id secuencial y lo
devolviera firmado con HMAC; el envío tenía que **esperar esa respuesta** antes
de poder mandar nada. Apps Script serializa las escrituras y tarda segundos, así
que ese "espere un momento" se sentía, y cuando la respuesta no llegaba a tiempo
el envío se iba sin ticket y abría una fila suelta. Con el sid generado en el
navegador no hay nada que esperar. Y como un UUID trae 122 bits de azar, es
impredecible: hace de contraseña de su propia fila igual que hacía la firma, sin
firma.

### Nada espera respuesta

Ni el escaneo ni el envío leen lo que contesta el servidor. `report()` en
`index.html` usa `navigator.sendBeacon`: el navegador se hace cargo de entregar
el POST aunque la página ya se haya ido a avafin. El redirect ocurre en el mismo
instante en que se aprieta el botón.

Dejar a un cliente mirando una pantalla mientras se apunta una fila de
seguimiento es al revés de lo que importa. Si la escritura falla, el lead queda
en los logs de Vercel; ver "Riesgo asumido".

### Repetir no duplica

Apps Script resuelve todo por sesión, así que las dos escrituras son
idempotentes:

| Situación | Qué hace |
|---|---|
| Escaneo de una sesión que ya tiene fila | devuelve esa fila, no agrega |
| Envío sobre una fila con `submitted_at` | lo ignora y responde `ok` |
| Envío de una sesión sin fila | abre una completa, con `scanned_at` vacío |

Esto no es defensa teórica. `api/lead.js` aborta a los 15 s y reintenta, pero el
timeout corta **la espera, no la escritura**: al otro lado la fila puede haberse
escrito igual. Sin deduplicar, cada timeout dejaba una fila de más — que es
exactamente lo que se vio en producción, dos leads idénticos separados por
justo el valor del timeout.

Del lado del navegador, recargar o volver con "atrás" reusa el sid de
`sessionStorage`. Al enviar, en cambio, el sid **se rota**: si no, un segundo
envío desde la misma pestaña caería en la fila ya capturada y el candado de
`submitted_at` lo tiraría en silencio. Cuesta una fila de escaneo de más y a
cambio ningún envío se pierde.

## El redirect a avafin

El CTA registra el teléfono y enseguida manda al cliente a avafin, que es
donde realmente se solicita el crédito. La URL la arma `avafinUrl()` en
`catalog.js` con **exactamente los mismos parámetros** que `build_long_url()`
en `qrs/create_store_full_setup.py` — el `originalURL` que hay detrás de los
QR impresos:

```
https://www.avafin.com.mx/tiendas
  ?product_key=30742
  &product_name=Horno+de+Microondas+Panasonic+1.3+ft+   ← nombre crudo de avafin
  &product_cost=219900                                  ← centavos
  &loan_amount=191300                                   ← centavos; == cost si la tienda es sin-enganche
  &validity=172800
  &store_name=3670                                      ← el código, no el slug
```

> `product_name` es el nombre **que avafin tiene registrado**, no el que ve el
> cliente. Junto con `product_key` + `store_name` es lo que identifica el
> producto del otro lado; si no coincide, el redirect da error. Por eso vive en
> el campo `av` del catálogo, aparte de `name`, con sus erratas y espacios de
> más intactos.

Si cambias este contrato, hay que cambiarlo también en
`create_store_full_setup.py` o el tráfico web y el de los QR impresos dejarán
de apuntar al mismo lugar.

**El registro del lead no bloquea el redirect.** `api/lead.js` ya reintenta 3
veces y deja el lead en los logs si falla; dejar a un cliente sin poder
solicitar su crédito porque la hoja de cálculo se cayó sería peor que perder
una fila de seguimiento. El `fetch` va con `keepalive` para que sobreviva a la
navegación.

## Parámetros de la URL

| Parámetro | Obligatorio | Formato |
|---|---|---|
| `store_id` | sí | id oficial (`3670`) o nombre oficial (`PlazaExhibimex`), indistinto |
| `product_id` | sí | clave del producto (`30742`) |
| `utm_source` | no | texto libre, se recorta a 120 caracteres |

Si `store_id` o `product_id` no existen, la página muestra "Enlace no válido"
y no ofrece el formulario.

## Columnas de la hoja

`id · scanned_at · submitted_at · phone · phone_valid · store_id · store_name ·`
`product_id · product_name · utm_source · utm_campaign · user_input_1 ·`
`user_input_2 · session_id`

| Columna | De dónde sale |
|---|---|
| `id` | secuencial, lo asigna Apps Script (`L-000001`) |
| `scanned_at` | lo estampa Apps Script **al abrir la ficha**, zona horaria de la hoja |
| `submitted_at` | lo estampa Apps Script **al enviar el teléfono**. Vacío = escaneó y no envió |
| `phone` | del formulario, 10 dígitos |
| `phone_valid` | `Móvil` / `Fijo` / `Inválido`, contra el PNN del IFT (ver abajo) |
| `store_id` / `store_name` | de `store_id` en la URL, resuelto **en el servidor** |
| `product_id` / `product_name` | de `product_id` en la URL, resuelto **en el servidor** |
| `utm_source` | de `utm_source` en la URL; vacío si no viene |
| `utm_campaign` | fijo, identifica la variante de landing. Hoy `dangler_select_payment` |
| `user_input_1` | monto quincenal del botón elegido, en pesos (`810`), **recalculado en el servidor** |
| `user_input_2` | quincenas de ese botón: 4, 8 o 12 (default 8) |
| `session_id` | UUID que genera el navegador; es lo que amarra el escaneo con su envío |

`utm_campaign` **no se toma del navegador**: lo pone `api/lead.js` desde la
constante `UTM_CAMPAIGN` de `catalog.js`, para que no se pueda falsear desde
la URL. Cuando exista una segunda variante de landing, cada página declara la
suya.

`user_input_1` tampoco viaja desde el navegador. La página manda solo el
plazo y el servidor deriva el monto con `displayedPayment()` de `catalog.js`,
la misma función que pinta el botón: así la hoja no puede terminar con una
cifra que la página nunca mostró. Los dos campos van como **número**, para
poder sumarlos y promediarlos en la hoja.

La fila se llena en dos momentos: `id`, `session_id`, `scanned_at` y el
contexto (`store_*`, `product_*`, `utm_*`) los escribe el escaneo;
`submitted_at`, `phone`, `phone_valid` y los `user_input_*` los agrega el
envío sobre esa misma fila. El envío **nunca** reescribe lo del escaneo.

> Las columnas las crea `initSheet()`. No lo corras sobre una hoja con
> columnas propias de seguimiento: escribe los encabezados en las primeras
> `FIELDS.length` columnas y pisaría la primera de las tuyas; en ese caso
> agrégalas a mano. El orden no importa, cada campo se busca por nombre de
> encabezado.

Las columnas de seguimiento que agregues (estatus, notas, quién llamó) van
**a la derecha de éstas**, o sea a partir de la `O`. El script escribe buscando
cada campo por nombre de encabezado y omite los que no encuentra, así que
puedes reordenar columnas, insertarlas o quitarlas sin romper la inserción —
solo pierdes el dato de la que falte. Tres reglas para no romperla:

1. **No arrastres fórmulas hacia abajo** en columnas vacías. Usa
   `=ARRAYFORMULA(IF(A2:A="", "", …))` en la fila 1.
2. Aplica validación de datos y formato condicional a la **columna completa**
   (`O2:O`, no `O2:O500`) para que las filas nuevas los hereden.
3. **A la derecha, no en medio.** El script escribe el tramo de sus columnas
   de una sola vez —una llamada a Google en vez de trece, que es de donde
   salía buena parte de la lentitud—. Si detecta una columna ajena metida
   entre las suyas vuelve al modo celda por celda para no congelar tu
   fórmula en su resultado: sigue siendo correcto, solo más lento.

Un teléfono repetido genera un lead nuevo cada vez: es intencional, la hoja es
una bitácora. Para ver el número de contacto sin perder filas (`D` = `phone`,
`C` = `submitted_at`):

```
=ARRAYFORMULA(IF(D2:D="", "", COUNTIFS(D$2:D, D2:D, C$2:C, "<="&C2:C)))
```

Y la conversión escaneo → lead, que es lo que este cambio hace medible:

```
=COUNTA(C2:C) / COUNTA(B2:B)
```

## Validación del teléfono (`phone_valid`)

La página solo exige 10 dígitos. Además de eso, `api/lead.js` compara el número
contra el **Plan Nacional de Numeración** del IFT y escribe el resultado en la
hoja:

| Valor | Significa |
|---|---|
| `Móvil` | cae en un rango asignado como CPP o MPP |
| `Fijo` | cae en un rango asignado, pero de línea fija |
| `Inválido` | no cae en ningún rango asignado a ninguna operadora |

**No rechaza nada.** El lead entra igual y el juicio queda en la hoja, para
poder medir cuántos números malos llegan antes de decidir si vale la pena
bloquearlos en la página.

Dos límites que conviene tener presentes al leer la columna:

- El PNN dice que el bloque **está asignado a una operadora**, no que la línea
  exista o esté activa. Filtra tecleos y números inventados, no números
  apagados.
- La portabilidad no mueve un número de rango, así que `Móvil` / `Fijo` sigue
  siendo confiable; lo que ya no es confiable es la operadora, y por eso no se
  guarda.

### Actualizar el padrón

El IFT republica el archivo cada semana. El CSV crudo trae ~178,000 rangos y
pesa 15 MB, así que **no se commitea** (está en `.gitignore`): se compila a
`pnn-data.js`, que fusiona los rangos contiguos hasta dejar ~22,500 intervalos
delta-codificados, unos 270 KB.

```
# bajar el CSV a la raíz del proyecto desde
# https://sns.ift.org.mx:8081/sns-frontend/planes-numeracion/descarga-publica.xhtml
npm run build:pnn        # regenera pnn-data.js
```

`pnn.js` lo expande al arrancar (~7 ms una vez por instancia) y resuelve cada
consulta con dos búsquedas binarias (~65 ns). Frente al POST a Apps Script, que
tarda del orden de un segundo, el costo por lead es irrelevante.

## Configuración

### Google

1. Crear la hoja, privada, compartida solo con quien deba verla.
2. Extensiones → Apps Script → pegar `apps-script.gs`.
3. Poner el valor de `SECRET` en el script.
4. Ejecutar `initSheet()` una vez (crea la pestaña `Leads`, encabezados,
   formato de fecha y zona horaria).
5. Implementar → Nueva implementación → Aplicación web:
   *Ejecutar como:* **Yo** · *Quién tiene acceso:* **Cualquier persona**.
   Copiar la URL que termina en `/exec`.

> "Cualquier persona" publica **la URL del script, no la hoja**. Ese endpoint
> escribe filas y responde `{ok, id, row}`; no lee ni devuelve datos de la hoja.

### Hoja que ya tiene datos

`initSheet()` escribe encabezados **por posición** y te pisaría la primera
columna de seguimiento. Para migrar una hoja con datos corre `migrateSheet()`
una vez, desde el editor. Es idempotente y hace tres cosas:

- Renombra `created_at` → `submitted_at`. Solo cambia el rótulo: lo que esa
  columna guardaba era justo la hora del envío, así que los datos siguen
  siendo exactos.
- Inserta `scanned_at` antes de `submitted_at`. Queda **vacía** en las filas
  anteriores: de esos leads nunca se midió el escaneo, y rellenarla con la
  hora del envío falsearía el tiempo entre uno y otro. Vacío = fila anterior
  al cambio.
- Inserta `session_id` después de `user_input_2`, también vacía en lo
  anterior. Sin esta columna el escaneo y el envío no se pueden amarrar y
  cada uno abre su propia fila.
- Recorre las columnas de seguimiento a la derecha. Sus fórmulas se ajustan
  solas y el script las sigue ignorando.

Aunque no lo corras, el script escribe igual: `submitted_at` acepta
`created_at` como encabezado anterior (`LEGACY_HEADERS`). Lo que se perdería
es `scanned_at` y `session_id`, que quedan en el log de ejecuciones como
columnas faltantes — y sin `session_id` vuelven los renglones dobles.

> Al editar el script hay que crear una **nueva versión** de la implementación.
> Guardar no basta: la URL `/exec` seguiría sirviendo el código anterior.

### Vercel

Variables de entorno (Production y Preview):

| Variable | Valor |
|---|---|
| `SHEET_WEBHOOK_URL` | la URL `/exec` del paso 5 |
| `SHEET_SECRET` | el mismo valor que `SECRET` en el script |

Sin build step: estático + una función en `api/`.

## Imágenes

`landing/update_images.py` es el único camino para meter una foto al catálogo.
Normaliza a **JPEG sobre blanco, lienzo cuadrado, máx 800px**, y escribe en
`landing/img/{clave}.jpg`; de ahí hay que copiar a `pdp/img/` (las dos carpetas
se mantienen idénticas).

```
python3 landing/update_images.py 32275.jpg          # una vista
python3 landing/update_images.py --pair 27386 a.png b.jpg   # dos lado a lado
python3 landing/update_images.py --recheck          # audita y arregla img/*.jpg
```

El lienzo cuadrado no es cosmético: `.gallery .photo` dibuja la foto con ancho
fijo y `height: auto`, así que una foto vertical se renderiza mucho más alta que
el resto y empuja el precio fuera de la vista. El relleno blanco no se ve porque
la galería usa `mix-blend-mode: multiply`.

Para un producto muy vertical (un refri) una sola vista deja el cuadro casi
vacío a los lados; `--pair` acomoda dos vistas juntas, que suman un aspecto
cercano a 1.0 y llenan el cuadrado. Recorta el blanco de cada fuente antes de
escalar para que las dos salgan del mismo tamaño.

## Datos pendientes

`catalog.js` es el espejo de `PRODUCTS`/`STORES` en
`qrs/create_store_full_setup.py`. Falta:

- **Fotos de 2 productos** (`31618`, `31619`): falta
  `img/{clave}.jpg`, se muestra un placeholder con la categoría.
- **Fichas técnicas**: el mock muestra chips reales del producto (`1100 W`,
  `1.3 ft³ · 36.8 L`, `Negro espejo`). Solo `30742` los tiene cargados, en el
  campo `specs` del catálogo; para igualar el mock en los 26 productos hace
  falta esa hoja de especificaciones. La variante actual de la ficha **no
  dibuja chips** (ver abajo), así que `specs` está inactivo por ahora.
- **Carrusel**: el mock dibuja tres puntos de galería. Solo hay una foto por
  producto, así que se omiten en vez de fingir imágenes que no existen.

## Qué muestra esta variante de la ficha

Fuera: los chips de detalle (marca, categoría, `Disponible en {tienda}`) y el
bloque de precio completo —primer pago, enganche y total a pagar—. El markup y
el CSS se eliminaron de `index.html`; el modelo sigue entero en `catalog.js`
para poder restituirlos.

La única cifra que queda es el **pago quincenal**, y vive dentro del selector:
la pregunta es "¿Cuánto quieres pagar a la quincena?" y cada botón es el pago
de un plazo —12, 8 y 4 quincenas, en ese orden, del más chico al más grande—
redondeado **hacia arriba** a la decena, para que la cifra publicada nunca
quede por debajo de la que cobra avafin. El botón no dice el plazo: el monto
elegido se reporta en `user_input_1` y su plazo en `user_input_2`.

## El pago quincenal y el total no se capturan

Las cifras se **derivan** del monto financiado. No hay ningún número de
crédito escrito a mano en `catalog.js`:

```
préstamo    = cost − enganche        (= cost en Tetiz y Postes)
pago 1 (n)  = préstamo × (1/n + K × 21)      K = 0.007 × 1.16
total  (n)  = préstamo × (1 + K × (21 + 16 × (n−1)/2))
```

Con n = 12 eso da los factores 0.2538533 y 1.8850800. Salen del modelo de
`flows/endpoint.js` —capital = préstamo/n, interés = saldo insoluto × 0.7%
diario × días del periodo, IVA 16%— evaluado en **21 días al primer pago**. Se
verificó contra una tabla real de avafin (clave `30466`, préstamo 3,599, primer
pago 18/08/2026): las 12 filas cuadran con diferencia máxima de $0.09.

Los días al primer pago (`d1`) son lo único que cambia entre cotizaciones: son
los que hay entre el cálculo y la fecha que elige el cliente. Por eso el monto
del selector va redondeado hacia arriba a la decena: es una referencia, no la
carátula, y de ese lado el error nunca juega en contra del cliente.

> Antes estas cifras se capturaban a mano desde una hoja del negocio. Esa hoja
> venía de una corrida con `d1= 19`, así que **todo lo publicado estaba 6.8%
> por debajo** de lo que cobra avafin, con tres celdas peor todavía (`30995`
> −62%). Derivarlas es lo que evita que se vuelva a desfasar.

El factor queda ~$0.06 abajo del total de avafin, que redondea periodo por
periodo. Se acepta a cambio de tener una sola fórmula.

## Riesgo asumido

Sin base de datos, si Apps Script falla, el lead solo existe en los logs de
Vercel. `api/lead.js` reintenta 3 veces y, si aun así falla, escribe el lead
completo en el log con el prefijo `[lead] PERDIDO` para poder rescatarlo a
mano. Los logs de Vercel en plan Hobby se conservan poco tiempo: si esto llega
a pasar seguido, es la señal para mover la escritura a Postgres y dejar la hoja
como espejo.

El escaneo **no** reintenta: un intento y ya (`[lead] escaneo no registrado` en
el log si falla). El cliente no lee esa respuesta, y si la fila no se abrió el
envío la abre él solo. Lo único que se pierde es la medición del escaneo, no el
lead.

Ahora hay una escritura por escaneo, no por lead, y son bastantes más. Apps
Script las serializa todas con `LockService`, así que el cuello de botella está
ahí. Tres cosas lo sostienen, todas sobre el mismo principio de no volver a
preguntar lo que ya se sabe:

- `reserveRow()` cachea la siguiente fila y el siguiente id en
  `PropertiesService`, y valida con dos celdas. Antes se leía la columna `id`
  entera en cada escritura.
- `findRowBySid()` cachea sesión → fila en `CacheService` (6 h), y la confirma
  contra la celda antes de usarla.
- `writeFields()` escribe el tramo completo con un `setValues`. Eran trece
  llamadas a Google por fila.

Y como nadie del lado del cliente espera respuesta, la lentitud que quede es
invisible para quien escanea. Si aparecen respuestas `busy`, el efecto es
perder mediciones de escaneo, no leads.

## Desarrollo local

Sin dependencias y sin cuenta de Vercel. `dev-server.js` ejecuta el mismo
`api/lead.js` que se despliega.

**Modo stub** — no toca Google, imprime en la terminal la fila que escribiría:

```
npm run dev
open "http://localhost:3000/?store_id=3670&product_id=30742&utm_source=prueba"
```

**Modo real** — escribe en la hoja de verdad. Crea `.env.local` (ignorado por
git) y arranca:

```
SHEET_WEBHOOK_URL=https://script.google.com/macros/s/…/exec
SHEET_SECRET=el-mismo-secreto-del-script
```

```
npm run dev:real
```

URLs útiles para revisar los tres casos que se ven distinto:

| Caso | URL |
|---|---|
| Normal, con foto y precio | `/?store_id=3670&product_id=30742` |
| Sin foto (placeholder de categoría) | `/?store_id=3670&product_id=31619` |
| Tienda sin enganche | `/?store_id=Tetiz&product_id=30553` |
| Enlace roto | `/?store_id=9999&product_id=30742` |

En modo stub el servidor imprime cada petición. El stub guarda las filas en
memoria y deduplica por sesión igual que Apps Script, así que verás las dos
escrituras: al **abrir** la página, `escaneo → L-DEV-001 (fila 2)` con el
contexto y `scanned_at`; al **enviar**, `L-DEV-001 completada` con el teléfono
y `submitted_at` encima de la misma fila, y enseguida el redirect a avafin.

Para comprobar que repetir no duplica, manda la misma sesión dos veces:

```
SID=11111111-2222-3333-4444-555555555555
P='"store_id":"3670","product_id":"30742"'
for i in 1 2; do
  curl -s -X POST localhost:3000/api/lead -H 'content-type: application/json' \
    -d "{\"action\":\"scan\",\"sid\":\"$SID\",$P}"; echo
done
for i in 1 2; do
  curl -s -X POST localhost:3000/api/lead -H 'content-type: application/json' \
    -d "{\"action\":\"submit\",\"sid\":\"$SID\",\"phone\":\"5579768806\",\"user_input_2\":12,$P}"; echo
done
```

Las cuatro respuestas traen el **mismo** `id`, y en la terminal salen
`escaneo repetido` y `envío repetido … ignorado`. Una sola fila.

Para comprobar que las URLs de avafin siguen coincidiendo con las de los QR
impresos, compara contra el script que los genera:

```
python3 -c "
import ast
from urllib.parse import urlencode
t=ast.parse(open('../qrs/create_store_full_setup.py',encoding='utf-8').read())
g={n.targets[0].id: ast.literal_eval(n.value) for n in t.body
   if isinstance(n,ast.Assign) and getattr(n.targets[0],'id','') in
   ('PRODUCTS','STORES','SIN_ENGANCHE_CODES','VALIDITY')}
for c,_ in g['STORES']:
  for p in g['PRODUCTS']:
    l = p['cost'] if c in g['SIN_ENGANCHE_CODES'] else p['loan']
    print('https://www.avafin.com.mx/tiendas?'+urlencode({'product_key':p['key'],
      'product_name':p['name'],'product_cost':p['cost'],'loan_amount':l,
      'validity':g['VALIDITY'],'store_name':c}))" | sort > /tmp/a
node -e "import('./catalog.js').then(m=>console.log(m.STORES.flatMap(s=>
  Object.entries(m.PRODUCTS).map(([id,p])=>m.avafinUrl(id,p,s))).join('\n')))" | sort > /tmp/b
comm -23 /tmp/a /tmp/b   # vacío = ninguna URL del script cambió
```

`catalog.js` tiene 17 tiendas y el script todavía 9, así que el catálogo genera
más URLs de las que el script conoce; lo que importa es que **ninguna de las
del script falte**. La única excepción esperada hoy son las 26 de
`3330 SanBernabe2`, tienda que el padrón oficial no incluye (ahí es
`888 Sanbernabe`).
