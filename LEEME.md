# Barrio Conurbano · WeedJS

El mismo barrio de la versión Pixi/Three, armado como escena de WeedJS 0.13.0 con los patrones de `carScene` y `littleCity`.

## Cómo correrlo

WeedJS usa `SharedArrayBuffer`, así que la página tiene que estar "aislada" (encabezados COOP/COEP).

- **En tu compu:** `python3 servir.py` y abrí `http://localhost:8000/`.
- **Publicado:** subí la carpeta entera a cualquier hosting estático con HTTPS (por ejemplo GitHub Pages). `weed-sw.js` pone los encabezados: la primera visita recarga una vez sola.
- `?debug` en la URL abre el panel de WeedJS (rendimiento por worker, entidades, capas, etc.).

## Controles

| Acción | Cómo |
|---|---|
| Mover la cámara | arrastrar, WASD o flechas |
| Zoom | rueda, pellizco, o los botones − + |
| Manejar | V o el botón 🚗 (WASD / flechas; espacio frena). En el celu aparecen botones. |
| Cambiar la hora | botón 🌗 (salta a mediodía, atardecer, noche y amanecer) |

## Cómo está armado

- **Mundo de WeedJS = píxeles de la proyección oblicua** (18 px/m de ancho, 9 px/m de profundidad, corrimiento K = 0,16), igual que littleCity. La física de Box2D corre en ese espacio.
- **Piso:** una capa `worldRect` con un shader (`shaders/piso.frag`) que pinta calles, veredas, sendas, cordones, canteros, baches y patios en la GPU, píxel por píxel, con el mismo algoritmo que la versión Pixi. Los datos van en texturas compartidas (`PisoData`): celdas de 0,5 m con las calles candidatas, la tabla de calles en punto fijo de 16 bits, la riqueza y el ruido.
- **Casas, tapiales y postes:** sprites horneados con R3 (luz, sombras, contornos), en un catálogo compartido entre lotes (`img/obj*.png`). Los ángulos de las grillas, avenidas y pasillos están cuantizados a 15°, y cada lote usa la casa del catálogo más parecida para su ángulo. Cada casa es una entidad estática con colisionador poligonal (el lote) y su sombra al piso es una malla en la capa `sombrasCasas`.
- **Gente:** 2000 personas LPC con cuerpo de Box2D. Siguen 6 flowfields estáticos con costos (vereda 10, calle 220), así que cruzan por las sendas y no caminan por la calle. Se separan entre sí y esquivan autos.
- **Autos:**
  - Los que andan solos siguen el flowfield `calles`, que apunta a lo largo de cada carril (mano derecha) y tira hacia su centro. Frenan si tienen gente o autos adelante.
  - Los estacionados se pueden empujar.
  - El cuadro de los 48 ángulos se elige "desaplastando" la y de la pantalla.
- **Luz y sombras (como `predatorScene`):** `config.lighting` con sol y ciclo de día de 8 minutos (arranca a las 17:30). Gente, autos, árboles y postes tienen `ShadowCaster`, así que proyectan sombra del sol y de las luces cercanas. Tienen `LightEmitter` los faroles (con brillo), los semáforos, algunas ventanas de casas y los faros de los autos en movimiento. Las sombras horneadas de las casas se apagan de noche.
- **Árboles, faroles y semáforos** son entidades con colisionador. El mobiliario chico, las sombras de los props y los cables son `Decoration`; los cables van en una capa propia por encima de todo.

## Re-hornear (otro barrio)

```
npm i playwright && npx playwright install chromium
node herramientas/run_bake.js 12345      # 12345 = semilla
```

Regenera `img/obj*`, `img/props.json`, `data/*` y `meta.js`. Después volvé a hornear el atlas de sprites (el celu lo baja listo en vez de armarlo al arrancar): con `python3 servir.py` corriendo, `node herramientas/hornear_atlas.js`. El tamaño del mapa (480 × 340 m) y el tope del catálogo (200 casas) están en `run_bake.js`.

## Límites conocidos

- El catálogo de casas se reparte entre lotes para entrar en el atlas único de 4096² de WeedJS. Por eso algunas casas son un poco más angostas que su lote y quedan pasillos laterales.
- Los bordes entre loteos (la división de Voronoi) no están cuantizados. Ahí la casa puede quedar hasta 7,5° torcida respecto de la vereda.
- Sin giro de cámara, porque los sprites están horneados para una sola vista.
- Las texturas float (`rgba32float`) de las capas worldRect no suben bien en WebGL en esta versión de WeedJS: se suben como bytes con tipo FLOAT. Por eso la tabla de calles va en RGBA8 con punto fijo.
