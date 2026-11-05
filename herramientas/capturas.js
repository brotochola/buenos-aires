// Capturas del juego a varias horas, siempre con el mismo encuadre, para comparar antes y después de un cambio.
// Con servir.py corriendo: node herramientas/capturas.js [--opción valor …]
//   --url http://localhost:8000    --barrio parquechas|carabobo|barrio    --horas 7,9,12,16,18.5,22
//   --x 15300 --y 5440 --zoom 1.5  centro (px de mundo) y zoom de la cámara; sin ellos, los de arranque
//   --sal capturas  --nombre antes  carpeta y prefijo: <sal>/<nombre>_<barrio>_<hora>[_k].png
//   --espera 6000                  ms después de poner la hora antes de capturar
//   --seguidas 1                   capturas seguidas por hora (más de una: para ver parpadeos)
//   --arranque 15000               ms de espera después de cargar (sin placa, los primeros cuadros tardan)
//   --extra "gente=200"            parámetros de más para index.html
// Chromium sin placa (SwiftShader): sirve para comparar dibujos, no para medir fps ni para ver parpadeos que dependen de
// la placa (el de la luna, por ejemplo, sólo se veía con GPU de verdad). Imprime la hora real, la intensidad del sol y los fps.
// Sin placa, la captura llega atrasada: la cámara se pone una sola vez, antes de la espera de arranque, y antes de cada
// captura se saca otra que se tira.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : d; };
(async () => {
  const URL0 = arg('url', 'http://localhost:8000'), BARRIO = arg('barrio', ''), HORAS = arg('horas', '7,9,12,16,18.5,22').split(',').map(Number);
  const X = arg('x', null), Y = arg('y', null), Z = arg('zoom', null), SAL = arg('sal', 'capturas'), NOM = arg('nombre', 'cap');
  const ESPERA = +arg('espera', 6000), ARRANQUE = +arg('arranque', 15000), SEG = Math.max(1, +arg('seguidas', 1)), EXTRA = arg('extra', '');
  fs.mkdirSync(SAL, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
  const errores = []; p.on('pageerror', e => errores.push(String(e))); p.on('console', m => { if (m.type() === 'error') errores.push(m.text()); });
  const q = [BARRIO && 'barrio=' + BARRIO, EXTRA].filter(Boolean).join('&');
  await p.goto(URL0 + '/index.html' + (q ? '?' + q : '')); await p.waitForFunction(() => window.__conurbano, null, { timeout: 300000 });
  await p.evaluate(([x, y, z]) => { const s = window.__conurbano;
    if (x !== null) s.focusX = +x; if (y !== null) s.focusY = +y; if (z !== null) s.zoomT = +z; }, [X, Y, Z]);
  await p.waitForTimeout(ARRANQUE);
  const tag = BARRIO || 'def';
  for (const h of HORAS) {
    await p.evaluate((h) => WEED.Sun.setTimeOfDay(h), h);
    await p.waitForTimeout(ESPERA);
    for (let k = 0; k < SEG; k++) {
      const f = path.join(SAL, `${NOM}_${tag}_${String(h).replace('.', ',')}${SEG > 1 ? '_' + k : ''}.png`);
      if (k === 0) { await p.screenshot(); await p.waitForTimeout(1500); }
      await p.screenshot({ path: f });
      const i = await p.evaluate(() => { const s = window.__conurbano; return { h: WEED.Sun.hour, I: WEED.Sun.intensity, z: WEED.Camera.zoom, x: s.focusX, y: s.focusY }; });
      console.log(f, 'hora', i.h.toFixed(2), 'sol', i.I.toFixed(3), 'cámara', Math.round(i.x), Math.round(i.y), i.z.toFixed(2));
    }
  }
  const fps = await p.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / 2); }; requestAnimationFrame(f); }));
  console.log('fps (sin placa, sólo de referencia):', fps); if (errores.length) console.log('errores:\n' + errores.slice(0, 10).join('\n'));
  await b.close();
})();
