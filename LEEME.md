# Barrio Conurbano · WeedJS

El mismo barrio de la versión Pixi/Three, armado como escena de WeedJS 0.13.0 con los patrones de `carScene` y `littleCity`.

## Cómo correrlo

WeedJS usa `SharedArrayBuffer`, así que la página tiene que estar "aislada" (encabezados COOP/COEP).

- **En tu compu:** `python3 servir.py` y abrí `http://localhost:8000/`.
- **Publicado:** subí la carpeta entera a cualquier hosting estático con HTTPS (por ejemplo GitHub Pages). `weed-sw.js` pone los encabezados: la primera visita recarga una vez sola.
- `?gente=N` fija la cantidad de gente (si no, se ajusta sola).
- `?prueba=x,y;x,y,p;x,y,u_cono` pone faroles (o la prop que digas, o `p` = una persona quieta) en esas coordenadas de mundo, para revisar a mano el orden de dibujo.
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
- **Orden de dibujo (ySort) de las casas:** cada casa se dibuja en franjas verticales. En la proyección oblicua la altura sólo sube en pantalla, así que cada columna del sprite es un pedazo fijo de piso, y su profundidad es la base de la pared ahí. El horneado calcula esa base desde las cajas 3D apoyadas en el piso, y junta columnas mientras la base no cambie más de 8 px (64 px de ancho como máximo). Cada franja es una entidad `Franja` ubicada en la base, de donde sale su y de orden. Lleva colgadas piezas de 64 px de alto como decoraciones: se ordenan con la y del padre, pero se recortan cada una por su propio centro, así las paredes altas no desaparecen en el borde al hacer zoom. Las piezas se pisan 1 px para que no queden rayas. La entidad `Casa` sólo tiene el colisionador y la luz de la ventana.
- **Árboles:** salen del editor (esqueleto tipo L-system, hojas en rosetas). Cada uno es una entidad `Arbol`: el tronco es su sprite y cada rama es una decoración colgada, anclada en su base, que se mece (`sway`).
- **Gente:** de 3500 a más de 15 000 personas LPC con cuerpo de Box2D, según el aparato. Arranca con 6000 en un celu de 8 núcleos (3500 en uno más chico, 10 000 en compu) y durante el primer minuto se ajusta sola. Mira los fps del render y de cada worker. Si sobra, suma de a 10 %; si no da, saca de a 12 %, siempre fuera de cámara. Si sacar gente no mejora nada (el freno es la GPU), la devuelve y deja de tocar. `?gente=8000` en la URL fija la cantidad. Los lugares (~23 000 en las veredas) están en `data/gente.bin` (`node herramientas/hornear_gente.js`). Siguen 6 flowfields estáticos con costos (vereda 10, calle 220), así que cruzan por las sendas y no caminan por la calle. Se separan entre sí y esquivan autos.
- **Autos:**
  - Los que andan solos siguen el flowfield `calles`, que apunta a lo largo de cada carril (mano derecha) y tira hacia su centro. Frenan si tienen gente o autos adelante.
  - Los estacionados se pueden empujar.
  - El cuadro de los 48 ángulos se elige "desaplastando" la y de la pantalla.
- **Luz y sombras (como `predatorScene`):** `config.lighting` con sol y ciclo de día de 8 minutos (arranca a las 17:30). Gente, autos, árboles y postes tienen `ShadowCaster`, así que proyectan sombra del sol y de las luces cercanas. Tienen `LightEmitter` los faroles (con brillo), los semáforos, algunas ventanas de casas y los faros de los autos en movimiento. Las sombras horneadas de las casas se apagan de noche.
- **Árboles, faroles y semáforos** son entidades con colisionador. El mobiliario chico, las sombras de los props y los cables son `Decoration`; los cables van en una capa propia por encima de todo.

## Otro barrio: el editor de barrios

`editor/` es el editor de barrios (la versión Three.js con todos los knobs). Se abre en `http://localhost:8000/editor/`.

1. Tocás los knobs (mapa, loteos, riqueza, calles, casas, árboles, gente y autos opcionales, luz) y elegís la semilla con 🎲.
2. **📦 Exportar** baja `barrio_<semilla>.zip`. Adentro está la carpeta `barrio/`:
   - `meta.js`/`meta.json`: tamaños y cantidades;
   - `mundo.json`: casas, árboles, props, autos y cables;
   - `piso.bin`;
   - flowfields `ff_*.json`: peatones, veredas (vuelta manzana) y calles;
   - hojas de sprites en `img/`.
3. Reemplazás la carpeta `barrio/` del juego por esa.
4. Opcional, para que el celu cargue rápido: con `python3 servir.py` corriendo, `node herramientas/hornear_atlas.js` hornea `barrio/atlas/` y lo marca en `meta.js`.

El editor no arma el bigAtlas, porque no sabe qué otras entidades va a tener el juego. Eso queda para el paso 4 o para el build final.

## Arte con Gemini (props y piezas de fachada)

Estilo: pixel art duro con contorno de color (el más oscuro de cada material, nunca negro), sombreado de 3 a 5 tonos que tira a violeta en la sombra y a amarillo en la luz, luz desde arriba a la izquierda. Todo a la densidad de los LPC y las casas: 30 px/m, mostrado a 0,6 en el juego.

1. Se le pide a Gemini (Nano Banana, razonamiento alto) una hoja de objetos sobre fondo magenta plano. Los pedidos y las hojas originales están en `arte/gemini/*.png`.
2. `arte/gemini/<hoja>.json` dice qué objeto es cada uno y cuánto mide (`h` alto y `d` fondo en metros, o `w` ancho). Si hace falta, también da `at` (centro aproximado) y `box` (recorte a mano).
3. `python3 herramientas/pixelar.py arte/gemini/<hoja>.json` saca el fondo y separa los objetos. Los vuelve a pixelar a 30 px/m: cada pixel toma el color más común de lo que cubre, así no hay mezcla. También limpia la paleta y pone el contorno de color. El resultado queda en `arte/gemini/limpio/`.
4. `arte/hd.json` dice qué nombre del juego usa cada objeto. Por ejemplo, `u_farola` es la luminaria LED y `u_contenedor` / `u_contenedor_b` son variantes.
5. `python3 herramientas/armar_hd.py` arma dos hojas:
   - `editor/recursos/hd_props.png/js`: los props;
   - `editor/recursos/fachada.png/js`: las piezas de fachada `fd_*` (ventanas, puertas, portones, persianas de local, medidor).
6. El editor usa los props HD en lugar de los v4 del mismo nombre y R3 pega las piezas de fachada en las paredes, sin suavizar. El exportador manda los props HD con su resolución y `META.escalas` le dice al juego que los muestre a 0,6.

## Límites conocidos

- El catálogo de casas se reparte entre lotes para entrar en el atlas único de 4096² de WeedJS. Por eso algunas casas son un poco más angostas que su lote y quedan pasillos laterales.
- Los bordes entre loteos (la división de Voronoi) no están cuantizados. Ahí la casa puede quedar hasta 7,5° torcida respecto de la vereda.
- Sin giro de cámara, porque los sprites están horneados para una sola vista.
- Las texturas float (`rgba32float`) de las capas worldRect no suben bien en WebGL en esta versión de WeedJS: se suben como bytes con tipo FLOAT. Por eso la tabla de calles va en RGBA8 con punto fijo.
