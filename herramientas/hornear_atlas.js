// Hornea el atlas de WeedJS: con servir.py corriendo, node herramientas/hornear_atlas.js [http://localhost:8000]
const { chromium } = require('playwright'); const fs = require('fs');
(async () => { const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
 const p = await (await b.newContext({ viewport: { width: 800, height: 600 } })).newPage();
 await p.goto('' + (process.argv[2] || 'http://localhost:8000') + '/index.html?empaquetar'); await p.waitForFunction(() => window.__conurbano, null, { timeout: 120000 });
 const r = await p.evaluate(() => { const s = window.__conurbano; return { json: JSON.stringify(s.bigAtlasJson), png: s.bigAtlasCanvas.toDataURL('image/png'), w: s.bigAtlasCanvas.width, h: s.bigAtlasCanvas.height }; });
 fs.mkdirSync('' + require('path').join(__dirname, '..', 'img', 'baked') + '', { recursive: true });
 fs.writeFileSync('' + require('path').join(__dirname, '..', 'img', 'baked') + '/bigAtlas.json', r.json);
 fs.writeFileSync('' + require('path').join(__dirname, '..', 'img', 'baked') + '/bigAtlas.png', Buffer.from(r.png.split(',')[1], 'base64'));
 console.log(r.w, r.h, (r.json.length / 1e6).toFixed(2) + ' MB json'); await b.close(); })();
