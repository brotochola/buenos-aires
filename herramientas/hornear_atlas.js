// Hornea el atlas de WeedJS del barrio actual (barrio/ + personajes + autos) para que el celu no lo arme al cargar.
// Con servir.py corriendo: node herramientas/hornear_atlas.js [http://localhost:8000]
// Escribe barrio/atlas/bigAtlas.json|png y marca META.atlas = true en barrio/meta.js. Volver a correrlo después de exportar otro barrio.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
(async () => {
  const B = path.join(__dirname, '..', 'barrio'), mjs = path.join(B, 'meta.js');
  // armar el atlas sin el horneado anterior
  fs.writeFileSync(mjs, fs.readFileSync(mjs, 'utf8').replace(/"atlas":true,?/, ''));
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 800, height: 600 } })).newPage();
  await p.goto((process.argv[2] || 'http://localhost:8000') + '/index.html?empaquetar&gente=100'); await p.waitForFunction(() => window.__conurbano, null, { timeout: 180000 });
  const r = await p.evaluate(() => { const s = window.__conurbano; return { json: JSON.stringify(s.bigAtlasJson), png: s.bigAtlasCanvas.toDataURL('image/png'), w: s.bigAtlasCanvas.width, h: s.bigAtlasCanvas.height }; });
  fs.mkdirSync(path.join(B, 'atlas'), { recursive: true });
  fs.writeFileSync(path.join(B, 'atlas', 'bigAtlas.json'), r.json);
  fs.writeFileSync(path.join(B, 'atlas', 'bigAtlas.png'), Buffer.from(r.png.split(',')[1], 'base64'));
  fs.writeFileSync(mjs, fs.readFileSync(mjs, 'utf8').replace('export const META = {', 'export const META = {"atlas":true,'));
  // WeedJS < ff32c939 guardaba una fila por cuadro en una textura de 3 × N: con más de MAX_TEXTURE_SIZE cuadros no dibujaba ningún sprite (N-111, arreglado)
  const n = Object.keys(JSON.parse(r.json).frames).length;
  console.log(r.w + '×' + r.h, (r.json.length / 1e6).toFixed(2) + ' MB json', n + ' cuadros'); await b.close();
})();
