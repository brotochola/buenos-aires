// Reexporta un barrio con el editor y hornea su atlas: lo mismo que abrir el editor, tocar 📦 Exportar, descomprimir el zip sobre la
// carpeta y correr hornear_atlas.js y barrios.js, pero sin manos. Para rehacer un barrio después de cambiar el exportador.
// Con el juego servido (python3 servir.py o lo que haya): node herramientas/reexportar.js <barrio|carabobo|parquechas> [--opción …]
//   --url http://127.0.0.1:8010   dónde está servido (por defecto, ese)
//   --sin-atlas                   no hornea el atlas: deja el barrio con META.atlas apagado (el juego lo arma al cargar)
//   --sal <carpeta>               escribe el barrio exportado ahí y no toca el del juego; sirve para ver qué cambiaría
//   --con-ventana                 muestra el navegador
//   --knob <clave>=<valor>        cambia un knob antes de exportar (se puede repetir); queda guardado en el meta.json nuevo.
//                                 Por ejemplo --knob ffBinario=1 para los flowfields en binario
// La semilla y los knobs salen del meta.json del barrio, que los guarda al exportar: se abre el editor con esos mismos valores, así que
// sale el mismo barrio salvo lo que haya cambiado en el código del editor. Al final dice qué archivos cambiaron y cuánto tardó.
const fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const { playwright } = require('./playwright.js'), { hornear } = require('./hornear_atlas.js');
const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; }, hay = (k) => args.includes('--' + k);
const KNOBS = args.flatMap((a, i) => a === '--knob' && i + 1 < args.length ? [args[i + 1]] : []);
const DIR = args[0], R = path.join(__dirname, '..'), URL0 = arg('url', 'http://127.0.0.1:8010').replace(/\/$/, ''), SAL = arg('sal', null);
const seg = (t0) => ((Date.now() - t0) / 1000).toFixed(0) + ' s';

