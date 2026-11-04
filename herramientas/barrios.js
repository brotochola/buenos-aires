// Junta los meta.json de los barrios exportados (barrio/ = el inventado, carabobo/ = el real) en barrios.js, que importa la
// escena en todos los hilos: así una sola escena sirve para los dos (elige con ?barrio=… en la URL de la escena).
// Correrlo después de exportar un barrio o de hornear su atlas: node herramientas/barrios.js
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..'), B = {};
for (const d of ['barrio', 'carabobo']) { const f = path.join(R, d, 'meta.json'); if (fs.existsSync(f)) B[d] = JSON.parse(fs.readFileSync(f, 'utf8')); }
fs.writeFileSync(path.join(R, 'barrios.js'), '// generado por herramientas/barrios.js con los meta.json de cada barrio — no editar a mano\nexport const BARRIOS = ' + JSON.stringify(B) + ';\n');
console.log('barrios.js:', Object.keys(B).map(k => k + (B[k].atlas ? ' (atlas)' : '')).join(', '));
