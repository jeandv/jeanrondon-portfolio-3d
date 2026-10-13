# Plan: Portafolio 3D "Room" — MVP inspirado en felixrieseberg.com

## Context
Jean quiere un portafolio web 3D propio que tome como referencia directa felixrieseberg.com: un cuarto de noche con
escritorio, televisor CRT, VCR, una PC vieja y una ventana con lluvia. La ambientación, los movimientos, las "físicas"
y las fuentes pueden ser las mismas. El objetivo es un MVP navegable y performante, con contenido real
(About / Work / Contact), en un **proyecto nuevo**.

**Decisiones del usuario:**
- Stack: React Three Fiber.
- Assets: Blender con iluminación horneada (bake).
- Ventana: una ciudad genérica de noche.

---

## 1. Lo que descubrí del sitio de referencia (ingeniería inversa)

**Stack**
- Three.js 0.169 vanilla con ES modules, dentro de un theme de Ghost CMS. Los assets pesados se sirven desde Cloudflare Pages.

**No usa ningún motor de física.** Lo que se siente como "física" es esto:
- OrbitControls con:
  - `dampingFactor .06`
  - pan desactivado
  - distancia `.3–2.6`
  - ángulo polar `.95–1.72`
  - azimut `-1.3–1.2`
  - `rotateSpeed .5`
- Vuelos de cámara con easing cúbico: 1.2 s, o 1.9 s con arco cuando va hacia la PC.
- Resortes simples (la tapa del VCR) y lerps.

**El look sale de Blender, no del código.**
- Cada grupo de objetos tiene su iluminación horneada: `*_albedo` + `*_irrA/irrB`, aplicada como lightMap (dos estados: lámpara prendida y apagada).
- Los modelos son CC0 de Poly Haven (texturas 1k).
- Algunas texturas se generan en canvas: grano del plástico, roble, yeso.

**Renderer**
- Tone mapping `AgXToneMapping` con exposure 1.8.
- MSAA 4 en un target HalfFloat.
- DPR máximo de 2 (1.5 en teléfonos).
- Sombras estáticas (`autoUpdate=false`).

**Post-procesado**
- Bloom con strength .28, radius .5, threshold .88.
- Un shader "Grade" con:
  - distorsión barrel .02
  - aberración cromática lateral
  - viñeta `1-r²·.8`
  - grano más fuerte en las sombras
- No usa SSAO ni profundidad de campo (DOF).

**Cámara**
- FOV 32, ajustado según el aspect ratio: `2·atan(max(tan16°, min(.62, .29/aspect)))`.
- Un encuadre por página (`FRAMES`: target, dirección, distancia), más anclas que encuadran el bounding box de un mesh.

**Ventana**
- Una foto nocturna puesta sobre un cilindro a 30 m, con parallax en capas (`depth.png`).
- Una máscara de ventanas de edificios que se prenden y se apagan.
- Lluvia hecha en shader, más niebla. Todo corre en la GPU.

**Navegación por hash**
- Home: plano general del escritorio. El CRT muestra "CLICK TO ENTER / ENTER MUTED", que funciona como gate para el audio.
- Work: la cámara vuela al TV y flota un **bloc amarillo** (fuente Caveat). Cada VHS es un "canal" con un proyecto o una empresa.
- About: la cámara vuela a la **PC vieja**, que muestra un pager de fósforo verde y una polaroid al lado.
- Online: un BBS "dial-up" en la PC.
- Posts: teletexto en el TV.
- Atajos de teclado: C (PC), M (CD), Z (zoom al TV), 1–6 (botones del monitor), ESC (volver).

**Loader**
- Primero se muestra un `still.jpg` del home.
- Encima, sobre el TV, un OSD de VCR "LOADING ▮▮▮ %" dibujado en perspectiva, que cuenta bytes descargados.
- Al terminar, el canvas aparece con un fade-in de 1.2 s.

**Audio**
- Web Audio API: master → DynamicsCompressor (-16 dB, ratio 2.5, knee 12) → reverb con impulse response generado.

