/**
 * Room GLB optimization (plan §6, `npm run assets:glb`).
 *
 *   node scripts/optimize-glb.mjs [input] [output]
 *     input   default blender/export/room.raw.glb   (Blender's glTF export)
 *     output  default src/assets/models/room.glb    (what the app loads)
 *
 * 1. Copies the input with the hinged nodes' origin (vcr_flap, the clock hands)
 *    recorded as the `hinge` extra: meshopt quantization moves a node's origin
 *    to its mesh bounds, and the flap must still swing around its hinge and the
 *    hands turn around the dial centre (HingeTurn reads it). Not `pivot`:
 *    three's GLTFLoader reserves that extra name.
 * 2. Runs `gltf-transform optimize` with the plan's flags (the defaults would
 *    instance the tapes, flatten/join named nodes, drop the unused TEXCOORD_1
 *    and merge materials), plus `--prune false`: the plan's flags alone prune
 *    empty leaf nodes, i.e. the anchor_* Empties of the contract.
 * 3. Prints `gltf-transform inspect` stats.
 * 4. Audits the result and fails (output untouched) when:
 *    - a baked node (`extras.bake`) has a primitive without TEXCOORD_1,
 *    - an unbaked screen/photo surface has no TEXCOORD_0,
 *    - EXT_mesh_gpu_instancing appears, or a baked mesh is shared by several
 *      nodes (instancing: they would share one lightmap island),
 *    - a baked node lost its mesh to an unnamed child (it had child nodes),
 *    - the naming contract (src/three/contract.ts, the same code the app
 *      runs) reports issues.
 *    Warns on extra TEXCOORD_n, non-snake_case names and the size/triangle budgets.
 * The optimized file is only copied to `output` once everything passes.
 */
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { NodeIO, Primitive } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = resolve(ROOT, 'node_modules/@gltf-transform/cli/bin/cli.js')
const DEFAULT_INPUT = 'blender/export/room.raw.glb'
const DEFAULT_OUTPUT = 'src/assets/models/room.glb'

/** plan §6, verbatim. */
export const PLAN_FLAGS = [
  '--compress', 'meshopt',
  '--texture-compress', 'false',
  '--flatten', 'false',
  '--join', 'false',
  '--instance', 'false',
  '--palette', 'false',
  '--simplify', 'false',
  '--prune-attributes', 'false',
]

/** Keeps the contract's anchor Empties (prune removes empty leaf nodes, extras or not). */
export const EXTRA_FLAGS = ['--prune', 'false']

/** plan §7: GLB ≤ 1.5 MB, scene ≤ 300k triangles. */
const GLB_BUDGET_BYTES = 1.5 * 1024 * 1024
const TRIANGLE_BUDGET = 300_000
const INSTANCING = 'EXT_mesh_gpu_instancing'
const SNAKE_CASE = /^[a-z0-9_]+$/
/** Mirror of REALTIME_NODES in src/three/materials/baked.ts (they keep their glTF material). */
const REALTIME_NODES = new Set(['notepad', 'notepad_page', 'polaroid_photo'])
/**
 * Nodes the app rotates around their authored origin (src/three/objects/motion.ts
 * HingeTurn): the VCR flap and the wall clock hands (origin on the dial centre).
 */
export const HINGED_NODES = new Set(['vcr_flap', 'clock_hour', 'clock_minute', 'clock_second'])
/** Mesh nodes that keep child nodes on purpose (the notepad page, the coffee, the clock hands). */
const EXPECTED_PARENTS = new Set(['notepad', 'coffee_mug', 'wall_clock'])

