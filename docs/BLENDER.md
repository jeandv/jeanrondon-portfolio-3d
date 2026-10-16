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
| 8 VHS | `tape_01` … `tape_08` | 18.7 × 10.2 × 2.5 cm cada uno. Cada uno es un objeto propio, **no** un Alt+D |
| Bloc | `notepad` + `notepad_page` | La página es un plano con UV 0..1 y es **hija** del bloc |
| Polaroid | `polaroid_photo` | Un plano con UV 0..1 para la foto |
| Ventana | marco + `window_glass` | El vidrio es un plano dentro del hueco |
| Anclas | `anchor_notepad_up`, `anchor_city` | **Add → Empty → Plain Axes**. `anchor_city` va unos 1 m detrás del vidrio, en el centro de la ciudad |

### Pantallas (`tv_screen`, `pc_screen`, `notepad_page`, `polaroid_photo`)

1. **Add → Mesh → Plane** y escalalo al tamaño de la pantalla. El plano por defecto ya trae UV 0..1, **no lo desenvuelvas**.
2. Rotalo **90° en X** (`R X 90`). Así queda parado y mirando hacia −Y, o sea hacia la cámara. Con esa rotación la imagen sale derecha en la web.
3. No le pongas `bake`. La web le pone su propia textura en tiempo real.

### Origen de la tapa del VCR

1. En Edit Mode seleccioná el borde de la bisagra.
2. `Shift+S → Cursor to Selected`.
3. Volvé a Object Mode y hacé **Object → Set Origin → Origin to 3D Cursor**.

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

Opcionales: `static_floor`, `static_shelf` y `lamp_arm`. Si no existen, no pasa nada.

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
| Lámpara | **Add → Light → Spot** adentro de `lamp_head`, color ≈ `#ffb46b` (2700 K) |
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

**Paso 5: revisar.** En el **Image Editor** abrí las dos imágenes. No tiene que haber texels negros ni costuras raras (mirá la sección 9).

Repetí los pasos para `room`, `floor`, `gear`, `shelf` y `props`.

> Si preferís los botones: **Render Properties → Bake → Bake** usa los ajustes que dejó el script. Después guardás con **Image → Save As** (`//bake/<grupo>_<pase>.png`) y **"Save As Render" desactivado**. Con eso activado, AgX y el exposure quedan metidos en la textura.

### 6.4 Desde la terminal (opcional)

```bash
blender blender/room_bake.blend --background --python blender/scripts/prep_bake.py -- \
  --group desk --pass irrA --use tagged --action bake
```

Opciones: `--group`, `--pass albedo|irrA`, `--size N`, `--use selected|tagged`, `--action prep|bake|save`, `--no-settings` y `--keep-metallic`.

---

## 7. La copia de export

`export_prep.py` reescribe la escena. Por eso **solo corre en una copia** cuyo nombre termina en `_export.blend`.

1. **File → Save Copy…** → `blender/room_export.blend`. Después abrí esa copia con **File → Open**.
2. En Scripting abrí `blender/scripts/export_prep.py` y dale **Run Script**. El script hace esto:
   - aplica los modificadores;
   - une los estáticos de cada grupo en `static_<grupo>`;
   - deja separados los nodos con nombre del contrato;
   - desemparenta a los hijos de los meshes (salvo `notepad_page`);
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
| `assets:textures` | PNG → WebP (albedo q85, irradiancia lanczos 2K→1K q92) más las versiones `_m` para teléfono | `desktop set: X MiB of 3.00 MiB budget (OK)` |
| `assets:manifest` | Bytes reales para la barra de carga | `src/assets/sizes.json` actualizado |

La auditoría de `assets:glb` falla en cualquiera de estos casos:

- un mesh horneado no tiene `TEXCOORD_1` (BakeUV);
- aparece `EXT_mesh_gpu_instancing`, o hay meshes horneados compartidos entre nodos;
- un nodo horneado tiene hijos;
- el contrato (`src/three/contract.ts`) no se cumple.

Además guarda la bisagra de `vcr_flap` como extra `hinge`. La compresión mueve el origen de los nodos, y así la tapa sigue girando sobre la bisagra.

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
- pasá el mouse por el TV, la PC y las cintas: tienen que brillar un poco (lightMap × 1.2).

> ¿Querés probar el pipeline sin Blender? `npm run assets:fake-bake` genera bakes sintéticos para el greybox. Después corré `npm run assets:textures && npm run assets:manifest` y la web pasa a modo horneado. Para deshacerlo, corré `node scripts/fake-bake.mjs --clean`.

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
| El **cuerpo del bloc** se ve gris o metálico en la web | Con `Materials: Placeholder`, los objetos en tiempo real no llevan color | Exportá con **Materials: Export** (las imágenes siguen en None). El resto de la escena no cambia, porque usa el bake |

---

## 10. Checklist final de M3

- [ ] `export_prep.py` termina en **CONTRACT OK**.
- [ ] `npm run assets` termina sin `ERROR` y con las texturas dentro del presupuesto.
- [ ] En `npm run dev` aparece `[contract] … satisfies the naming contract` y `__renderInfo()` dice `mode: "baked"`.
- [ ] No hay costuras ni texels negros, y los metales no salen negros.
- [ ] La tapa del VCR gira sobre la bisagra y las cintas salen del estante.
- [ ] `npm run test:e2e` pasa.