**Accesibilidad / SEO**
- Todo el contenido existe como HTML real.
- Respeta `prefers-reduced-motion`, pausa en `visibilitychange`, tiene modo teléfono y un fallback si no hay WebGL.

**Fuentes**
- Archivo variable (wdth/wght): nav y marca
- VT323: OSD del CRT
- Caveat 600: bloc
- JetBrains Mono: terminal
- Courier Prime, Newsreader, Lato y Pixelify: se postergan

**Tokens de UI**
- Colores:
  - `--ground:#07080d`
  - `--ink:#efe9dc`
  - `--muted:#a29fae`
  - `--panel:rgba(14,13,19,.66)`
  - `--line:rgba(255,255,255,.14)`
  - `--accent:#ffb867`
- Nav en mayúsculas con tracking; la página activa es una pill clara.
- Abajo a la derecha, pills translúcidas: CREDITS y SOUND OFF.

---

## 2. Decisiones de arquitectura

1. **Sin motor de física.** Uso los `OrbitControls` de drei con los límites de la referencia, más un fly-to propio (Bézier + easeInOutCubic). Los resortes y el damping salen de `maath`.
2. **Iluminación horneada con `MeshBasicMaterial` + `lightMap`** en UV1, con `lightMapIntensity = Math.PI`. En el shader de three, eso da exactamente albedo × irradiancia. Es barato y se ve igual en todos los dispositivos.
3. **Blender y el código se comunican por un contrato de nombres + custom props.** Los custom props de Blender llegan como `userData`. No uso gltfjsx, porque se rompe con cada re-export.
4. **Una sola fuente de contenido** (`src/content/*.ts`). Alimenta las pantallas en canvas, los tooltips y una capa HTML que se prerenderiza en el build (SEO).
5. **La ventana usa una foto CC0** (Openverse filtrado por CC0/PDM, o Wikimedia Commons) cortada en capas, sin landmarks. El cielo es un gradiente procedural.

---

## 3. Stack (versiones a fijar; re-verificar con `npm view` en M0)

| Paquete | Versión | Nota |
|---|---|---|
| react / react-dom | 19.3.x | R3F 9.8 pide `<19.4` |
| three / @types/three | **~0.186.1** | Fijar con `~`: postprocessing 6.39 pide `<0.187` |
| @react-three/fiber · drei · postprocessing | 9.8.1 · 10.7.9 · 3.1.3 | |
| postprocessing · zustand · maath | 6.39.5 · 5.0.15 · 0.10.8 | |
| @fontsource-variable/archivo (wdth) · @fontsource/vt323 · @fontsource-variable/caveat · @fontsource-variable/jetbrains-mono | 5.x | Fuentes self-hosted |
| vite · @vitejs/plugin-react · typescript | 8.3 · 6.1 · ~6.0 | Node 24 LTS (`.nvmrc`) |
| vitest · @playwright/test · r3f-perf · leva | dev | |
| @gltf-transform/cli · sharp | dev | Pipeline de assets |

Para crear el proyecto: `npm create vite@latest jean-portfolio-3d -- --template react-ts`.
Ubicación propuesta: `C:\Users\R4YB4\Documents\dev\jean-portfolio-3d`.

---

## 4. Estructura del proyecto