const rel = (path) => relative(ROOT, path).split(sep).join('/')
const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`
const round6 = (value) => Math.round(value * 1e6) / 1e6

function runCli(args, what) {
  console.log(`\n$ gltf-transform ${args.map((arg) => (isAbsolute(arg) ? basename(arg) : arg)).join(' ')}`)
  const result = spawnSync(process.execPath, [CLI, ...args], { stdio: 'inherit' })
  if (result.error) throw new Error(`could not start gltf-transform (${what}): ${result.error.message}`)
  if (result.status !== 0) throw new Error(`gltf-transform ${what} exited with code ${result.status}`)
}

async function sizeOf(path) {
  try {
    return (await stat(path)).size
  } catch {
    return -1
  }
}

async function createIO() {
  await MeshoptDecoder.ready
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
}

/** Contract checks shared with the app: src/three/contract.ts (Node 24 strips the types). */
async function loadContract() {
  try {
    return await import(pathToFileURL(resolve(ROOT, 'src/three/contract.ts')).href)
  } catch (error) {
    console.warn(`[optimize-glb] contract check skipped (could not import src/three/contract.ts: ${error.message})`)
    return null
  }
}

/** Duck-typed stand-in for a three.js root: validateContract() only needs getObjectByName, userData and parent.name. */
function contractRoot(document) {
  const byName = new Map()
  for (const node of document.getRoot().listNodes()) {
    const name = node.getName()
    const parent = node.getParentNode()
    if (!byName.has(name)) byName.set(name, { name, userData: node.getExtras() ?? {}, parent: parent ? { name: parent.getName() } : null })
  }
  return { getObjectByName: (name) => byName.get(name) }
}

/** Records the hinged nodes' authored origin (parent space, glTF Y-up) as `extras.hinge`. */
export function annotateHinges(document) {
  const annotated = []
  for (const node of document.getRoot().listNodes()) {
    if (!HINGED_NODES.has(node.getName()) || !node.getMesh()) continue
    node.setExtras({ ...node.getExtras(), hinge: node.getTranslation().map(round6) })
    annotated.push(node.getName())
  }
  return annotated
}

function triangleCount(primitive) {
  if (primitive.getMode() !== Primitive.Mode.TRIANGLES) return 0
  const indices = primitive.getIndices()
  const count = indices ? indices.getCount() : (primitive.getAttribute('POSITION')?.getCount() ?? 0)
  return Math.floor(count / 3)
}

/** Every problem in an optimized document (`source` = the input, for before/after checks). */
export function auditDocument(document, source, contract) {
  const errors = []
  const warnings = []
  const root = document.getRoot()

  const extensions = root.listExtensionsUsed().map((extension) => extension.extensionName)
  if (extensions.includes(INSTANCING)) errors.push(`${INSTANCING} is used (run optimize with --instance false)`)

  // Quantization moves the mesh of a node that has children into a new unnamed child node.
  const output = new Map(root.listNodes().map((node) => [node.getName(), node]))
  for (const before of source.getRoot().listNodes()) {
    const name = before.getName()
    const after = output.get(name)
    if (!name || !before.getMesh() || !after || after.getMesh()) continue
    const bake = before.getExtras()?.bake
    const message =
      `"${name}" has child nodes, so quantization moved its mesh into an unnamed child node` +
      (typeof bake === 'string' ? ' (it would lose its baked material and hover highlight)' : '')
    if (typeof bake === 'string' && !REALTIME_NODES.has(name)) {
      errors.push(`${message}. Unparent its children in the *_export.blend (blender/scripts/export_prep.py does it)`)
    } else if (!EXPECTED_PARENTS.has(name)) {
      warnings.push(message)
    }
  }

  const unbaked = new Set(contract?.UNBAKED_SURFACES ?? ['tv_screen', 'pc_screen', 'polaroid_photo', 'window_glass'])
  let triangles = 0
  let bakedNodes = 0
  for (const node of root.listNodes()) {
    const name = node.getName()
    const bake = node.getExtras()?.bake
    const mesh = node.getMesh()
    if (name && !SNAKE_CASE.test(name)) {
      warnings.push(`node "${name}" is not snake_case (three renames dots away; Blender's ".001" suffixes break the contract)`)
    }
    if (Object.hasOwn(node.getExtras() ?? {}, 'pivot')) {
      // three's GLTFLoader treats extras.pivot as its own pivot container and rewrites the transforms.
      const problem = `node "${name}" has a "pivot" custom property: three's GLTFLoader reserves that name; rename it`
      if (node.listChildren().length > 0) errors.push(problem)
      else warnings.push(problem)
    }
    if (!mesh) continue
    // Unnamed quantization children carry their parent's identity.
    const owner = name || `${node.getParentNode()?.getName() ?? '?'}/(mesh)`
    const users = mesh.listParents().filter((parent) => parent.propertyType === 'Node').length
    const baked = typeof bake === 'string'
    if (baked) bakedNodes++
    if (baked && users > 1) errors.push(`baked node "${owner}" shares its mesh with ${users - 1} other node(s) (instancing)`)
    else if (users > 1) warnings.push(`node "${owner}" shares its mesh with ${users - 1} other node(s)`)

    mesh.listPrimitives().forEach((primitive, index) => {
      triangles += triangleCount(primitive)
      const where = `"${owner}" primitive ${index}`
      const uvs = primitive.listSemantics().filter((semantic) => semantic.startsWith('TEXCOORD_'))
      if (baked && !uvs.includes('TEXCOORD_1')) {
        errors.push(`baked ${where} (bake=${bake}) has no TEXCOORD_1: the lightmap UV (BakeUV) was not exported`)
      }
      if (baked && !uvs.includes('TEXCOORD_0')) warnings.push(`baked ${where} has no TEXCOORD_0 (UVMap)`)
      if (unbaked.has(name) && !uvs.includes('TEXCOORD_0')) {
        errors.push(`screen/photo ${where} has no TEXCOORD_0 (needs UV0 0..1 for its runtime texture)`)
      }
      const extra = uvs.filter((semantic) => semantic !== 'TEXCOORD_0' && semantic !== 'TEXCOORD_1')
      if (extra.length > 0) warnings.push(`${where} has ${extra.join(', ')} (only TEXCOORD_0/1 are used)`)
    })
  }
  if (bakedNodes === 0) warnings.push('no node carries a `bake` extra: was "Include → Custom Properties" on in the export?')
  if (triangles > TRIANGLE_BUDGET) warnings.push(`${triangles} triangles, over the ${TRIANGLE_BUDGET} budget`)

  if (contract) {
    for (const issue of contract.validateContract(contractRoot(document))) {
      errors.push(`contract: ${issue.node}: ${issue.problem}`)
    }
  }
  return { errors, warnings, triangles, bakedNodes, extensions }
}

