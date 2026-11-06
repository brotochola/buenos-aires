// Playwright para las herramientas. El juego no tiene node_modules: si no está a mano (NODE_PATH, global), se usa el del repo de WeedJS.
// WEED_REPO = carpeta de WeedJS, si no es la de siempre.
const path = require('path'), { createRequire } = require('module');
function playwright() {
  try { return require('playwright'); } catch (e) { /* sigue abajo */ }
  return createRequire(path.join(process.env.WEED_REPO || 'D:/xampp/htdocs/multithreadad-game-engine', 'package.json'))('playwright');
}
module.exports = { playwright };