```
jean-portfolio-3d/
├─ blender/                      # no se despliega (.blend en Git LFS o en un drive)
│  ├─ room_bake.blend  room_export.blend  scripts/{prep_bake,export_prep}.py  export/room.raw.glb
├─ scripts/  optimize-glb.mjs  textures.mjs  asset-manifest.mjs  capture-still.mjs  prerender.mjs
├─ public/   still.jpg  og.jpg  favicon.svg  robots.txt  sitemap.xml  _headers
├─ src/
│  ├─ content/   types.ts  profile.ts  work.ts  links.ts  site.ts
│  ├─ state/     store.ts (Zustand)  router.ts (hash)
│  ├─ three/
│  │  ├─ Experience.tsx  Scene.tsx  Lights.tsx  Room.tsx  contract.ts
│  │  ├─ materials/  baked.ts  crtScreen.ts  cityLayer.ts  rain.ts  skyGradient.ts
│  │  ├─ objects/    Tv  Vcr  Pc  Notepad  Tapes  Polaroid  WindowView (.tsx)
│  │  ├─ camera/     frames.ts  flight.ts  CameraRig.tsx
│  │  ├─ interaction/ hotspots.ts  Hotspot.tsx
│  │  └─ post/       PostFX.tsx  LensEffect.ts  FilmEffect.ts
│  ├─ screens/   fonts.ts  CanvasScreen.ts  hit.ts  channels/{tv,pc,notepad}/*
│  ├─ ui/        Loader  Gate  Tooltip  HintBar  SoundToggle  RouteSheet  Fallback (.tsx)
│  ├─ seo/       SeoContent.tsx  entry-server.tsx
│  ├─ audio/     engine.ts  synth.ts
│  └─ hooks/     useKeyboard  useReducedMotion  useVisibility  useDeviceProfile
└─ e2e/smoke.spec.ts
```

`Experience` se carga con `React.lazy`, así three, R3F y el post-procesado van en un chunk aparte y el still pinta primero.
Los assets se importan con `?url` para que salgan con hash y se puedan cachear como immutable.

---

## 5. Arquitectura en runtime

### 5.1 Arranque (máquina de estados)
- Fases: `loading → gate → entering → live`, o `fallback` si no hay WebGL2.
- Para llegar a `gate` tienen que cumplirse las cuatro cosas: assets cargados, `document.fonts.load()` resuelto, `<Preload all/>` terminado (compila shaders) y 2 frames ya renderizados.
- El progreso cuenta bytes reales (`sizes.json`) y nunca retrocede.
- El click en el gate desbloquea el `AudioContext`, hace el fade del canvas (1.2 s) y vuela a la ruta del deep-link si hay una.

### 5.2 Estado y routing
- El store de Zustand guarda: `phase`, `progress`, `route {page, tape?}`, `zoom`, `hovered`, `flying`, `muted`, `reducedMotion`, `device {phone, dpr, msaa, texSuffix}`.
- Los valores que cambian en cada frame viven en refs y se leen en `useFrame` con `getState()`. Nunca disparan un re-render.
- Rutas:
  - `#home`, `#about`, `#work`, `#work/<tapeId>` y `#online`.
  - `#contact` y `#github` llevan a `online`.
  - Cualquier otra cosa lleva a `home`.
  - Escucho `hashchange`, así back/forward también vuelan la cámara.
- **Gotcha:** ningún elemento del DOM puede tener `id="work"` o similar (el browser scrollea hasta él). Uso el prefijo `s-`.
- El atributo `body[data-route]` controla qué pill del nav está activa, solo con CSS.

### 5.3 Cámara (`camera/frames.ts`, `flight.ts`, `CameraRig.tsx`)
- Copio `FRAMES` (home, panel, work) y `fovForAspect` tal cual de la referencia. Además defino `ANCHORS`:
  - `pc`: dir `[.18,.08,1]`, fit 1.25, 1900 ms, arco .35
  - `tv`: fit 1.15, 1200 ms
- Mapa de rutas a vistas: `ROUTE_VIEW = {home:'home', work:'work', about:'pc', online:'pc'}`. El zoom al TV usa `ANCHORS.tv`.
- `<OrbitControls>` usa los mismos valores de la referencia.
- Pasos del vuelo:
  1. Vaciar el damping que quedó.
  2. Poner `controls.enabled=false`.
  3. Mover la cámara por una Bézier cuadrática con un waypoint de arco, usando easeInOutCubic.
  4. Al llegar, copiar el target y volver a habilitar los controles.