// el zip del exportador (zip sin compresión o deflate, sin extras): [[nombre, Buffer]]
function leerZip(b) {
  const out = []; let p = 0;
  while (p + 30 <= b.length && b.readUInt32LE(p) === 0x04034b50) {
    const m = b.readUInt16LE(p + 8), size = b.readUInt32LE(p + 18), n = b.readUInt16LE(p + 26), x = b.readUInt16LE(p + 28);
    const nombre = b.toString('utf8', p + 30, p + 30 + n), crudo = b.subarray(p + 30 + n + x, p + 30 + n + x + size);
    out.push([nombre, m === 8 ? zlib.inflateRawSync(crudo) : Buffer.from(crudo)]); p += 30 + n + x + size;
  }
  return out;
}
const huella = (b) => crypto.createHash('sha1').update(b).digest('hex');
// lo que cambia siempre al exportar y no es un cambio: la fecha de meta y la marca del atlas (la pone hornear_atlas.js)
function sinFecha(nombre, b) {
  if (!/^meta\.js(on)?$/.test(nombre)) return b;
  return Buffer.from(b.toString('utf8').replace(/"fecha":"[^"]*",?/, '').replace(/"atlas":true,?/, '').replace(/,\}/, '}'));
}

(async () => {
  if (!['barrio', 'carabobo', 'parquechas'].includes(DIR)) { console.log('uso: node herramientas/reexportar.js <barrio|carabobo|parquechas> [--url …] [--sin-atlas] [--sal carpeta] [--con-ventana] [--knob clave=valor]'); process.exit(1); }
  try { await fetch(URL0 + '/editor/index.html'); } catch (e) { throw new Error('no hay nada servido en ' + URL0 + ': levantá el juego o pasá --url'); }
  const B = path.join(R, DIR), meta = JSON.parse(fs.readFileSync(path.join(B, 'meta.json'), 'utf8')), t0 = Date.now();
  if (!meta.seed || !meta.knobs) throw new Error(DIR + '/meta.json no trae la semilla o los knobs');
  for (const kv of KNOBS) { const [k, v] = kv.split('='); if (!k || v === undefined || v === '' || !isFinite(+v)) throw new Error('--knob ' + kv + ': va clave=número');
    console.log(`knob ${k}: ${meta.knobs[k]} → ${+v}`); meta.knobs[k] = +v; }
  // el Chromium de Playwright, sin placa, y no el Chrome instalado: con ese se exportaron los barrios y sale igual byte a byte. Con Chrome
  // cambian arboles.png y props.png (miles de píxeles de borde, casi todos por poco)
  const b = await playwright().chromium.launch({ headless: !hay('con-ventana'), args: ['--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 760 } }), p = await ctx.newPage();
  const errores = []; p.on('pageerror', e => errores.push(String(e))); p.on('console', m => { if (m.type() === 'error') errores.push(m.text()); });
  await ctx.addInitScript((k) => localStorage.setItem('editor_barrios_cfg', k), JSON.stringify(meta.knobs));
  await p.goto(`${URL0}/editor/index.html?semilla=${meta.seed}`);
  await p.waitForFunction(() => window.__ready || document.getElementById('err')?.textContent, null, { timeout: 300000 });
  const dif = await p.evaluate(([k, s]) => ({ err: document.getElementById('err')?.textContent, seed: window.__editor?.seed === s, knobs: Object.keys({ ...k, ...CFG.v }).filter(n => k[n] !== CFG.v[n]), carpeta: window.__editor?.barrio?.W.carpeta }), [meta.knobs, meta.seed]);
  if (dif.err) throw new Error('el editor no arrancó: ' + dif.err);
  if (!dif.seed) throw new Error('el editor no tomó la semilla ' + meta.seed);
  if (dif.carpeta !== DIR) throw new Error(`el editor armó ${dif.carpeta}, no ${DIR}`);
  if (dif.knobs.length) console.log('ojo, knobs que no están en el meta.json o cambiaron de valor:', dif.knobs.join(', '));
  console.log(`editor listo en ${seg(t0)} (${DIR}, semilla ${meta.seed})`);
  const t1 = Date.now(), bajada = p.waitForEvent('download', { timeout: 1800000 });
  await p.evaluate(() => document.getElementById('bExp').click());
  // el avance del editor, y si dice que no pudo, no hay descarga que esperar
  let ultimo = '', reloj; const fallo = new Promise((_, no) => { reloj = setInterval(async () => { try { const t = await p.evaluate(() => document.getElementById('load').textContent);
    if (t !== ultimo) console.log('  ' + (ultimo = t)); if (/^no se pudo/.test(t)) no(new Error(t)); } catch (e) { /* la página está ocupada */ } }, 2000); });
  const d = await Promise.race([bajada, fallo]); clearInterval(reloj);
  const trozos = []; for await (const c of await d.createReadStream()) trozos.push(c);
  const archivos = leerZip(Buffer.concat(trozos)); await b.close();
  console.log(`exportado en ${seg(t1)}: ${archivos.length} archivos, ${(trozos.reduce((a, c) => a + c.length, 0) / 1048576).toFixed(0)} MB de zip`);
  if (errores.length) console.log('errores en el editor:\n' + errores.slice(0, 6).join('\n'));

  // desempaquetar sobre la carpeta (o en --sal) y contar qué cambió contra lo que había
  const dest = SAL ? path.resolve(SAL) : B, iguales = [], cambiaron = [], nuevos = [];
  for (const [nombre, data] of archivos) {
    const rel = nombre.replace(/^[^/]+\//, ''), viejo = path.join(B, rel), f = path.join(dest, rel);
    if (!fs.existsSync(viejo)) nuevos.push(rel);
    else { const v = fs.readFileSync(viejo); (huella(sinFecha(rel, v)) === huella(sinFecha(rel, data)) ? iguales : cambiaron).push(`${rel} (${v.length} → ${data.length})`); }
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data);
  }
  // una hoja que ya no hace falta (menos hojas de caras que antes) no puede quedar colgada, ni un flowfield (menos destinos, o los
  // .json después de exportar .bin)
  const hechos = new Set(archivos.map(([n]) => n.replace(/^[^/]+\//, '')));
  const sobran = [...fs.readdirSync(path.join(B, 'img')).map(n => 'img/' + n), ...fs.readdirSync(B).filter(n => /^ff_/.test(n))].filter(n => !hechos.has(n));
  if (!SAL) for (const n of sobran) fs.unlinkSync(path.join(B, n));
  console.log(`iguales (${iguales.length}): ${iguales.map(s => s.split(' ')[0]).join(', ')}`);
  console.log(`cambiaron (${cambiaron.length}):\n  ${cambiaron.join('\n  ')}`);
  if (nuevos.length) console.log(`nuevos: ${nuevos.join(', ')}`);
  if (sobran.length) console.log(`${SAL ? 'sobrarían' : 'borrados'}: ${sobran.join(', ')}`);

  if (!SAL && !hay('sin-atlas')) { const t2 = Date.now(), atlas = path.join(B, 'atlas', 'bigAtlas.png'), antes = fs.existsSync(atlas) ? fs.statSync(atlas).size : 0;
    console.log('horneando el atlas…'); await hornear(URL0, DIR);
    console.log(`atlas en ${seg(t2)}: ${(antes / 1048576).toFixed(1)} → ${(fs.statSync(atlas).size / 1048576).toFixed(1)} MB de PNG`); }
  else if (!SAL) require('child_process').execFileSync('node', [path.join(__dirname, 'barrios.js')], { stdio: 'inherit' });
  console.log(`listo en ${seg(t0)}`);
})().catch(e => { console.error(e); process.exit(1); });
