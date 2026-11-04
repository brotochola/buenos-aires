# Barrio Conurbano · WeedJS

El mismo barrio de la versión Pixi/Three, armado como escena de WeedJS 0.13.0 con los patrones de `carScene` y `littleCity`.

## Cómo correrlo

WeedJS usa `SharedArrayBuffer`, así que la página tiene que estar "aislada" (encabezados COOP/COEP).

- **En tu compu:** `python3 servir.py` y abrí `http://localhost:8000/`.
- **Publicado:** subí la carpeta entera a cualquier hosting estático con HTTPS (por ejemplo GitHub Pages). `weed-sw.js` pone los encabezados: la primera visita recarga una vez sola.
- `?gente=N` fija la cantidad de gente (si no, se ajusta sola).
- `?prueba=x,y;x,y,p;x,y,u_cono` pone faroles (o la prop que digas, o `p` = una persona quieta) en esas coordenadas de mundo, para revisar a mano el orden de dibujo.
- `?debug` en la URL abre el panel de WeedJS (rendimiento por worker, entidades, capas, etc.). Sin `?debug` el juego carga el bundle de producción, más rápido.

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
- **Casas, tapiales y postes:** sprites horneados con R3 (luz, sombras, contornos), en un catálogo compartido entre lotes (`img/obj*.png`). Las calles y las casas usan sólo los 48 rumbos de pantalla de los autos (cada 7,5°), pasados a ángulos del mundo: así los autos quedan paralelos a la calle y las casas a su vereda. Cada grilla usa un par de esos rumbos que queda casi en escuadra (error menor a 1,6°). Cada casa es una entidad estática con colisionador poligonal (el lote) y su sombra al piso es una malla en la capa `sombrasCasas`.
- **Orden de dibujo (ySort) de las casas:** cada casa se dibuja en franjas verticales. En la proyección oblicua la altura sólo sube en pantalla, así que cada columna del sprite es un pedazo fijo de piso, y su profundidad es la base de la pared ahí. El horneado calcula esa base desde las cajas 3D apoyadas en el piso, y junta columnas mientras la base no cambie más de 8 px (64 px de ancho como máximo). Cada franja es una entidad `Franja` ubicada en la base, de donde sale su y de orden. Lleva colgadas piezas de 64 px de alto como decoraciones: se ordenan con la y del padre, pero se recortan cada una por su propio centro, así las paredes altas no desaparecen en el borde al hacer zoom. Las piezas se pisan 1 px para que no queden rayas. La entidad `Casa` sólo tiene el colisionador y la luz de la ventana.
- **Casas por caras con skew** (parámetro `skew` del editor, 1 por defecto; necesita WeedJS con DX-DECOSKEW, PR #7). En vez de hornear la casa entera una vez por rumbo, cada diseño se arma una sola vez en R3, sin rumbo, y se hornean sus caras planas. El juego dibuja cada cara con escala y skew, porque una cara plana vista en la proyección oblicua es un paralelogramo.
  - **Qué va al atlas:**
    - las caras con dibujo propio (fachadas, medianeras), con su contorno y la oclusión del piso, en piezas de hasta 128 px;
    - los techos, como baldosas de material compartidas por todas las casas;
    - los tanques, aires, antenas y macetas, como un sprite compartido cada uno, como el tanque de los props;
    - las caras de color liso no van al atlas: se dibujan con la textura blanca del motor, teñida.
  - **Luz:** cada pieza se tiñe con la luz de R3 según hacia dónde mira su cara en ese rumbo. No hay sombras proyectadas sobre las paredes.
  - **Orden de dibujo:**
    - dentro de la casa, el de pintor entre las caras (`innerZ`);
    - con el resto, la base de su pared, o la de la casa en su columna, subida lo justo para no quedar detrás de una pieza de la misma casa que la tapa.
  - **En el juego:** las piezas son decoraciones del mundo, no colgadas (la casa no se mueve), así no pasan por el paso de las decoraciones colgadas en cada cuadro. Se cargan con un solo objeto de configuración reusado.
  - **Barrio inventado:** el atlas pasó de 7982 × 4094 a 6071 × 4094 (las casas, de unos 17 a 10,7 Mpx). En 0, `skew` hornea como antes.
- **Árboles:** salen del editor (esqueleto tipo L-system, hojas en rosetas). Cada uno es una entidad `Arbol`: el tronco es su sprite y cada rama es una decoración colgada, anclada en su base, que se mece (`sway`).
- **Gente:** de 3500 a más de 15 000 personas LPC con cuerpo de Box2D, según el aparato. Arranca con 6000 en un celu de 8 núcleos (3500 en uno más chico, 10 000 en compu) y durante el primer minuto se ajusta sola. Mira los fps del render y de cada worker. Si sobra, suma de a 10 %; si no da, saca de a 12 %, siempre fuera de cámara. Si sacar gente no mejora nada (el freno es la GPU), la devuelve y deja de tocar. `?gente=8000` en la URL fija la cantidad. Los lugares (~23 000 en las veredas) están en `data/gente.bin` (`node herramientas/hornear_gente.js`). Siguen 6 flowfields estáticos con costos (vereda 10, calle 220), así que cruzan por las sendas y no caminan por la calle. Se separan entre sí y esquivan autos.
- **Autos:**
  - 23 modelos del paquete «TopDown Vehicles» v1.17 de MinZiin: hatch, sedán, pickup, compacto, micro, rural, coupé, de lujo, deportivo, superauto, muscle car, jeep, SUV, monovolumen, utilitario, limusina, camión, volcadora, casa rodante, colectivo, ambulancia, patrullero y taxi. Casi todos vienen en 2 colores (hatch, sedán y pickup en 3). Hay además 8 chatarras, quemadas o abandonadas.
  - `node herramientas/hornear_autos.js "<carpeta del paquete>"` arma `img/autos/`. Toma un cuadro quieto por rumbo de pantalla (48, cada 7,5°; la chatarra trae 8) y lo centra en el punto donde el vehículo apoya en el piso, así el ancla no salta entre cuadros. Guarda sólo los rumbos que miran a la derecha (25 de 48): los que miran a la izquierda se dibujan espejados (`flipX`). También escribe `autos.js` con el largo y el ancho de cada modelo.
  - El editor sólo da el lugar, el rumbo, si circula y un color (`poli` es patrullero, `burnt` es chatarra). El juego elige el modelo por peso y por la riqueza de la zona: los de lujo van en zonas ricas y los viejos en las pobres. Si el modelo tiene el color del editor, lo usa. Un vehículo largo queda sólo donde entra sin pisar a otro. Siempre circulan al menos 2 ambulancias, 4 colectivos, 2 volcadoras y 2 camiones.
  - Cada modelo tiene su colisionador. La IA frena y la gente esquiva según el tamaño de cada uno.
  - Los que andan solos siguen el flowfield `calles`, que apunta a lo largo de cada carril (mano derecha) y tira hacia su centro. Frenan si tienen gente o autos adelante.
  - **Respetan la ley de tránsito** (Ley Nacional 24.449 y Código de Tránsito de CABA). El editor exporta `transito.bin`, una grilla de 1 m con la velocidad máxima, la zona de cada cruce (los 7 m antes de la senda y la caja del cruce) y qué cruce es; `mundo.json` trae los cruces (si tienen semáforo y el rumbo de cada calle).
    - **Velocidad máxima** (art. 51): 40 km/h en las calles, 60 en las avenidas, 30 al llegar a un cruce sin semáforo y 20 en las calles de tierra y los pasajes. Cada conductor anda entre el 80 y el 97 % del máximo.
    - **Semáforos:** ciclo de 40 s (17 verde, 3 amarillo, 20 rojo para cada calle), con un desfase por cruce. Los autos frenan antes de la senda en amarillo y en rojo, y las lámparas del semáforo se prenden con la misma fase.
    - **Prioridad de la derecha** (art. 41) en las esquinas sin semáforo: el que viene por la derecha pasa primero. Si nadie se mueve en 4 s, el que espera arranca, para que no se traben los cuatro.
    - **No bloquear el cruce:** no entran si el auto de adelante está parado del otro lado.
    - **Peatones primero:** en las sendas y en el cruce frenan antes por la gente que cruza.
    - Cuesta 2 bytes por metro cuadrado del mapa y una lectura de la grilla por auto y por cuadro.
  - Los estacionados se pueden empujar.
  - Los 48 cuadros del paquete van en rumbos de pantalla parejos, así que el cuadro sale directo del rumbo del cuerpo. (Del paquete, los que miran a la izquierda no son el espejo exacto de los de la derecha; los espejos que usa el juego dejan las dos mitades simétricas.)
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

## El barrio real: Av. Carabobo al 1500 y la villa 1-11-14 (Bajo Flores)

El juego tiene tres barrios: el **inventado** (carpeta `barrio/`, el de siempre) y dos **reales**, Carabobo (`carabobo/`) y Parque
Chas (`parquechas/`). Se elige con `?barrio=carabobo` o `?barrio=parquechas` en la URL (si no, el último que se jugó) y el botón 🗺️
pasa al siguiente. Una sola escena sirve para todos: `barrios.js` junta los `meta.json` de cada carpeta (`node herramientas/barrios.js`,
después de exportar) y la escena toma el que diga su URL.

En el editor, con el parámetro `real` en 1 o 2 no se inventa el barrio: se arma con datos de verdad y el zip trae la carpeta
`carabobo/` o `parquechas/`; con `real` en 0, el inventado, en `barrio/`. El atlas de cada uno se hornea aparte:
`node herramientas/hornear_atlas.js http://localhost:8000 parquechas`.

- **Qué entra:** una franja de 480 × 1080 m jugables (más 40 m de margen), girada 15,5° para que la grilla de Bajo Flores quede casi derecha en pantalla. Arriba, Av. Carabobo con Balbastro, Lautaro y Saraza (el juego arranca en Carabobo al 1500); en el medio, Av. Castañares, Bonorino y el Barrio Rivadavia I con sus pasajes peatonales; abajo, la villa 1-11-14 hasta Av. Riestra.
- **Calles:** las de OSM, clasificadas (avenida, calle, pasaje, pasillo de villa), con su ancho, y encajadas en los 48 rumbos de los autos: cada tramo toma el rumbo más cercano y los nodos se mueven por mínimos cuadrados (en promedio 1,7 m), así las esquinas son las mismas.
- **Villa:** las manzanas de la 1-11-14 mapeadas en OSM, con sus pasillos. Las casillas son de ladrillo, de 2 a 4 pisos, pegadas, con contrapiso y tierra entre medio.
- **Barrio Coreano:** los locales sobre Carabobo tienen frente coreano (supermercado, restaurante, ropa, peluquería, panadería, iglesia, karaoke, almacén; Gemini, `arte/gemini/locales_02`).
- **Plazas y canchas** de OSM: las plazas con sus senderos, las canchas con arcos y líneas pintadas.
- **Rehacerlo:** `editor/recursos/osm_carabobo.json` son los datos bajados de la API de OSM (calles, usos del suelo, edificios, comercios, en metros); `python3 herramientas/osm_real.py --png vista.png` escribe `editor/recursos/real_carabobo.js` (ventana, giro y tamaño arriba del archivo). Después, exportar desde el editor como siempre.

## El barrio real: Parque Chas, el laberinto

El barrio de Frehner y Guerrico (1925): calles en anillos alrededor de la esquina de seis (Av. Victorica, Ávalos y Gándara), con
nombres de ciudades europeas (Berlín, Ginebra, La Haya, Londres, Cádiz…), y cuadrícula hacia La Pampa, Triunvirato y Av. de los Incas.

- **Qué entra:** 760 × 760 m jugables (más 40 m de margen) con centro a 300 m de la esquina de seis: los anillos enteros, las dos
  plazoletas de adentro (Éxodo Jujeño y Cap. Domingo F. Sarmiento), Av. Victorica de punta a punta, un tramo de Av. de los Incas y de
  La Pampa. El juego arranca en la esquina de seis. Girado 28,5°: es el giro con el que más calles caen en los rumbos de los autos.
- **Calles y plazoletas:** del callejero de la Ciudad (red vial, una línea por cuadra con nombre, tipo y jerarquía). Las curvas se
  encajan en los 48 rumbos como las rectas (los nodos se mueven 5 m en promedio, 20 m como mucho en los anillos). Las plazoletas son
  la manzana que encierra a los árboles de cada espacio verde del censo.
- **Árboles de vereda:** uno por uno, del censo de arbolado público lineal de la Ciudad (2017-2018), con su especie: fresnos (casi la
  mitad), plátanos, ficus, paraísos, tilos, crespones, jacarandás, liquidámbares, tipas y algún palo borracho. Se corren con las calles
  al encajarlas y se plantan sobre el cordón del tramo más cercano. Tilo, crespón y ficus son especies nuevas (sólo salen donde el
  barrio las pide).
- **Casas:** bajas, de los años 30 a 60: casas de una y dos plantas y PH, algún chalet y casi sin comercio adentro (los locales van
  sobre las avenidas). Un 28 % de las casas tiene techo de tejas (`estilo.tejas`); las tejas son un material compartido del horneado
  con skew, como los techos planos y la chapa.
- **La esquina de seis:** una rotonda con la fuente revestida de trencadís (el mosaico que pusieron los vecinos en 2016;
  `herramientas/fuente_mosaico.py`). Los autos le dan la vuelta en sentido antihorario y cada uno elige por qué calle sale. Frente
  a la fuente, la Pizzería Keops (Gándara 2699) y el Café Chas (sobre Ávalos; no encontré en cuál de las esquinas de Gándara y
  Ávalos está, va en la que tiene el frente a la cámara), con su cartel y mesitas en la vereda.
- **Exportado** con skew: 2855 casas, 1721 árboles (los del censo que caen en una vereda, más los de las plazoletas), 116 mil
  piezas de pared y techo, atlas de 5706 × 4094.
- **Rehacerlo:** los datos salen del portal data.buenosaires.gob.ar (red vial, arbolado público lineal y arbolado en espacios verdes;
  no se guardan acá, pesan 100 MB). `python3 herramientas/gcba_osm.py --barrio parquechas --red red-vial-CABA.geojson
  --arbolado arbolado_lineal.csv --verdes arbolado_verdes.csv` escribe `editor/recursos/osm_parquechas.json` en el formato de OSM;
  `python3 herramientas/osm_real.py --barrio parquechas --png vista.png` escribe `editor/recursos/real_parquechas.js`. El estilo del
  barrio (tipos de casa, riqueza, árboles de plaza, tejas, variedad) está en `BARRIOS` de `osm_real.py`.

## Cómo se arma la ciudad (editor/js/world.js)

- **Grilla continua:** en un mapa chico, una sola grilla (como Flores). En uno grande, zonas de loteos de distintas épocas separadas por rectas, que son avenidas o calles. Las calles siguen derecho de una cuadra a la otra.
- **Avenidas** rectas cada 4 a 6 cuadras. **Pasajes** de una cuadra, de calle a calle.
- **La red se limpia como grafo:** esquinas de 3 o 4 calles, ángulos de 35° o más, dos T enfrentadas a menos de 14 m se juntan en un cruce, y las calles que terminan en la nada se estiran hasta la próxima o se sacan.
- **Villas:** grupos de 2 a 5 manzanas en la zona más pobre, rodeadas de calles comunes (como la 1-11-14). Adentro tienen calles de tierra entre manzanas y pasillos que serpentean y salen a la calle.
- **Plazas:** una manzana entera cada 5 o 6 cuadras, con senderos de baldosa roja, monumento o fuente, árboles, faroles, bancos y juegos.
- **Lotes** hasta la mitad de la manzana. En los hondos casi siempre hay algo construido en el fondo.
- **Plantas:** macetas contra los frentes, plantas en los patios, canteros y cazuelas de vereda, y enredaderas, jardineras y helechos colgados en las fachadas. El parámetro `plantas` (1,8× por defecto) multiplica todas esas chances.
- **Esquinas con ochava:** en las esquinas de manzana casi en escuadra (no en la villa ni en calles de tierra) va una casa de esquina de 10 × 10 m con la ochava a 45°: el negocio en la ochava (almacén, bar, kiosco, farmacia, pizzería, panadería, café…) con cartel y a veces toldo, vidrieras sobre las dos calles, uno o dos pisos. Los bares y cafés sacan mesitas a la vereda. Parámetro `ochavas`.
- **Borde del mapa:** el área jugable (`mapW` × `mapH`) está cerrada por un **paredón** de 3 m con pilares, pintadas y alambre de púas, con colisionador. Del otro lado se genera ciudad, `margen` m de cada lado (45 por defecto), sin gente, sin autos andando y sin yuyos, para no cargar el juego. Los lotes que el paredón cruza quedan vacíos.
  - Los flowfields de la gente y de los autos sólo tienen dirección adentro, así que nadie aparece ni camina afuera.
  - La cámara libre no deja que la vista salga del mapa: en pantalla el mapa es un paralelogramo y la vista entera tiene que quedar adentro (`limitarVista`). Por eso nunca se ve el borde del mundo.
- **Pintadas** (`editor/js/graffiti.js`), según un relevamiento de las paredes porteñas: mensajes personales en aerosol ("PATO TE AMO", "VALE CALLATE", cumpleaños), barras y fútbol (en Bajo Flores, San Lorenzo: CASLA, "VOLVEMOS A BOEDO"), bandas (Los Redondos, La Renga, Callejeros), consignas de pintor sobre pared blanqueada a la cal ("NUNCA MÁS", "NI UNA MENOS", "URBANIZACIÓN YA"), poesía de pared (fondo blanco y letra negra fina, frases escritas para el juego), firmas y bombas de grafiteros, avisos (SE VENDE con un teléfono) y, en la villa, la fe de cada comunidad (Gauchito Gil, Virgen de Caacupé, Señor de los Milagros, el Padre Ricciardelli). Trazo de aerosol con niebla y chorreadas, renglones torcidos, y un color que se vea sobre esa pared.
- **Autos estacionados:** por cada calle tienen que poder pasar dos autos (2,45 m cada uno); se estaciona sólo si entran tres (de un lado) o cuatro (de los dos). Y como manda el Código de Tránsito de CABA: no en las avenidas de doble mano (prohibido de 7 a 21), ni en la esquina (hasta 5 m después de la vereda de la otra calle), ni en la parada del colectivo, ni junto a un hidrante.
- **Cazuelas** de tierra (con borde de ladrillo, de cemento o sin borde) alrededor de los árboles de vereda, a veces con plantas o yuyos.

## Arte con Gemini (props, plantas, yuyos y piezas de fachada)

Estilo: pixel art duro con contorno de color (el más oscuro de cada material, nunca negro), sombreado de 3 a 5 tonos que tira a violeta en la sombra y a amarillo en la luz, luz desde arriba a la izquierda.

1. Se le pide a Gemini (Nano Banana, razonamiento alto) una hoja de objetos sobre fondo plano: magenta, o cian si hay flores rosas. Para que todo salga con el mismo tamaño de pixel, conviene que la hoja traiga una persona de referencia y que los objetos estén a escala real al lado. Las hojas originales (1376×768) están en `arte/gemini/*.png`.
2. `arte/gemini/<hoja>.json` dice qué objeto es cada uno (`at` = centro aproximado en coordenadas de la vista de 1024 px, o `box` = recorte a mano) y cuánto mide (`h` alto y `d` fondo en metros, o `w` ancho). Con `persona` (dónde está la persona de referencia) la escala sale de ella para toda la hoja. Con `uniforme` usa la mediana de la hoja.
3. `python3 herramientas/achicar.py` (sin argumentos: todas las hojas) saca el fondo y achica cada objeto del original de Gemini **2×**: cada pixel es el promedio de un bloque de 2×2, sólo con los pixeles del dibujo. Lo que Gemini dibujó a menos del doble de su tamaño en el juego (la calesita, la glorieta, la hoja del Gauchito) va tal cual, porque si se achica el juego lo vuelve a agrandar y queda borroso. El tamaño real lo da `k`: el juego muestra el sprite a 0,6·k para que mida lo que tiene que medir a 30 px/m. Todo queda en `arte/gemini/achicado/`.
   - El 2× se eligió a ojo en `variantes.html` (lo arma `herramientas/variantes.py`): cada objeto tal cual, como era antes y achicado 2×…8× con promedio, nearest, bilineal y bicúbico, en el juego, con `?filtro=linear|nearest|mip`.
   - Antes se usaba `herramientas/pixelar.py`, que buscaba la grilla de Gemini y tomaba un pixel por celda. Como esa grilla no es entera (2,5, 2,83 o 3,6 px), algunas filas salían dobles y otras se perdían. Todavía arma `arte/gemini/limpio/`, de donde salen las piezas de fachada.
4. `arte/hd.json` dice qué nombre del juego usa cada objeto. Por ejemplo, `u_farola` es la luminaria LED y `u_contenedor` / `u_contenedor_b` son variantes. Los `pl_*` son plantas en maceta, los `plm_*` plantas que se mecen y los `yy_*` yuyos, que también se mecen.
   - Vistas de atrás: `arte/gemini/<hoja>_atras.png` es la misma hoja redibujada por Gemini con cada objeto girado 180°. Se le pasa la original y se le pide «EDIT the attached sprite sheet… turn EVERY object around 180 degrees on its vertical axis so we now see its BACK side», con la herramienta de imágenes y en 16:9. Hay de mobiliario, postes y plaza. Sus specs usan `"ref": 1376`, o sea coordenadas en pixeles de la hoja.
   - Esos objetos se llaman igual que el original pero con `_atras`, por ejemplo `u_banco_atras`. El editor y el exportador eligen el cuadro según hacia dónde mira el objeto (`face`, en `Barrio.vista`): si mira a la cámara usa el frente, y si mira para arriba usa la vista de atrás. Con el espejo salen las cuatro diagonales.
   - Lo que no mira a nada en especial (contenedores, semáforos, kioscos, paradas) mira a una diagonal que sale de su posición. Los semáforos de espaldas no muestran la luz.
5. `python3 herramientas/armar_hd.py` arma dos hojas:
   - `editor/recursos/hd_props.png/js`: los props, cada uno con su escala `e`;
   - `editor/recursos/fachada.png/js`: las piezas de fachada `fd_*`.
6. El editor usa los props HD en lugar de los v4 del mismo nombre y R3 pega las piezas de fachada en las paredes, sin suavizar. El exportador manda los props HD con su resolución y `META.escalas` le dice al juego a qué escala mostrarlos.

## Límites conocidos

- El catálogo de casas se reparte entre lotes para entrar en el atlas único de WeedJS. Por eso algunas casas son un poco más angostas que su lote y quedan pasillos laterales.
- Ese atlas (hasta 8192×4096 píxeles) lleva casas, gente, árboles, props y autos. Con WeedJS ff32c939 o posterior no hay tope de cuadros (antes, con más de 8192, no se dibujaba ningún sprite: N-111). Si un barrio no entra en los píxeles, el juego no carga («Could not fit … into atlas»): bajá la «variedad» de casas.
- Sin giro de cámara, porque los sprites están horneados para una sola vista. Los props de Gemini tienen frente y espalda (y espejo): cuatro diagonales, no ocho rumbos.
- Manejando, la cámara sigue al auto sin el límite de la cámara libre: muy alejado y en una esquina del paredón se puede llegar a ver el borde del mundo.
- Las texturas float (`rgba32float`) de las capas worldRect no suben bien en WebGL en esta versión de WeedJS: se suben como bytes con tipo FLOAT. Por eso la tabla de calles va en RGBA8 con punto fijo.

## Créditos

- Mapa de Carabobo: © colaboradores de OpenStreetMap (https://www.openstreetmap.org/copyright), licencia ODbL.
- Parque Chas: callejero (red vial), arbolado público lineal y arbolado en espacios verdes del Gobierno de la Ciudad de Buenos Aires
  (https://data.buenosaires.gob.ar), licencia CC BY 2.5 AR.

- Autos: «TopDown Vehicles» v1.17 de MinZiin (https://minzinn.itch.io/), licencia Creative Commons Atribución 4.0.