- Si cambia la ruta en pleno vuelo, el vuelo se re-apunta desde la posición interpolada.
- Con reduced motion, el vuelo dura 0 (corte directo).
- En las anclas pc y tv, los límites se cierran a ±0.35 rad de azimut y ±0.25 de polar, para no poder orbitar por detrás del monitor.

### 5.4 Interacción
- `Hotspot` agrega una caja proxy invisible (vía `createPortal`) a cada nodo interactivo del GLB.
- Hotspots:
  - `pc_*` → USE COMPUTER → `#about`
  - `tv_body` → WATCH TV → zoom al TV
  - `tape_NN` → PLAY {title} → `#work/<id>`
  - `notepad` → READ / PUT DOWN NOTEPAD
  - click en el vacío (fuera de home) → BACK TO THE DESK
- Guard de arrastre: si `e.delta > 5px`, el click se ignora.
- El tooltip es DOM y se mueve con `transform` directo (sin render de React).
- En hover, el material clonado sube `lightMapIntensity` a π×1.2 y suena un tick.
- Para los clicks dentro de una pantalla, `e.uv` se convierte a píxeles del canvas y se compara con los hit-rects del canal activo.
- Teclado:
  - `C` → about
  - `Z` → zoom al TV
  - `Esc` → salir del zoom, y después ir a home
  - `1–8` en work → tape N
  - flechas / Enter / Space → van al canal activo
  - Se ignoran los atajos si hay modificadores o si el foco está en un input.

### 5.5 Pantallas (canales Canvas2D)
- Cada canal implementa `interface Channel { id; fps; enter?; draw(g,t,ctx); key?; hits? }`.
- `CanvasScreen` maneja la `CanvasTexture` (SRGB, sin mipmaps). Redibuja solo a los fps del canal o cuando algo cambia, y pasa a 2 fps si la pantalla está fuera de cuadro. Entre canales mete una transición de estática de 280 ms.
- Tamaños: TV 640×480, PC 800×600, página del bloc 512×832.
- **Canales del MVP:**
  - TV:
    - `boot`: OSD azul `#0000aa` "CH 03", en VT323
    - `home`: title card con nombre y rol
    - `insertTape`
    - `tape/<id>`: título, años, rol, bullets que aparecen uno por uno, stack, y bandas de tracking VHS al entrar
    - `static`
  - PC:
    - `idle` `C:\>_`
    - `about`: pager de fósforo verde `#33ff66` que tipea a 60 caracteres/s, con `-- MORE (45%) --`
    - `contact`: menú `[1] EMAIL [2] GITHUB [3] LINKEDIN`
  - Bloc:
    - `work`: papel `#fdf3a7`, renglones `#9cc3e6` y margen rojo, en Caveat 600. Muestra Companies y Projects; cada línea es clickeable y la cinta activa aparece en un círculo.
- Shader `crtScreen.ts`: bulge, scanlines, máscara RGB, flicker de 1–2%, viñeta, y `uBoost 1.4` para que el blanco del CRT haga bloom.

### 5.6 Escena, materiales y luces
- Canvas: `<Canvas flat dpr={device.dpr} gl={{antialias:false, powerPreference:'high-performance', stencil:false}} camera={{fov:32, near:.02, far:80}}>` con fondo `#07080d`. Sin shadow maps.
- `baked.ts`: a cada mesh con `userData.bake` le pongo `MeshBasicMaterial({map: albedo, lightMap: irrA, lightMapIntensity: π·IRR_SCALE})`. Texturas con `channel=1`, `flipY=false` y SRGB. Los meshes interactivos usan un material clonado.
- Los objetos que se mueven (el bloc flotante y la polaroid) usan `MeshStandardMaterial` con luces en tiempo real:
  - Hemisphere `#3a4a7a/#2a1a0c` .14
  - Point `#ffcf9a` .3 en (-.7, 1.35, 1.3)
  - Directional "luna" azulada
