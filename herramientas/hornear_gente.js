// Hornea muchas posiciones de gente en las veredas: node herramientas/hornear_gente.js [cantidad] [semilla]
// Corre el mismo horneado que run_bake.js (misma semilla => mismo barrio) pero sólo guarda data/gente.bin.
// Formato: Uint16 por par [x*2, y*2 | quieta<<15], en el orden del horneado (las primeras son las del mundo original).
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const HERE = __dirname, OUT = path.join(HERE, '..'), N = +(process.argv[2] || 30000), seed = +(process.argv[3] || 20261101);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage(); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file://' + path.join(HERE, 'bake.html'));
  const frames = JSON.parse(fs.readFileSync(path.join(HERE, 'v4_assets.json'))).frames;
  const people = await p.evaluate(([frames, seed, N]) => window.bake({ seed, mapW: 480, mapH: 340, pedTargets: 6, cell: 12, people: N, houseBudget: 200, frames }).world.people, [frames, seed, N]);
  const old = JSON.parse(fs.readFileSync(path.join(OUT, 'data', 'world.json'))).people;
  let same = 0; for (let i = 0; i < old.length; i++) if (people[i] && people[i][0] === old[i][0] && people[i][1] === old[i][1]) same++;
  const u = new Uint16Array(people.length * 2);
  people.forEach((q, i) => { u[i * 2] = Math.round(q[0] * 2); u[i * 2 + 1] = Math.round(q[1] * 2) | (q[2] ? 0x8000 : 0); });
  fs.writeFileSync(path.join(OUT, 'data', 'gente.bin'), Buffer.from(u.buffer));
  console.log(JSON.stringify({ gente: people.length, quietas: people.filter(q => q[2]).length, igualesAlMundo: same + '/' + old.length }));
  await b.close();
})();
