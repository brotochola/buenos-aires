// Re-hornea el barrio: node herramientas/run_bake.js [semilla]   (necesita: npm i playwright && npx playwright install chromium)
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const HERE = __dirname, OUT = path.join(HERE, '..'), seed = +(process.argv[2] || 20261101);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage(); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file://' + path.join(HERE, 'bake.html'));
  const frames = JSON.parse(fs.readFileSync(path.join(HERE, 'v4_assets.json'))).frames;
  const res = await p.evaluate(([frames, seed]) => window.bake({ seed, mapW: 480, mapH: 340, pedTargets: 6, cell: 12, people: 2000, houseBudget: 200, frames }), [frames, seed]);
  for (const d of ['data', 'img']) fs.mkdirSync(path.join(OUT, d), { recursive: true });
  for (const f of fs.readdirSync(path.join(OUT, 'img'))) if (/^obj\d+\.(png|json)$/.test(f)) fs.unlinkSync(path.join(OUT, 'img', f));
  for (const sh of res.sheets) { fs.writeFileSync(path.join(OUT, 'img', sh.name + '.png'), Buffer.from(sh.png.split(',')[1], 'base64')); fs.writeFileSync(path.join(OUT, 'img', sh.name + '.json'), sh.json); }
  fs.writeFileSync(path.join(OUT, 'img', 'props.json'), res.props);
  for (const [k, v] of Object.entries(res.flow)) fs.writeFileSync(path.join(OUT, 'data', 'ff_' + k + '.json'), v);
  fs.writeFileSync(path.join(OUT, 'data', 'world.json'), JSON.stringify(res.world));
  const parts = ['cellA', 'cellB', 'wealth', 'noise', 'segs'], bufs = parts.map(k => Buffer.from(res.ground[k], 'base64')); let off = 0; const offs = {};
  parts.forEach((k, i) => { offs[k] = [off, bufs[i].length]; off += bufs[i].length; off = (off + 3) & ~3; });
  const all = Buffer.alloc(off); parts.forEach((k, i) => bufs[i].copy(all, offs[k][0])); fs.writeFileSync(path.join(OUT, 'data', 'ground.bin'), all);
  res.meta.groundParts = offs;
  fs.writeFileSync(path.join(OUT, 'meta.js'), '// generado por herramientas/run_bake.js — no editar a mano\nexport const META = ' + JSON.stringify(res.meta) + ';\n');
  console.log(JSON.stringify(res.stats)); await b.close();
})();