- El bloc flota hacia `anchor_notepad_up` con `maath easing.damp3/dampQ` (smoothTime .35) y un leve vaivén.
- La tapa del VCR es un resorte `v += (-k(x−x₀) − c·v)·dt`, con k=120 y c=12.
- En dev, `contract.ts` loguea los nodos requeridos que falten en el GLB.

### 5.7 Ventana (`WindowView.tsx`)
- Capas de cilindro abierto (120°, `BackSide`) centradas en `anchor_city`:
  - cielo con gradiente a r=40
  - `city_far.webp` (4096×1536, con alpha) a r=30
  - `city_near.webp` (opcional) a r=18
- `cityLayer` sube las luces con `c *= 1+2.5·smoothstep(.75,1,luma)` para que hagan bloom.
- Lluvia: 2 planos con shader, a 1 m y a 5 m del vidrio. Viento .08 rad, color `#9fb4d9`, blending aditivo.
- Más una niebla y un vidrio `#8fa3c7` con opacidad .06.
- Stretch goal: máscara `city_windows.webp` para ventanas que se prenden y se apagan.

### 5.8 Post-procesado (`post/PostFX.tsx`)
```tsx
<EffectComposer multisampling={device.msaa} frameBufferType={HalfFloatType}>
  <LensEffect barrel={0.02} ca={0.008} />    {/* CONVOLUTION: barrel + aberración cromática */}
  <Bloom mipmapBlur intensity={0.45} luminanceThreshold={0.88} luminanceSmoothing={0.08} radius={0.5} />
  <FilmEffect vignette={0.8} grain={0.009} exposure={1.8} />   {/* viñeta + grano en sombras + guard NaN */}
  <ToneMapping mode={ToneMappingMode.AGX} />
</EffectComposer>
```
- El "Grade" de la referencia se parte en dos efectos (Lens y Film), porque un efecto de convolución en un pass mergeado lee el input original.
- La escala del Bloom de pmndrs no es la misma que la de UnrealBloom: la `intensity` se calibra a ojo.

### 5.9 Audio (`audio/engine.ts`, 0 KB de archivos)
- `AudioContext` creado en el gate. Master → Compressor(-16, 2.5, 12) → destino.
- Lluvia: ruido generado → highpass 400 Hz → lowpass 5 kHz, más "gotas" con bandpass y un rumble grave.
- Sonidos sintetizados: tick de hover, click, golpe al meter la cinta, encendido del CRT con estática.
- El mute hace un ramp con `setTargetAtTime` y se recuerda en `localStorage`. "ENTER MUTED" arranca con gain 0.
- Con la pestaña oculta: `ctx.suspend()` y `frameloop='never'`.

### 5.10 HTML / SEO / accesibilidad
- `SeoContent.tsx` se prerenderiza en el build (`vite build --ssr` + `prerender.mjs`). Genera h1, bio, tapes como `<a href="#work/<id>">`, contacto, title/meta, OG (`og.jpg`) y JSON-LD `Person`.
- Si hay WebGL, el contenido queda sr-only. Sin JS o sin WebGL, ese mismo HTML es el sitio legible. También existe `?lite`.
- El canvas lleva `aria-hidden`. Una región `aria-live` anuncia "Viewing: Work" y el foco pasa al h2 de la sección.
- Reduced motion: cortes de cámara, grano estático, lluvia a 0.4×, tipeo instantáneo y fade de 0.2 s.
- Modo teléfono (`pointer:coarse` y ancho ≤820): DPR `[1,1.5]`, MSAA 0, texturas `_m`, `RouteSheet` (bottom sheet con el contenido) y sin hint bar.

---

## 6. Pipeline de Blender (nivel principiante)

**Reglas de la escena**
- Blender 4.5 LTS o 5.x, unidades métricas a escala 1, export con +Y up.
- El centro del TV va en ≈ `(0.04, 1.1, 0.02)`, con la cámara mirando hacia −Z. Así los `FRAMES` de la referencia sirven sin cambios.
- La ventana va arriba a la izquierda del escritorio.
- Para previsualizar: View Transform AgX con exposure +0.85 (equivale al 1.8 de la web).

