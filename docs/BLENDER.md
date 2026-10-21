# Guía de Blender: del greybox al cuarto horneado (M3)

Esta guía te lleva desde Blender recién instalado hasta un `room.glb` con iluminación horneada andando en la web. Está pensada para alguien que arranca con Blender: cada paso dice **dónde** hacer clic y **por qué**.

El código ya está listo. Hoy la web usa un *greybox* (cajas grises generadas por `npm run greybox`). Tu trabajo en M3 es reemplazar dos cosas:

- `src/assets/models/room.glb`: la geometría.
- `src/assets/bake/*.webp`: la luz horneada.

Ningún otro archivo cambia. Fuente de verdad: [`PLAN.md`](PLAN.md) §6 (pipeline) y §7 (presupuesto).

---

## 0. El mapa completo

```
room_bake.blend ──prep_bake.py (por grupo)──► bake en Cycles ──► blender/bake/<grupo>_albedo.png
                                                                 blender/bake/<grupo>_irrA.png
                                                                 blender/bake/<grupo>_irrB.png (opcional)
       │                                                                  │
       └─ Save Copy ─► room_export.blend ─export_prep.py─► Export glTF    │
                                                │                         │
                                   blender/export/room.raw.glb            │
                                                │                         │
                         npm run assets:glb ◄───┘     npm run assets:textures ◄┘
                                │                               │
                   src/assets/models/room.glb        src/assets/bake/*.webp
                                └────────── npm run assets:manifest ─────────┘
```

`npm run assets` corre las tres cosas en orden: GLB, texturas y manifiesto de bytes del loader.

---

## 1. Instalar Blender

1. Bajá **Blender 4.5 LTS** desde <https://www.blender.org/download/lts/>. También sirve 5.x. LTS significa que recibe parches durante dos años, así que es la versión más estable para aprender.
2. Instalalo (en Windows, el `.msi`) y abrilo.
3. Andá a **Edit → Preferences** y configurá esto:
   - **System → Cycles Render Devices**: elegí tu GPU. **HIP** es para AMD, **OptiX** o **CUDA** para NVIDIA. Sin GPU, el bake anda igual con CPU, solo que más lento.
   - **Input → Emulate 3 Button Mouse**: activalo si usás touchpad.
   - Abajo a la izquierda: **Save Preferences**.
4. Abrí **Window → Toggle System Console** (Windows). Ahí se ven los mensajes de los scripts.

Atajos que vas a usar todo el tiempo:

| Atajo | Qué hace |
|---|---|
| `G` / `R` / `S` | Mover / rotar / escalar (después `X`, `Y`, `Z` para fijar un eje y un número para el valor exacto) |
| `Tab` | Alterna entre Object Mode y Edit Mode |
| `A` / `Alt+A` | Seleccionar todo / nada |
| `N` | Panel lateral, con las **Dimensions** exactas en metros |
| Numpad `1` `3` `7` `0` | Vista frontal / lateral / superior / cámara |
| `Ctrl+A` | Aplicar escala y rotación |
| `F2` | Renombrar el objeto activo |

---

## 2. Reglas de la escena

| Regla | Dónde se configura | Por qué |
|---|---|---|
| Unidades métricas, **Unit Scale 1.0** | Scene Properties → Units | 1 unidad = 1 metro, igual que en la web |
| Escala aplicada (`Ctrl+A → Scale`) | Object Mode | El bake y el exportador esperan escala 1 |
| El exportador convierte a **+Y arriba** | Opción del export glTF | Blender usa Z arriba y three.js usa Y arriba |
| El centro del TV queda en ≈ **(0.04, −0.02, 1.10)** en Blender | Panel `N` → Location | Equivale a `(0.04, 1.1, 0.02)` en la web, así los encuadres (`FRAMES`) sirven sin cambios |
| La cámara web mira hacia **+Y de Blender** | Numpad `1` (vista frontal) | La vista frontal de Blender es exactamente lo que ve la web |
| La ventana va arriba a la izquierda del escritorio | — | La lluvia y la ciudad se alinean con `anchor_city` |
| Para previsualizar: View Transform **AgX**, Exposure **+0.85** | Render Properties → Color Management | Equivale al exposure 1.8 de la web |

> **Truco para arrancar:** importá el greybox como esqueleto con **File → Import → glTF 2.0** y elegí `src/assets/models/room.glb`. Trae todos los nodos con su nombre, sus custom properties y las anclas, ya en su lugar. Después reemplazás la geometría pieza por pieza y mantenés los nombres.

La escala de referencia del greybox es:

- escritorio a 0.75 m;
- cuarto de 5.2 × 3.65 × 2.7 m;
- pared del fondo en y ≈ +0.45 en Blender.

---

## 3. Assets de Poly Haven (gratis, CC0)

El add-on oficial de Poly Haven es pago, así que se descarga a mano. Es fácil:

1. Entrá a <https://polyhaven.com/models> y buscá el asset.
2. Arriba a la derecha elegí **1K** y el formato **Blend**, y después **Download**.
3. Descomprimí el zip en una carpeta **fuera del repo** (por ejemplo `Documentos/polyhaven/<asset>/`). Las texturas tienen que quedar al lado del `.blend`.
4. En tu escena: **File → Append**. Navegá al `.blend` del asset, entrá a la carpeta `Collection` (o `Object`), elegí el modelo y dale **Append**.
   - Usá **Append**, no Link. Lo linkeado no se puede editar y `export_prep.py` lo rechaza.