async function main() {
  const [inputArg = DEFAULT_INPUT, outputArg = DEFAULT_OUTPUT] = process.argv.slice(2)
  const input = resolve(ROOT, inputArg)
  const output = resolve(ROOT, outputArg)
  const inputBytes = await sizeOf(input)
  if (inputBytes < 0) {
    throw new Error(
      `${rel(input)} not found. Export it from the *_export.blend copy (File → Export → glTF 2.0, ` +
        'settings in docs/BLENDER.md), or pass another path: node scripts/optimize-glb.mjs <input> [output]',
    )
  }

  const id = randomUUID()
  const annotated = resolve(tmpdir(), `room-${id}.hinges.glb`)
  const optimized = resolve(tmpdir(), `room-${id}.opt.glb`)
  try {
    const io = await createIO()
    const source = await io.read(input)
    const hinges = annotateHinges(source)
    await io.write(annotated, source)
    console.log(`[optimize-glb] ${rel(input)}: ${kib(inputBytes)}, hinge recorded on: ${hinges.join(', ') || 'none'}`)

    runCli(['optimize', annotated, optimized, ...PLAN_FLAGS, ...EXTRA_FLAGS], 'optimize')
    runCli(['inspect', optimized], 'inspect')

    const document = await io.read(optimized)
    const audit = auditDocument(document, source, await loadContract())
    const outputBytes = await sizeOf(optimized)

    console.log('\n[optimize-glb] audit')
    console.log(`  extensions: ${audit.extensions.join(', ') || 'none'}`)
    console.log(`  baked nodes: ${audit.bakedNodes}, triangles: ${audit.triangles} (budget ${TRIANGLE_BUDGET})`)
    console.log(`  size: ${kib(inputBytes)} → ${kib(outputBytes)} (budget ${kib(GLB_BUDGET_BYTES)})`)
    if (outputBytes > GLB_BUDGET_BYTES) audit.warnings.push(`GLB is ${kib(outputBytes)}, over the ${kib(GLB_BUDGET_BYTES)} budget`)
    for (const warning of audit.warnings) console.warn(`  WARN  ${warning}`)
    for (const error of audit.errors) console.error(`  ERROR ${error}`)
    if (audit.errors.length > 0) {
      throw new Error(`${audit.errors.length} problem(s); ${rel(output)} was NOT replaced (fix the export, see docs/BLENDER.md)`)
    }

    await mkdir(dirname(output), { recursive: true })
    await copyFile(optimized, output)
    console.log(`\n[optimize-glb] wrote ${rel(output)} (${kib(outputBytes)}). Next: npm run assets:manifest (or npm run assets).`)
  } finally {
    await rm(annotated, { force: true })
    await rm(optimized, { force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    console.error(`[optimize-glb] FAILED: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  }
}