**Assets de Poly Haven** (descarga manual gratis en 1k `.blend` + Append; el add-on oficial es pago):
- Piezas principales: `Television_01`, `desk_lamp_arm_01`, `WoodenTable_01` o `metal_office_desk`, `painted_wooden_chair_01`, `wooden_bookshelf_worn`.
- Props: `cassette_player`, `clipboard`, `binder_notebook`, `office_notepads`, `round_spectacles`, `stationery_supplies`, `potted_plant_02/04`, `wall_clock`, picture frames, `Camera_01`.

**Modelado propio** (box modeling + Bevel, buenos ejercicios para arrancar):
- La PC vieja, con un `pc_screen` metido en el monitor.
- El VCR, con su `vcr_flap` (origen en la bisagra).
- 8 VHS de 18.7×10.2×2.5 cm.
- El bloc, con `notepad_page`.
- La polaroid.
- El marco de la ventana.

Toda la escena debe quedar en ≤300k triángulos (Decimate → Collapse).

**Contrato de nombres** (snake_case, sin puntos):

| Nodo | Custom prop | Nota |
|---|---|---|
| `static_<group>` | `bake=<group>` | Estáticos unidos por grupo en la copia de export |
| `tv_body` `vcr_body` `pc_body` `pc_monitor` `pc_keyboard` `lamp_head` | `bake=gear` | |
| `vcr_flap` | `bake=gear` | Origen en la bisagra, rota en X local |
| `tape_01…08` | `bake=shelf`, `slot=N` | `slot` mapea a `work.ts` |
| `notepad` (+ `notepad_page`) | `bake=props` | La página tiene UV0 0..1 |
| `tv_screen` `pc_screen` `polaroid_photo` `window_glass` | — | No se hornean; UV0 0..1 |
| `anchor_notepad_up` `anchor_city` | Empty | Poses ubicadas en Blender |

**Grupos de bake**

| Grupo | Albedo | Irradiancia |
|---|---|---|
| room | 2048 | 1024 |
| floor | 1024 | 1024 |
| desk | 2048 | 1024 |
| gear | 2048 | 1024 |
| shelf | 1024 | 512 |
| props | 1024 | 512 |

**Pasos del bake** (Cycles, GPU)
1. **Luces del bake:**
   - World azul oscuro, strength 0.05–0.1.
   - Sun "luna" `#9fb4ff` ≈ .3.
   - Spot para la lámpara, 2700 K.
   - Emisivo azul en `tv_screen` (~3) y verde en `pc_screen` (~1.5).
   - Un plano emisivo de "resplandor de ciudad" afuera de la ventana.
   - Clamp Indirect 10.
2. **Por grupo:**
   - Correr `prep_bake.py`. Asigna `bake=<group>`, deja los UV en orden `[UVMap, BakeUV]` (BakeUV queda activo y UVMap como render) y crea el nodo `BAKE_TARGET`.
   - Después: Smart UV Project (margen .003) → Pack Islands (margen .01).
   - Los materiales compartidos se pasan a single-user.
   - Los metales se ponen con Metallic 0 en la copia de bake, si no salen negros.
3. **Albedo:** Diffuse, solo Color, 16 samples, margen Extend 16 px → `<group>_albedo.png`.
4. **Irradiancia:** Diffuse, Direct+Indirect sin Color, 512–1024 samples, a 2K (sharp la baja a 1K, eso limpia el ruido). Si el valor pasa de 1.0, bajar las luces a la mitad y poner `IRR_SCALE=2`.
5. **Copia de export:** `export_prep.py` aplica los modificadores, une los estáticos por grupo y deja un único material `M_<group>`.
6. **Export glTF:**
   - formato `.glb`
   - Custom Properties ON
   - +Y Up
   - Materials: Placeholder
   - Images: None
   - sin compresión ni animación