5. Revisá el tamaño con `N → Dimensions`. Poly Haven ya trabaja en metros reales.

Qué bajar (PLAN.md §6):

| Rol | Assets |
|---|---|
| Piezas principales | `Television_01`, `desk_lamp_arm_01`, `WoodenTable_01` o `metal_office_desk`, `painted_wooden_chair_01`, `wooden_bookshelf_worn` |
| Props | `cassette_player`, `clipboard`, `binder_notebook`, `office_notepads`, `round_spectacles`, `stationery_supplies`, `potted_plant_02` / `04`, `wall_clock`, marcos de fotos, `Camera_01` |

Presupuesto: **≤ 300k triángulos en toda la escena**. Activá **Overlays → Statistics** para ver el total. Si un asset es muy pesado, agregale un modificador **Decimate** (modo *Collapse*) y bajá el *Ratio* hasta que la silueta empiece a cambiar.

---

## 4. Lo que modelás a mano

Todo esto es box modeling: **Add → Mesh → Cube**, medidas exactas en el panel `N`, y **Bevel** (`Ctrl+B`, o el modificador Bevel con 2–5 mm y 2 segmentos) para que los bordes agarren luz.

| Objeto | Nombre(s) | Detalle |
|---|---|---|
| PC vieja | `pc_body`, `pc_monitor`, `pc_keyboard` + `pc_screen` | El gabinete, el monitor y el teclado van como objetos separados. La pantalla es un plano metido 1–2 mm adentro del bisel |
| VCR | `vcr_body` + `vcr_flap` | El **origen de la tapa va en la bisagra**: el borde de arriba de la tapa. La web la rota sobre su X local |
| 8 VHS | `tape_01` … `tape_08` | 18.7 × 10.2 × 2.5 cm cada uno. Cada uno es un objeto propio, **no** un Alt+D. El lomo (la cara de 18.7 × 2.5) mira a la cámara |
| Etiquetas (opcional) | `tape_01_label` … `tape_08_label` | Un plano con UV 0..1 apoyado sobre el lomo, 0.5 mm afuera. Si no existe, la web le pega una etiqueta sola (mirá la sección 5.1) |
| Lámpara | `lamp_head` (+ `lamp_arm`, + `lamp_bulb` opcional) | La cabeza alumbra hacia su −Y local. `lamp_bulb` es la lamparita: la web la hace brillar cuando la lámpara está prendida (sin ella, pone un disco chico abajo de la cabeza) |
| Bloc | `notepad` + `notepad_page` | La página es un plano con UV 0..1 y es **hija** del bloc |
| Polaroid | `polaroid_photo` | Un plano con UV 0..1 para la foto |
| Ventana | marco + `window_glass` | El vidrio es un plano dentro del hueco. La web le dibuja las gotas de lluvia encima, así que necesita UV 0..1 |
| Anclas | `anchor_notepad_up`, `anchor_city` | **Add → Empty → Plain Axes**. `anchor_city` va unos 1 m detrás del vidrio, en el centro de la ciudad |
| Taza de café (opcional) | `coffee_mug` + hija `coffee_liquid` | Taza de ~9.5 cm de alto con asa, sobre el escritorio a la izquierda del TV, cerca del borde. **Origen abajo, en el centro de la base.** `coffee_liquid` es solo el disco de arriba del café (un círculo plano mirando a +Z de Blender), **hijo** de la taza, a la altura de la taza llena. La web lo baja en cada sorbo |
| Reloj de pared (opcional) | `wall_clock` + hijas `clock_hour`, `clock_minute`, `clock_second` | Reloj de ~18 cm colgado en la pared del fondo, a la derecha del monitor de la PC (es la única pared que se ve desde una vista: #about). La esfera mira hacia la cámara. Cada aguja es **hija** del reloj, apunta a las 12 y tiene el **origen en el centro de la esfera** (mirá abajo) |
| Fichero / rolodex (opcional) | `rolodex` | Una cajita de fichas con una ficha abierta, en el escritorio delante de la lámpara. De ahí sale la ficha de créditos de la web |
| Reproductor de CD (opcional) | `cd_player` + hijas `cd_lid`, `cd_disc`, `cd_display` | Un discman de ~13 × 14 × 2.5 cm acostado en el escritorio, delante del estante de cintas (entre la VCR y el bloc), con el frente (el display y los botones) mirando hacia −Y, o sea hacia la cámara. **Origen abajo, en el centro.** La tapa tiene el **origen en la bisagra de atrás**; el disco, en su centro; el display es un plano con UV 0..1 (mirá "Reproductor de CD") |
| Calculadora (opcional) | `calculator` + hijas `calc_display`, `calc_keys` | Una calculadora de escritorio de ~9 × 14 cm entre el rolodex y la taza. Se modela **parada** y se acuesta rotando el objeto (mirá "Calculadora"). El display y el teclado son planos con UV 0..1 |
| Teclas de la PC (opcional, caro) | `pc_key_<código>` (`pc_key_KeyA`, `pc_key_Space`…) | Una tecla por objeto, suelta (no hija del teclado). Cada una es un draw call: lo normal es **no** modelarlas (mirá "Teclado de la PC") |
| Pósters (opcional) | `poster_<id>` (`poster_berserk`, `poster_typescript`…) | Un plano con UV 0..1 en la pared, donde quieras ese póster. El `<id>` sale de `src/content/posters.ts`. Sin `bake` (mirá "Decoración") |
| Plantas (opcional) | `plant_monstera`, `plant_snake`, `plant_pothos` | Tu planta reemplaza a la que genera la web. Es estática: se puede hornear con los props |
| Luces de guirnalda (opcional) | `fairy_lights` | Un mesh del cable: **cada vértice es una lamparita** (la web pone ahí una bombita que titila) |
| Tira LED (opcional) | `led_strip` | Una caja finita detrás del escritorio. La web la toma como la tira y le agrega el brillo violeta en la pared y el escritorio |

### Pantallas (`tv_screen`, `pc_screen`, `notepad_page`, `polaroid_photo`)

1. **Add → Mesh → Plane** y escalalo al tamaño de la pantalla. El plano por defecto ya trae UV 0..1, **no lo desenvuelvas**.
2. Rotalo **90° en X** (`R X 90`). Así queda parado y mirando hacia −Y, o sea hacia la cámara. Con esa rotación la imagen sale derecha en la web.
3. No le pongas `bake`. La web le pone su propia textura en tiempo real.

### Origen de la tapa del VCR

1. En Edit Mode seleccioná el borde de la bisagra.
2. `Shift+S → Cursor to Selected`.
3. Volvé a Object Mode y hacé **Object → Set Origin → Origin to 3D Cursor**.

### Agujas del reloj

Las agujas giran alrededor de su origen, así que el origen tiene que estar en el **centro de la esfera** (el eje del reloj), no en el medio de la aguja:

1. Seleccioná el reloj (`wall_clock`), entrá a Edit Mode, seleccioná el centro de la esfera (por ejemplo el eje) y hacé `Shift+S → Cursor to Selected`.
2. En Object Mode seleccioná las tres agujas y hacé **Object → Set Origin → Origin to 3D Cursor**.
3. Modelalas apuntando **a las 12** (hacia arriba), apenas delante de la esfera (1–6 mm), cada una a una distancia distinta para que no se pisen.
4. Emparentalas al reloj: seleccioná las agujas, después el reloj (último, queda activo) y `Ctrl+P → Object (Keep Transform)`.

La web pone la hora real del visitante, así que no importa qué hora muestres en Blender: solo que en reposo apunten a las 12. La compresión del GLB mueve los orígenes, pero `npm run assets:glb` guarda el centro como extra `hinge` (igual que la tapa del VCR).

### Taza de café

1. Modelá la taza con el **origen abajo, en el centro** (la web la levanta hacia la cámara para el "sorbo").
2. Agregá un círculo (**Add → Mesh → Circle**, *Fill Type: N-Gon*) con el radio de adentro de la taza, a la altura del café lleno (≈ 85% de la taza). Llamalo `coffee_liquid` y emparentalo a la taza (`Ctrl+P → Object (Keep Transform)`).
3. Material marrón muy oscuro y brillante (Roughness ~0.15).

### Reproductor de CD

La web lo usa con la tecla M (o un clic): la cámara baja a verlo de cerca, la tapa se abre con un clic, el disco gira mientras suena la música y el display muestra el tema y el tiempo.

1. **Cuerpo** (`cd_player`): una caja redondeada de ~13 × 14 × 2.2 cm, acostada, con el **origen abajo, en el centro**. Dejá una franja de ~3 cm adelante (del lado de −Y) para el display.
2. **Tapa** (`cd_lid`): un disco de ~5.5 cm de radio arriba del cuerpo, con una ventanita redonda en el medio (ahí se ve girar el disco). El **origen va en la bisagra**, sobre el borde de atrás (el de +Y): seleccioná ese borde en Edit Mode, `Shift+S → Cursor to Selected`, y en Object Mode **Set Origin → Origin to 3D Cursor** (como la tapa del VCR). La web la abre girándola sobre su X local, levantando el borde de adelante.
3. **Disco** (`cd_disc`): un círculo (*Fill Type: N-Gon*) de 5.2 cm de radio apenas arriba del cuerpo y debajo de la tapa, con el **origen en el centro** (gira sobre su eje). Necesita **UV 0..1 proyectadas desde arriba**: en Edit Mode, vista superior (Numpad `7`), **UV → Project from View (Bounds)**. La web le pinta la etiqueta.
4. **Display** (`cd_display`): un plano de ~10.8 × 2.4 cm acostado sobre la franja de adelante (mirando hacia arriba, +Z), con la UV por defecto: la **V = 0 hacia atrás** (+Y) y la U de izquierda a derecha. La web dibuja ahí el LCD y siete teclas (anterior, play/pausa, siguiente, stop, volumen −/+ y DISC, que cambia entre el disco generado y el de Joji).
5. Las tres piezas son **hijas** de `cd_player` (`Ctrl+P → Object (Keep Transform)`). Nada se hornea.

### Calculadora

La web la levanta frente a la cámara, así que tiene que "saber" dónde está su cara:

1. Modelala **parada**: el teclado mirando hacia −Y (la cámara, vista frontal) y el display arriba (+Z). Aplicá la escala (`Ctrl+A → Scale`), pero **no** apliques la rotación del paso 3.
2. `calc_display` (el visor, ~7.2 × 2.4 cm) y `calc_keys` (la cara del teclado, ~7.8 × 9.4 cm) son planos con UV 0..1 apoyados sobre la cara (como las pantallas: `R X 90`), **hijos** de `calculator`. La web dibuja los números y las 19 teclas (4 × 5) encima.
3. Acostala sobre el escritorio rotando el **objeto** (`R X -87` más o menos, con el display hacia atrás) y movela a su lugar. Esa rotación queda en el objeto: de ahí la web sabe para dónde mira la cara.

### Decoración (fase 3)

Todo esto ya existe en la web sin que hagas nada: la web pone los pósters, las plantas, la guirnalda y la tira LED sola, en lugares pensados para el greybox. Los nodos de abajo son **opcionales**: sirven para que, cuando el cuarto de Blender cambie de forma, puedas decidir vos dónde va cada cosa.

- **Pósters (`poster_<id>`):** agregá un plano (**Add → Mesh → Plane**, que ya trae UV 0..1), escalalo al tamaño del papel y apoyalo 3–5 mm delante de la pared, mirando hacia el cuarto. Como con las pantallas: la U va de izquierda a derecha y la V de arriba (0) hacia abajo (1); si sale espejado, rotalo 180°. **No** le pongas `bake`: la web le pega su parte del atlas de pósters y lo ilumina con la irradiancia de la pared que tiene atrás. El `<id>` es el de `src/content/posters.ts` (`berserk`, `vagabond`, `joji`, `radiohead`, `nirvana`, `typescript`, `javascript`, `react-next`). Ojo: no lo pongas sobre el vidrio, el reloj ni otro póster.
- **Plantas (`plant_monstera`, `plant_snake`, `plant_pothos`):** si modelás (o bajás de Poly Haven, `potted_plant_02` / `04`) una planta con ese nombre, la web deja de generar la suya. Es un objeto estático: puede ir horneado con `bake=props`.
- **Guirnalda (`fairy_lights`):** modelá el cable como un mesh (por ejemplo una curva convertida a mesh, **Object → Convert → Mesh**). La web pone una lamparita en **cada vértice**, así que dejá solo los puntos donde querés una (cada 5–7 cm). Las lamparitas son las únicas que hacen bloom.
- **Tira LED (`led_strip`):** una caja finita (~1 cm de alto) pegada a la pared detrás del escritorio, a lo largo de X. La web toma su caja como la tira: le pone el color (violeta, turquesa, ámbar o apagada, con un clic) y agrega el brillo en la pared y en el escritorio con tarjetas aditivas (las luces en tiempo real no tocan el bake).

### Teclado de la PC

Cuando el visitante escribe en #about / #online, la tecla que toca se hunde ~2 mm en el teclado de la PC.

- **Lo normal (recomendado):** modelá `pc_keyboard` con la **cara de arriba plana** (sin teclas). La web le pone 104 teclas en un solo draw call, repartidas sobre la caja del teclado (el frente hacia −Y de Blender, o sea hacia la cámara).
- **Si modelás las teclas dentro de `pc_keyboard`:** agregale la custom property `keycaps = 0` para que la web no ponga las suyas encima.
- **Teclas sueltas (opcional, caro):** una tecla por objeto llamado `pc_key_` + el código de la tecla del navegador (`KeyboardEvent.code`): `pc_key_KeyA`, `pc_key_Digit1`, `pc_key_Space`, `pc_key_Enter`, `pc_key_ShiftLeft`… Van **sueltas** (no hijas del teclado), con `bake=gear`. La web hunde esas en vez de las suyas. Ojo: **cada tecla es un draw call** (104 teclas se comen el presupuesto de 80); modelá solo unas pocas o quedate con las de la web.

---

## 5. Contrato de nombres

La web busca los objetos **por nombre exacto**: snake_case, sin puntos, sin espacios y sin mayúsculas. `src/three/contract.ts` revisa todo esto y en `npm run dev` avisa en la consola qué falta.

Las custom properties se ven en **Object Properties → Custom Properties**. `prep_bake.py` las escribe por vos.

| Nodo | Custom property | Nota |
|---|---|---|
| `static_<grupo>` | `bake=<grupo>` | Los estáticos de cada grupo, unidos en la copia de export (lo hace `export_prep.py`) |
| `tv_body` `vcr_body` `pc_body` `pc_monitor` `pc_keyboard` `lamp_head` | `bake=gear` | Interactivos: quedan separados |
| `vcr_flap` | `bake=gear` | Origen en la bisagra, rota en X local |
| `tape_01` … `tape_08` | `bake=shelf`, `slot=N` (entero) | `slot` mapea a `src/content/work.ts` |
| `notepad` (+ hija `notepad_page`) | `bake=props` | La página tiene UV0 0..1. Se iluminan en tiempo real |
| `tv_screen` `pc_screen` `polaroid_photo` `window_glass` | — | **No se hornean**. Llevan UV0 0..1 |
| `anchor_notepad_up` `anchor_city` | Empty | Poses ubicadas en Blender |
| `tape_01_label` … `tape_08_label` (opcional) | — | **No se hornean**. Plano con UV0 0..1 sobre el lomo de cada cinta |
| `lamp_bulb` (opcional) | — | **No se hornea**. La lamparita que brilla con la lámpara prendida |
| `coffee_mug` (+ hija `coffee_liquid`) (opcional) | — | **No se hornea**: se mueve (clic = un sorbo) y se ilumina en tiempo real, como el bloc. `coffee_liquid` tiene que ser **hija** de la taza |
| `wall_clock` (+ hijas `clock_hour`, `clock_minute`, `clock_second`) (opcional) | — | **No se hornea**: las agujas giran. Las agujas son **hijas** del reloj, con el origen en el centro de la esfera y apuntando a las 12 |
| `rolodex` (opcional) | `bake=props` | Estático: se hornea con los props, pero queda como objeto propio (es clickeable: abre los créditos) |
| `cd_player` (+ hijas `cd_lid`, `cd_disc`, `cd_display`) (opcional) | — | **No se hornea**: la tapa se abre y el disco gira. Las tres piezas son **hijas** del reproductor. `cd_lid` con el origen en la bisagra de atrás; `cd_disc` y `cd_display` con UV0 0..1 |
| `calculator` (+ hijas `calc_display`, `calc_keys`) (opcional) | — | **No se hornea**: se levanta. Modelada parada, acostada con la rotación del objeto. Las dos hijas llevan UV0 0..1 |
| `pc_key_<código>` (opcional) | `bake=gear` | Teclas sueltas de la PC (`pc_key_KeyA`…). Mantienen las mayúsculas del código. Un draw call cada una |
| `poster_<id>` (opcional) | — | **No se hornea**. Plano con UV0 0..1 en la pared: ocupa el lugar de ese póster (mirá "Decoración") |
| `plant_<id>` (opcional) | `bake=props` (o nada) | `plant_monstera`, `plant_snake`, `plant_pothos`: reemplazan a la planta generada |
| `fairy_lights` (opcional) | — | El cable de la guirnalda; cada vértice es una lamparita |
| `led_strip` (opcional) | — | La tira LED detrás del escritorio (una caja finita a lo largo de X) |

Opcionales: `static_floor`, `static_shelf`, `lamp_arm`, `lamp_bulb`, los `tape_NN_label`, la taza (`coffee_mug`, `coffee_liquid`), el reloj (`wall_clock` y sus agujas), `rolodex`, el reproductor de CD (`cd_player` y sus piezas), la calculadora (`calculator`, `calc_display`, `calc_keys`), las `pc_key_*` y la decoración (`poster_*`, `plant_*`, `fairy_lights`, `led_strip`). Si no existen, no pasa nada: la web pone los suyos.

> La taza, el reloj, el reproductor de CD y la calculadora se iluminan en tiempo real y usan su propio material. Igual que el bloc, para que lleven su color exportá con **Materials: Export** (mirá la sección 9).

### 5.1 Etiquetas de los VHS

La web dibuja **una sola textura** (un atlas de 1024×1024, una fila por slot) con el título y los años de cada cinta, sacados de `src/content/work.ts`. Los colores de cada etiqueta salen del `id` de la cinta, así que no tenés que pintar nada.

- **Sin hacer nada:** la web busca el lomo de cada `tape_NN` (la cara larga y fina que mira a la cámara) y le pega un plano finito encima. Alcanza con que el VHS sea una caja con las medidas reales.
- **Si querés controlar dónde va** (por ejemplo, un modelo con el lomo biselado): agregá un plano `tape_NN_label` con UV 0..1 (el plano por defecto ya las trae), apoyado 0.5 mm afuera del lomo. La U va a lo largo del texto (de donde empieza a donde termina) y la V de arriba de las letras (0) hacia abajo (1). Sin `bake`. `export_prep.py` lo deja como objeto suelto y la web lo engancha a su cinta.

Todas las etiquetas se dibujan en un solo draw call. En modo horneado toman el brillo de la irradiancia del lomo de su cinta, así que se ven igual de iluminadas que la cinta.

> ⚠️ **Nunca** uses una custom property llamada `pivot`. El cargador de three.js reserva ese nombre y te mueve los objetos.
>
> ⚠️ Blender agrega `.001` cuando duplicás un objeto (`tape_01.001`). Renombralo siempre con `F2`.

---

## 6. Hornear (bake) por grupo

### 6.1 Archivo y luces (una sola vez)

1. Guardá la escena como **`blender/room_bake.blend`**. La carpeta `blender/` no se despliega: los `.blend` van en Git LFS o en un drive.
2. **Render Properties → Render Engine: Cycles**, Device **GPU Compute**.
3. Armá las luces del bake:

| Luz | Cómo |
|---|---|
| World | **World Properties → Color**: azul muy oscuro, Strength 0.05–0.1 |
| Luna | **Add → Light → Sun**, color `#9fb4ff`, Strength ≈ 0.3, entrando por la ventana |
| Lámpara | **Add → Light → Spot** adentro de `lamp_head`, color ≈ `#ffb46b` (2700 K). Llamala **`lamp_light`** (`F2`): `prep_bake.py` la apaga sola para el bake `irrB` |
| Pantallas | Material **Emission**: azul en `tv_screen` (Strength ~3) y verde en `pc_screen` (~1.5). Es solo para el bake: la web pone las suyas |
| Ciudad | Un plano con Emission afuera de la ventana, que hace de "resplandor de ciudad" |
| Clamp | **Render Properties → Light Paths → Clamping → Indirect: 10** |

### 6.2 Grupos y tamaños

| Grupo | Qué incluye | Albedo | Irradiancia (web) | Irradiancia (bake) |
|---|---|---|---|---|
| `room` | paredes, techo, marco de ventana | 2048 | 1024 | 2048 |
| `floor` | piso | 1024 | 1024 | 2048 |
| `desk` | escritorio, cajonera | 2048 | 1024 | 2048 |
| `gear` | `tv_body`, `vcr_*`, `pc_*`, lámpara | 2048 | 1024 | 2048 |
| `shelf` | estante + `tape_NN` | 1024 | 512 | 1024 |
| `props` | `notepad`, `notepad_page`, plantas, clipboard… | 1024 | 512 | 1024 |

La irradiancia se hornea al doble. `npm run assets:textures` la achica con lanczos3, y eso limpia el ruido. El script ya elige estos tamaños: dejá `SIZE = 0`.

### 6.3 El ciclo de cada grupo

Pasá a la pestaña **Scripting**. En el Text Editor hacé **Text → Open** y elegí `blender/scripts/prep_bake.py`. Arriba de todo está el bloque `OPTIONS`.

**Paso 1: preparar (albedo).**

1. Seleccioná **todos** los meshes del grupo. En el Outliner, `Ctrl+clic` para sumar.
2. En `OPTIONS` poné `GROUP = "desk"`, `PASS = "albedo"`, `USE = "selected"`, `ACTION = "prep"`.
3. **Run Script** (▶ o `Alt+P`). En la consola vas a ver lo que hizo:
   - puso `bake=desk`;
   - dejó los UV en `[UVMap, BakeUV]` con BakeUV activo;
   - pasó los materiales compartidos a single-user;
   - puso Metallic 0;
   - creó la imagen `desk_albedo` y el nodo `BAKE_TARGET`;
   - dejó listos los ajustes de Cycles.

**Paso 2: desenvolver BakeUV** (solo la primera vez).

1. Con todo el grupo seleccionado: `Tab` (Edit Mode) → `A`.
2. **UV → Smart UV Project**, con *Island Margin* `0.003`.
3. Pasá al workspace **UV Editing** → **UV → Pack Islands**, con *Margin* `0.01`.
4. Revisá en **Object Data Properties → UV Maps**: **BakeUV** tiene que estar resaltado (activo) y **UVMap** tiene que tener el ícono de cámara (render).
5. En el editor UV, las islas no se pueden pisar ni salir del cuadrado.

**Paso 3: hornear el albedo.** Volvé a Object Mode, poné `ACTION = "bake"` y corré el script. Hornea con Diffuse, solo Color, 16 samples y margen de 16 px en Extend, y guarda `blender/bake/desk_albedo.png`.

**Paso 4: hornear la irradiancia.** Poné `PASS = "irrA"`, `USE = "tagged"` (ya no hace falta seleccionar) y `ACTION = "bake"`. Esta pasada usa Direct+Indirect sin Color, con 512 samples, y tarda bastante más.

**Paso 5 (opcional): hornear con la lámpara apagada (`irrB`).** En la web se puede clickear la lámpara para apagarla. Para que eso se vea bien horneado, hace falta una segunda irradiancia con la lámpara apagada:

1. Poné `PASS = "irrB"`, `USE = "tagged"` y `ACTION = "bake"`. Es **el mismo bake** que `irrA` (mismos samples, mismo tamaño, mismas UV), con una sola diferencia: la luz de la lámpara no cuenta.
2. Si tu Spot se llama `lamp_light`, el script la oculta del render (ícono de cámara) solo durante este bake y la vuelve a mostrar al terminar. Si se llama distinto, cambiá `LAMP_LIGHT` en `OPTIONS` (o pasá `--lamp-light <nombre>`), o apagala a mano y prendela de nuevo antes de volver a hornear `irrA`.
3. Si el emisivo de la lamparita (`lamp_bulb`) también ilumina la escena, poné su Strength en 0 para este bake.
4. Guarda `blender/bake/<grupo>_irrB.png`.

Es opcional y se puede hacer por grupo: un grupo sin `irrB` igual se oscurece al apagar la lámpara (la web multiplica su `irrA` por 0.55), solo que sin la luz exacta. Los `irrB` se descargan **después** de que el cuarto está andando, así que no suman a la barra de carga.

**Paso 6: revisar.** En el **Image Editor** abrí las imágenes. No tiene que haber texels negros ni costuras raras (mirá la sección 9).

Repetí los pasos para `room`, `floor`, `gear`, `shelf` y `props`.

> Si preferís los botones: **Render Properties → Bake → Bake** usa los ajustes que dejó el script. Después guardás con **Image → Save As** (`//bake/<grupo>_<pase>.png`) y **"Save As Render" desactivado**. Con eso activado, AgX y el exposure quedan metidos en la textura.

### 6.4 Desde la terminal (opcional)

```bash
blender blender/room_bake.blend --background --python blender/scripts/prep_bake.py -- \
  --group desk --pass irrA --use tagged --action bake
```

Opciones: `--group`, `--pass albedo|irrA|irrB`, `--size N`, `--use selected|tagged`, `--action prep|bake|save`, `--lamp-light <nombre>`, `--no-settings` y `--keep-metallic`.

---

## 7. La copia de export

`export_prep.py` reescribe la escena. Por eso **solo corre en una copia** cuyo nombre termina en `_export.blend`.

1. **File → Save Copy…** → `blender/room_export.blend`. Después abrí esa copia con **File → Open**.
2. En Scripting abrí `blender/scripts/export_prep.py` y dale **Run Script**. El script hace esto:
   - aplica los modificadores;
   - une los estáticos de cada grupo en `static_<grupo>`;
   - deja separados los nodos con nombre del contrato (y el `rolodex` y las `pc_key_*`);
   - desemparenta a los hijos de los meshes (salvo `notepad_page`, `coffee_liquid`, las agujas del reloj, las piezas del CD y el display y el teclado de la calculadora, que tienen que quedar en su padre);
   - pone un solo material `M_<grupo>` por objeto horneado, con Metallic 0;
   - **valida el contrato**.
3. Leé el reporte. Tiene que terminar en `CONTRACT OK`. Si dice `ERROR`, arreglalo y volvé a correrlo. Con `DRY_RUN = True` solo valida, sin tocar nada.
4. **File → Export → glTF 2.0 (.glb/.gltf)** con estos ajustes:

| Sección | Ajuste |
|---|---|
| Format | **glTF Binary (.glb)** |
| Include → Data | **Custom Properties ✓**, Cameras ✗, Punctual Lights ✗ |
| Transform | **+Y Up ✓** |
| Data → Mesh | Apply Modifiers ✓, **UVs ✓**, Normals ✓, Tangents ✗ |
| Data → Material | **Materials: Placeholder**, **Images: None** |
| Compression | ✗ (sin Draco: la compresión la hace `npm run assets:glb` con Meshopt) |
| Animation | ✗ |

5. Guardalo como **`blender/export/room.raw.glb`** (si la carpeta `export` no existe, creala desde el file browser).

---

## 8. `npm run assets` y cómo revisar el resultado

En la raíz del repo:

```bash
npm run assets
```

| Paso | Qué hace | Qué mirar |
|---|---|---|
| `assets:glb` | `gltf-transform optimize` con los flags del plan, `inspect`, y una auditoría del resultado | Al final: `wrote src/assets/models/room.glb`. Cualquier `ERROR` deja el GLB anterior como estaba |
| `assets:textures` | PNG → WebP (albedo q85, irradiancia lanczos 2K→1K q92, `irrB` igual que `irrA`) más las versiones `_m` para teléfono | `desktop boot set: X MiB of 3.00 MiB budget (OK)` y, si hay `irrB`, `lamp-off set (irrB, loaded after live)` |
| `assets:manifest` | Bytes reales para la barra de carga | `src/assets/sizes.json` actualizado (los `irrB` quedan en `deferred`: no cuentan para la barra) |

La auditoría de `assets:glb` falla en cualquiera de estos casos:

- un mesh horneado no tiene `TEXCOORD_1` (BakeUV);
- aparece `EXT_mesh_gpu_instancing`, o hay meshes horneados compartidos entre nodos;
- un nodo horneado tiene hijos;
- el contrato (`src/three/contract.ts`) no se cumple.

Además guarda la bisagra de `vcr_flap` y de `cd_lid`, y el centro de las agujas del reloj, como extra `hinge`. La compresión mueve el origen de los nodos, y así las tapas siguen girando sobre su bisagra y las agujas sobre el centro de la esfera. También exige UV0 en `cd_display`, `cd_disc`, `calc_display` y `calc_keys`.

Para revisar a mano:

```bash
npx gltf-transform inspect src/assets/models/room.glb
```

- **MESHES**: solo `TEXCOORD_0` y `TEXCOORD_1`.
- **EXTENSIONS**: `EXT_meshopt_compression` y `KHR_mesh_quantization`, sin `EXT_mesh_gpu_instancing`.
- Tamaño ≤ 1.5 MB y ≤ 300k triángulos.

Después levantá `npm run dev` y abrí la consola del navegador:

- tiene que aparecer `[contract] room.glb satisfies the naming contract`;
- `window.__renderInfo().materials` tiene que mostrar `mode: "baked"`, `lightMapChannels: [1]` y `lightMapIntensities: [3.1416]` (π·IRR_SCALE);
- `window.__renderInfo().scene.calls` tiene que dar ≤ 80 (tope 150);
- pasá el mouse por el TV, la PC y las cintas: tienen que brillar un poco (lightMap × 1.2);
- clickeá la lámpara: el cuarto pasa a la irradiancia `irrB` en ~250 ms (o se oscurece un poco, si ese grupo no tiene `irrB`).

> ¿Querés probar el pipeline sin Blender? `npm run assets:fake-bake` genera bakes sintéticos para el greybox (también `irrB`; `--no-irrB` lo saltea). Después corré `npm run assets:textures && npm run assets:manifest` y la web pasa a modo horneado. Para deshacerlo, corré `node scripts/fake-bake.mjs --clean`.

---

## 9. Problemas comunes

| Síntoma | Causa | Arreglo |
|---|---|---|
| **Costuras** (líneas finas en los bordes de las islas) | Islas pegadas, o margen chico | Pack Islands con margen 0.01 y bake con margen 16 px en Extend (el script ya los pone). Ninguna isla tiene que tocar el borde del cuadrado |
| **Metal negro** en el albedo | Un Diffuse Color de un material metálico da negro | Metallic 0 en la copia de bake (`prep_bake.py` lo hace solo; `ZERO_METALLIC = True`) |
| La luz de un grupo aparece en **otro** | Material o mesh compartido entre grupos (Alt+D) | `prep_bake.py` los pasa a single-user. Volvé a correrlo para los dos grupos |
| Error de Cycles **"No active image found"** | A un material del grupo le falta `BAKE_TARGET` | Corré `prep_bake.py` otra vez con ese grupo |
| **Irradiancia quemada** (blanco plano cerca de la lámpara) | El PNG de 8 bits corta todo lo que pasa de 1.0 | Bajá todas las luces a la mitad, re-horneá y poné `IRR_SCALE = 2` en `src/three/materials/baked.ts` |
| La textura sale con **otros colores u otro contraste** | Se guardó con "Save As Render" | Guardá con esa opción desactivada, o usá `ACTION = "save"` |
| **Ruido** en la irradiancia | Pocos samples | Horneá al doble (ya es el default), con 512–1024 samples. El downsample de sharp limpia el resto |
| **Texels negros** sueltos | Normales invertidas, o un objeto oculto en el render | En Edit Mode: `Shift+N` (recalcular normales). En el Outliner, revisá el ícono de cámara |
| `assets:glb`: **"has no TEXCOORD_1"** | El export no llevó BakeUV | Revisá que el objeto tenga `[UVMap, BakeUV]` y que en el export esté **UVs ✓** |
| `assets:glb`: **"has child nodes"** | Un mesh horneado tiene hijos | Corré `export_prep.py` en la copia: desemparenta a los hijos |
| La consola web dice **"missing node"** | Un nombre con `.001`, mayúsculas o espacios | Renombralo (`F2`) y re-exportá |
| La **tapa del VCR** gira desde el centro | El origen no estaba en la bisagra | Arreglalo con Set Origin (sección 4) |
| Con la lámpara apagada **no cambia nada** en un grupo | Ese grupo no tiene `irrB`, o el `irrB` salió igual al `irrA` | Horneá `irrB` con la lámpara oculta del render (paso 5 de la sección 6.3) |
| La etiqueta de un VHS sale **espejada o al revés** | La U o la V del plano `tape_NN_label` están invertidas | U a lo largo del texto, V de arriba (0) hacia abajo (1); o borrá el plano y dejá que la web ponga la suya |
| El **cuerpo del bloc** (o la taza, o el reloj) se ve gris o metálico en la web | Con `Materials: Placeholder`, los objetos en tiempo real no llevan color | Exportá con **Materials: Export** (las imágenes siguen en None). El resto de la escena no cambia, porque usa el bake |
| Las **agujas del reloj** giran desde la punta o se salen de la esfera | El origen de la aguja no está en el centro de la esfera | Arreglalo con Set Origin (sección 4, "Agujas del reloj"); `export_prep.py` avisa si el origen queda a más de 3 cm |
| La consola web dice **"must be a child of coffee_mug / wall_clock / cd_player / calculator"** | El café, una aguja, una pieza del CD o de la calculadora quedaron sueltos | Emparentalos (`Ctrl+P → Object (Keep Transform)`) y volvé a exportar |
| La **tapa del CD** gira desde el centro o se hunde en el cuerpo | El origen de `cd_lid` no está en la bisagra de atrás | Set Origin sobre el borde de atrás (sección 4, "Reproductor de CD") |
| La **etiqueta del CD** sale estirada o cortada | `cd_disc` no tiene UV proyectadas desde arriba | UV → Project from View (Bounds) en vista superior |
| La **calculadora** se levanta de canto o de espaldas | Se aplicó la rotación (o se modeló acostada) | Modelala parada (teclado hacia −Y) y acostala rotando el objeto, sin `Ctrl+A → Rotation` |
| Las **teclas de la PC** salen dobles | El teclado trae las teclas modeladas y la web pone las suyas | Custom property `keycaps = 0` en `pc_keyboard` (o dejalo plano arriba) |

---

## 10. Checklist final de M3

- [ ] `export_prep.py` termina en **CONTRACT OK**.
- [ ] `npm run assets` termina sin `ERROR` y con las texturas dentro del presupuesto.
- [ ] En `npm run dev` aparece `[contract] … satisfies the naming contract` y `__renderInfo()` dice `mode: "baked"`.
- [ ] No hay costuras ni texels negros, y los metales no salen negros.
- [ ] La tapa del VCR gira sobre la bisagra y las cintas salen del estante.
- [ ] `npm run test:e2e` pasa.