**Optimización.** Los defaults de `optimize` rompen el contrato (instancian las cintas y borran los UV), así que van estos flags:
```
npx gltf-transform optimize blender/export/room.raw.glb src/assets/models/room.glb \
  --compress meshopt --texture-compress false --flatten false --join false \
  --instance false --palette false --simplify false --prune-attributes false
```
`textures.mjs` (con sharp):
- albedo → webp q85
- irradiancia: lanczos de 2K→1K → webp q92
- además, versiones `_m` a la mitad para teléfonos

KTX2 queda para después.

**Ciudad:** un skyline nocturno CC0 sin landmarks, recortado a ~3:1 de 4096 px, con el cielo en alpha → `city_far.webp`. El `city_near.webp` es opcional.

---

## 7. Presupuesto de performance

| Ítem | Meta |
|---|---|
| Descarga inicial | **≤ 8 MB** (tope 10): JS ≤420 KB gz, fuentes ≤300 KB, still ≤180 KB, GLB ≤1.5 MB, bakes ≤3 MB, ciudad ≤0.9 MB |
| Draw calls / triángulos | ≤80 (tope 150) / ≤300k |
| Memoria GPU de texturas | ≤120 MB desktop, ≤60 MB teléfono |
| FPS | 60 en una laptop media (Iris Xe / M1) con DPR ≤2; post ≤3 ms a 1080p; ≥30 en un iPhone 12 / Pixel 6 |
| Carga | LCP (`still.jpg`, `fetchpriority=high`) <2 s en 4G; 3D listo <6 s |
| Lighthouse | Desktop: Perf ≥85, A11y ≥95, BP ≥95, SEO 100. Mobile: Perf ≥65 |

---

## 8. Deploy (Cloudflare Pages)
- Repo conectado: `npm run build` → `dist`, Node 24, con preview por branch.
- Script de build: `tsc -b && vite build && vite build --ssr src/seo/entry-server.tsx --outDir dist-ssr && node scripts/prerender.mjs`.
- `public/_headers`:
  - `/assets/*` immutable por 1 año
  - `*.glb` como `model/gltf-binary`
  - `index.html` con `no-cache`
- Commits en formato conventional commits, sin atribución de IA.

---

## 9. Milestones (≈18–25 días de foco)

| # | Entregable | Criterio de aceptación |
|---|---|---|
| **M0** (0.5–1 d) | Scaffold Vite + R3F + TS strict + ESLint, cubo + OrbitControls, r3f-perf en dev, Pages conectado | `npm run dev` a 60 fps; un push a `main` despliega |
| **M1** (2–3 d) | **Greybox en Blender** con los nombres y anclas del contrato, pasado por el pipeline; `frames`, `CameraRig`, router, store, hotspots, tooltip, teclado, reduced motion | Todas las rutas y alias resuelven; back/forward vuelan; re-apuntar en pleno vuelo no salta; ESC siempre vuelve; arrastrar nunca hace click; en 390×844 se ve el TV entero |
| **M2** (3–4 d) | Contenido tipado, fuentes, `CanvasScreen` + todos los canales, shader CRT, bloc flotante, resorte del VCR, hit-rects, prerender, pills del nav | Editar `work.ts` actualiza el bloc, el TV, los tooltips y `dist/index.html`; los links de contacto andan con teclado y mouse; ningún canvas dibuja con fuente fallback |
| **M3** (6–10 d) | **Arte en Blender + bake** (acá se va el tiempo de aprendizaje) | El contrato pasa; no hay costuras ni texels negros; `inspect` muestra solo TEXCOORD_0/1 y sin instancing; presupuestos cumplidos |
| **M4** (2–3 d) | Ventana, lluvia, post-procesado | Se ve parallax al orbitar; solo hacen bloom las luces de la calle y el blanco del CRT; el post cuesta ≤3 ms; comparación lado a lado con la referencia |
| **M5** (1–2 d) | `capture-still.mjs` (still + og + esquinas del TV), OSD de carga, gate, audio | El still es el LCP; el % nunca retrocede; ENTER MUTED no suena y el mute persiste; con la pestaña oculta se suspende |
| **M6** (2 d) | Hardening y lanzamiento | Metas de Lighthouse cumplidas; fallback sin WebGL legible; probado en Chrome/Firefox/Safari/iOS/Android; ≤8 MB |

**Clave:** el código se arma contra el greybox de M1, así el arte de Blender nunca bloquea el desarrollo.

**Contenido:** `src/content/*.ts` arranca con placeholders tipados que completa Jean (bio, empresas, proyectos, links).
Opcional: migrar los datos desde `jeanrondon-portofolio` si existen.

---

## 10. Postergado (Fase 2+, en orden de prioridad)
1. Lámpara on/off: bake `irrB` + mezcla en `onBeforeCompile` + SpotLight.
2. Atlas de etiquetas en los lomos de los VHS.
3. Animación de insertar la cinta.
4. `PerformanceMonitor` + `AdaptiveDpr`.
5. Texturas KTX2.
6. Extras de la ciudad: parallax con depth map, ventanas que titilan, beacons, trenes, gotas en el vidrio.
7. Brillo del TV que siga el color del canal.
8. Posts en teletexto, con Courier Prime / Newsreader / Lato.
9. Animación del BBS dial-up.
10. Easter eggs: calculadora, CD player (`M`), café, reloj, teclado de la PC.
11. Créditos.
12. Reverb por convolución.
13. i18n es/en.
14. Analytics cookieless.

---

## 11. Verificación
1. **Rutas.** `npm run dev`, recorrer `/#home`, `#about`, `#work`, `#work/<id>`, `#online`, `#contact`, `#github` y `#nope`. En cada una revisar: encuadre, canal de la pantalla, hint bar, pill del nav y texto del `aria-live`.
2. **Interacción.** Clickear cada hotspot. Arrastrar y soltar encima de un hotspot (no debe pasar nada). Probar todos los atajos y el historial del browser.
3. **Emulación en DevTools.**
   - `prefers-reduced-motion` → tiene que haber cortes de cámara.
   - iPhone 12 / Pixel 7 → revisar FOV, DPR 1.5, MSAA off, texturas `_m` y el bottom sheet.
4. **Fallback.** Chrome con `--disable-webgl`, `?lite` y JS desactivado: el contenido tiene que leerse y navegarse.
5. **Performance.**
   - r3f-perf: calls, triángulos y ms de GPU mientras se orbita.
   - Spector.js: cantidad de passes de post.
   - `gltf-transform inspect`.
   - Pestaña Network sin cache: peso total.
6. **Build de producción.** `vite preview` sobre el build y Lighthouse desktop/mobile. El view-source tiene que mostrar h1, bio, tapes, links y JSON-LD. El build lo corre Jean o el CI de Pages, no yo, por la regla de no buildear después de cambios.
7. **Tests.**
   - vitest: `parseHash`, `fovForAspect`, Bézier/easing, distancia de fit-to-box e integridad del contenido (ids únicos, ≤8 tapes).
   - Playwright smoke: carga, nav, sin errores en consola, aparece el gate, `data-route` cambia con el hash.
8. **Producción.** Revisar los headers con `curl -I` y probar en un iOS real.

## 12. Riesgos principales
- **Curva de Blender:** se mitiga con el greybox primero.
- **Costuras en los lightmaps:** margen de 16 px y pack de .01.
- **Clipping de irradiancia:** `IRR_SCALE`; el grano además disimula el banding.
- **Materiales compartidos en Poly Haven:** pasarlos a single-user.
- **Metales que hornean negro:** Metallic 0 en la copia de bake.
- **Memoria en iOS:** texturas `_m` y DPR 1.5.
- **Fuentes que cargan tarde en el canvas:** todo dibujo espera a `fonts.ts`.
- **Defaults de gltf-transform:** usar los flags exactos.
- **Que three avance de versión:** mantener el pin `~0.186`.
