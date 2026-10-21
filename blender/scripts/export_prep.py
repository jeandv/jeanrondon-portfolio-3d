"""
export_prep.py - turn a COPY of the baked scene into the web export layout
(docs/BLENDER.md, plan section 6 step 5). Blender 4.5 LTS or 5.x.

It only runs on a file named *_export.blend: File > Save Copy... > room_export.blend,
open that copy, then run this script (Text Editor > Run Script, or
`blender blender/room_export.blend --background --python blender/scripts/export_prep.py`).
It changes the file a lot; your bake file stays untouched.

  1. applies every modifier (tagged curves/text become meshes); single-user meshes
  2. joins the static meshes of each bake group into static_<group>. The contract's
     named nodes (tv_body, vcr_flap, pc_*, lamp_head, tape_NN, notepad, screens,
     anchors, the optional pc_key_<code> caps...) stay separate; their children of
     the same group join into them
  3. unparents (keeping the world transform) the children of every mesh, except
     notepad_page under notepad, coffee_liquid under coffee_mug, the clock hands
     under wall_clock, cd_lid / cd_disc / cd_display under cd_player and
     calc_display / calc_keys under calculator: meshopt quantization (npm run
     assets:glb) would move a parent's mesh into an unnamed child node (the app
     handles it there)
  4. one material M_<group> per baked object, Metallic 0; notepad, notepad_page and
     polaroid_photo keep theirs (they are lit in real time on the web)
  5. validates the naming contract (mirror of src/three/contract.ts) and prints a report
Set DRY_RUN = True to only print the report.
Then: File > Export > glTF 2.0 (.glb) with the settings in docs/BLENDER.md.
"""

import os
import re
import sys

import bpy

# ----------------------------------------------------------------------------
# OPTIONS
# ----------------------------------------------------------------------------
DRY_RUN = False        # True: change nothing, only validate and report
TRIANGLE_BUDGET = 300_000

# ----------------------------------------------------------------------------
# Contract (mirror of src/three/contract.ts and src/three/materials/baked.ts)
# ----------------------------------------------------------------------------
GROUPS = ("room", "floor", "desk", "gear", "shelf", "props")
TAPE_NODES = tuple("tape_%02d" % i for i in range(1, 9))
REQUIRED_NODES = (
    "static_room", "static_desk",
    "tv_body", "tv_screen", "vcr_body", "vcr_flap",
    "pc_body", "pc_monitor", "pc_screen", "pc_keyboard", "lamp_head",
) + TAPE_NODES + (
    "notepad", "notepad_page", "polaroid_photo", "window_glass",
    "anchor_notepad_up", "anchor_city",
)
LABEL_NODES = tuple("%s_label" % name for name in TAPE_NODES)
# Optional props (phase 2B): the coffee mug lifts for a sip, its liquid sinks, the
# clock hands turn about the dial centre; all lit in real time, never baked.
MUG_NODES = ("coffee_mug", "coffee_liquid")
CLOCK_HANDS = ("clock_hour", "clock_minute", "clock_second")
CLOCK_NODES = ("wall_clock",) + CLOCK_HANDS
# Optional props (phase 2C): the CD player (the lid opens on its back hinge, the
# disc spins, the display shows the LCD + buttons) and the desk calculator (it
# lifts; LCD and keypad drawn by the web). Lit in real time, never baked.
CD_PARTS = ("cd_lid", "cd_disc", "cd_display")
CD_NODES = ("cd_player",) + CD_PARTS
CALC_PARTS = ("calc_display", "calc_keys")
CALC_NODES = ("calculator",) + CALC_PARTS
# Optional surfaces the web draws on: they need UV0 0..1.
OPTIONAL_SURFACES = ("cd_display", "cd_disc", "calc_display", "calc_keys")
# Optional PC key caps, one object per key: pc_key_<KeyboardEvent.code> (pc_key_KeyA,
# pc_key_Space...). They stay separate objects (never joined into static_gear).
PC_KEY_PREFIX = "pc_key_"
PC_KEY_NAME = re.compile(r"^pc_key_[A-Z][A-Za-z0-9]*$")
# Child -> required parent (the web moves the child inside its parent).
PROP_PARENTS = {"coffee_liquid": "coffee_mug"}
PROP_PARENTS.update({hand: "wall_clock" for hand in CLOCK_HANDS})
PROP_PARENTS.update({part: "cd_player" for part in CD_PARTS})
PROP_PARENTS.update({part: "calculator" for part in CALC_PARTS})
# Optional extras: spine label planes (UV0 0..1), the lamp bulb, the mug, the clock,
# the CD player and the calculator; never baked.
UNBAKED_OPTIONAL = ("lamp_bulb",) + LABEL_NODES + MUG_NODES + CLOCK_NODES + CD_NODES + CALC_NODES
# The rolodex (credits card file) is optional and baked with the props.
OPTIONAL_NODES = ("static_floor", "static_shelf", "lamp_arm", "rolodex") + UNBAKED_OPTIONAL
EXPECTED_BAKE = {
    "static_room": "room",
    "static_floor": "floor",
    "static_desk": "desk",
    "static_shelf": "shelf",
    "tv_body": "gear",
    "vcr_body": "gear",
    "vcr_flap": "gear",
    "pc_body": "gear",
    "pc_monitor": "gear",
    "pc_keyboard": "gear",
    "lamp_head": "gear",
    "notepad": "props",
    "notepad_page": "props",
    "rolodex": "props",
}
EXPECTED_BAKE.update({name: "shelf" for name in TAPE_NODES})
UNBAKED_SURFACES = ("tv_screen", "pc_screen", "polaroid_photo", "window_glass")
ANCHORS = ("anchor_notepad_up", "anchor_city")
REALTIME_NODES = ("notepad", "notepad_page", "polaroid_photo")
# Named nodes that must survive as separate objects (everything but static_*, plus
# the baked rolodex, which is a hotspot, and any pc_key_<code> cap).
KEEP = frozenset([name for name in REQUIRED_NODES if not name.startswith("static_")] + ["rolodex"])
# The parent/child pairs the app needs (the page floats with the pad, the coffee
# sits in the mug, the hands hang on the clock, the lid / disc / display ride the
# CD player, the LCD and keys ride the calculator).
KEEP_CHILD = {"notepad_page": "notepad"}
KEEP_CHILD.update(PROP_PARENTS)


def is_kept(name):
    return name in KEEP or name.startswith(PC_KEY_PREFIX)

UV_RENDER = "UVMap"
UV_BAKE = "BakeUV"
SNAKE_CASE = re.compile(r"^[a-z0-9_]+$")
CONVERTIBLE = {"CURVE", "FONT", "SURFACE", "META"}


class ExportError(Exception):
    """A problem the user has to fix; printed without a traceback."""


def log(message):
    print("[export_prep] " + message)


def warn(message):
    print("[export_prep] WARNING: " + message)


# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
def guard_file():
    path = bpy.data.filepath
    if not path:
        raise ExportError("this file was never saved. Save the bake file, then File > Save Copy... as "
                          "room_export.blend, open the copy and run export_prep.py there.")
    name = os.path.basename(path)
    if not name.endswith("_export.blend"):
        raise ExportError("this is %s. export_prep.py rewrites the scene, so it only runs on a COPY named "
                          "*_export.blend: File > Save Copy... > room_export.blend, open it, run again." % name)


def ensure_object_mode():
    obj = bpy.context.view_layer.objects.active
    if obj is not None and obj.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")


def scene_objects():
    return list(bpy.context.scene.objects)


def in_view_layer(obj):
    return obj.name in bpy.context.view_layer.objects


def make_selectable(obj):
    if not in_view_layer(obj):
        raise ExportError("%s is in an excluded collection: enable it (checkbox in the Outliner)" % obj.name)
    obj.hide_viewport = False
    obj.hide_select = False
    obj.hide_set(False)


def select_only(objs, active):
    for other in bpy.context.view_layer.objects:
        other.select_set(False)
    for obj in objs:
        make_selectable(obj)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active


def unparent_keep_transform(obj):
    world = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = world


def kept_ancestor(obj):
    parent = obj.parent
    while parent is not None:
        if is_kept(parent.name):
            return parent
        parent = parent.parent
    return None


def bake_of(obj):
    value = obj.get("bake")
    return value if isinstance(value, str) else None


def is_library_data(obj):
    return obj.library is not None or (obj.data is not None and getattr(obj.data, "library", None) is not None)


def uv_values(layer):
    collection = getattr(layer, "uv", None)
    if collection is not None:
        values = [0.0] * (len(collection) * 2)
        collection.foreach_get("vector", values)
        return values
    values = [0.0] * (len(layer.data) * 2)
    layer.data.foreach_get("uv", values)
    return values


# ----------------------------------------------------------------------------
# 1. Modifiers
# ----------------------------------------------------------------------------
def convert_tagged_curves():
    converted = []
    for obj in scene_objects():
        if obj.type in CONVERTIBLE and (bake_of(obj) or is_kept(obj.name)):
            select_only([obj], obj)
            bpy.ops.object.convert(target="MESH")
            converted.append(obj.name)
    if converted:
        log("converted to mesh: " + ", ".join(converted))


def apply_modifiers():
    meshes = [obj for obj in scene_objects() if obj.type == "MESH"]
    library = [obj.name for obj in meshes if is_library_data(obj)]
    if library:
        raise ExportError("linked library data can't be edited: Object > Relations > Make Local on "
                          + ", ".join(library))
    for obj in meshes:
        if obj.data.users > 1:
            obj.data = obj.data.copy()
    # Evaluate everything first, then swap: changing one object never re-evaluates another mid-way.
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = []
    for obj in meshes:
        if len(obj.modifiers) == 0:
            continue
        mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph), preserve_all_data_layers=True,
                                               depsgraph=depsgraph)
        evaluated.append((obj, mesh))
    for obj, mesh in evaluated:
        old = obj.data
        obj.modifiers.clear()
        obj.data = mesh
        mesh.name = obj.name
        if old.users == 0:
            bpy.data.meshes.remove(old)
    if evaluated:
        log("applied modifiers on %d object(s)" % len(evaluated))


# ----------------------------------------------------------------------------
# 2. Joins
# ----------------------------------------------------------------------------
def join_into(target, others):
    if not others:
        return
    for obj in others:
        for child in list(obj.children):
            if child not in others and child is not target:
                unparent_keep_transform(child)
    select_only([target] + others, target)
    bpy.ops.object.join()


def join_groups():
    report = []
    for group in GROUPS:
        # Re-listed per group: a join deletes the objects merged into the target.
        meshes = [obj for obj in scene_objects() if obj.type == "MESH"]
        members = [obj for obj in meshes if bake_of(obj) == group and not is_kept(obj.name)]
        statics = []
        into_parent = {}
        for obj in members:
            ancestor = kept_ancestor(obj)
            if ancestor is None:
                statics.append(obj)
            elif ancestor.type == "MESH" and bake_of(ancestor) == group:
                into_parent.setdefault(ancestor, []).append(obj)
            else:
                warn("%s is under %s (another group or not a mesh): left as is" % (obj.name, ancestor.name))

        for parent, children in into_parent.items():
            join_into(parent, children)
            report.append("%s <- %d part(s)" % (parent.name, len(children)))

        if not statics:
            continue
        wanted = "static_" + group
        target = next((obj for obj in statics if obj.name == wanted), statics[0])
        others = [obj for obj in statics if obj is not target]
        if target.parent is not None:
            unparent_keep_transform(target)
        join_into(target, others)
        target.name = wanted
        if target.name != wanted:
            raise ExportError("could not name the joined mesh %s: another object already has that name (%s)"
                              % (wanted, target.name))
        target.data.name = wanted
        target["bake"] = group
        report.append("%s <- %d object(s)" % (wanted, len(statics)))
    for line in report:
        log("joined " + line)


# ----------------------------------------------------------------------------
# 3. Hierarchy
# ----------------------------------------------------------------------------
def flatten_mesh_parents():
    moved = []
    for obj in scene_objects():
        if obj.type != "MESH":
            continue
        for child in list(obj.children):
            if KEEP_CHILD.get(child.name) == obj.name:
                continue
            unparent_keep_transform(child)
            moved.append("%s (was under %s)" % (child.name, obj.name))
    if moved:
        log("unparented: " + ", ".join(moved))


# ----------------------------------------------------------------------------
# 4. Materials
# ----------------------------------------------------------------------------
def principled_nodes(material):
    tree = material.node_tree
    return [node for node in tree.nodes if node.type == "BSDF_PRINCIPLED"] if tree is not None else []


def zero_metallic(material):
    for node in principled_nodes(material):
        socket = node.inputs.get("Metallic")
        if socket is None:
            continue
        for link in list(socket.links):
            material.node_tree.links.remove(link)
        socket.default_value = 0.0


def group_material(group):
    name = "M_" + group
    material = bpy.data.materials.get(name)
    if material is None:
        material = bpy.data.materials.new(name)
        try:
            material.use_nodes = True
        except AttributeError:
            pass  # Blender 5.x: always node based
        for node in principled_nodes(material):
            node.inputs["Base Color"].default_value = (0.5, 0.5, 0.5, 1.0)
            node.inputs["Roughness"].default_value = 1.0
    zero_metallic(material)
    return material


def assign_group_materials():
    assigned = []
    for obj in scene_objects():
        group = bake_of(obj)
        if obj.type != "MESH" or group is None:
            continue
        if obj.name in REALTIME_NODES:
            for slot in obj.material_slots:
                if slot.material is not None:
                    zero_metallic(slot.material)
            continue
        mesh = obj.data
        mesh.materials.clear()
        mesh.materials.append(group_material(group))
        if len(mesh.polygons) > 0:
            mesh.polygons.foreach_set("material_index", [0] * len(mesh.polygons))
        assigned.append(obj.name)
    log("M_<group> on %d baked object(s); %s keep their own material" % (len(assigned), ", ".join(REALTIME_NODES)))


# ----------------------------------------------------------------------------
# 5. Validation
# ----------------------------------------------------------------------------
def validate():
    errors, warnings, notes = [], [], []
    by_name = {obj.name: obj for obj in scene_objects()}

    for name in REQUIRED_NODES:
        if name not in by_name:
            errors.append((name, "missing"))
    for name in OPTIONAL_NODES:
        if name not in by_name and name not in LABEL_NODES:
            notes.append((name, "optional, not present"))
    labels = [name for name in LABEL_NODES if name in by_name]
    notes.append(("tape_NN_label", "%d label plane(s); the web adds a decal to the other tapes" % len(labels)))
    for name in UNBAKED_OPTIONAL:
        obj = by_name.get(name)
        if obj is None:
            continue
        if obj.type != "MESH":
            errors.append((name, "must be a mesh"))
        elif bake_of(obj) is not None:
            errors.append((name, "must not be baked (remove the bake property)"))
        elif name in LABEL_NODES and len(obj.data.uv_layers) == 0:
            errors.append((name, "needs a UV map 0..1 (UV0): the web maps its label row onto it"))

    for child, parent in PROP_PARENTS.items():
        obj = by_name.get(child)
        if obj is not None and (obj.parent is None or obj.parent.name != parent):
            errors.append((child, "must be a child of %s (Ctrl+P > Object, Keep Transform)" % parent))
    for name in OPTIONAL_SURFACES:
        obj = by_name.get(name)
        if obj is not None and obj.type == "MESH" and len(obj.data.uv_layers) == 0:
            errors.append((name, "needs a UV map 0..1 (UV0): the web draws its canvas onto it"))
    lid = by_name.get("cd_lid")
    if lid is not None:
        x, y, z = lid.matrix_world.translation
        notes.append(("cd_lid", "origin at (%.3f, %.3f, %.3f) m: it must sit on the back hinge" % (x, y, z)))
    keys = [obj.name for obj in scene_objects() if obj.name.startswith(PC_KEY_PREFIX)]
    for name in keys:
        if not PC_KEY_NAME.match(name):
            warnings.append((name, "pc_key_ + a KeyboardEvent.code, e.g. pc_key_KeyA, pc_key_Digit1, pc_key_Space"))
    if keys:
        notes.append(("pc_key_*", "%d key cap(s): the web presses them instead of its instanced caps (one draw call each)"
                      % len(keys)))
    clock = by_name.get("wall_clock")
    for hand in CLOCK_HANDS:
        obj = by_name.get(hand)
        if obj is not None and clock is not None:
            offset = (obj.matrix_world.translation - clock.matrix_world.translation)
            # Hands sit just in front of the dial; their origin must be on its centre axis.
            if offset.length > 0.03:
                warnings.append((hand, "origin is %.3f m from the wall_clock origin: put it on the dial centre"
                                 % offset.length))

    for name, group in EXPECTED_BAKE.items():
        obj = by_name.get(name)
        if obj is not None and bake_of(obj) != group:
            errors.append((name, "custom property bake should be %r, is %r" % (group, obj.get("bake"))))
    for slot, name in enumerate(TAPE_NODES, start=1):
        obj = by_name.get(name)
        if obj is not None and obj.get("slot") != slot:
            errors.append((name, "custom property slot should be %d (int), is %r" % (slot, obj.get("slot"))))

    for name in UNBAKED_SURFACES:
        obj = by_name.get(name)
        if obj is None:
            continue
        if obj.type != "MESH":
            errors.append((name, "must be a mesh"))
            continue
        if bake_of(obj) is not None:
            errors.append((name, "must not be baked (remove the bake property)"))
        if len(obj.data.uv_layers) == 0:
            errors.append((name, "needs a UV map 0..1 (UV0) for its runtime texture"))
        else:
            values = uv_values(obj.data.uv_layers[0])
            if values and (min(values) < -1e-4 or max(values) > 1 + 1e-4):
                warnings.append((name, "UV0 goes outside 0..1"))

    for name in ANCHORS:
        obj = by_name.get(name)
        if obj is not None and obj.type != "EMPTY":
            errors.append((name, "must be an Empty, is a %s" % obj.type))

    triangles = 0
    for obj in scene_objects():
        if obj.type in {"MESH", "EMPTY"} and not SNAKE_CASE.match(obj.name) and not PC_KEY_NAME.match(obj.name):
            warnings.append((obj.name, "not snake_case (dots, spaces or capitals); the web matches names exactly"))
        if "pivot" in obj.keys():
            errors.append((obj.name, "custom property 'pivot' is reserved by three's GLTFLoader: rename it"))
        if obj.type != "MESH":
            continue
        mesh = obj.data
        mesh.calc_loop_triangles()
        triangles += len(mesh.loop_triangles)
        if bake_of(obj) is None:
            continue
        names = [layer.name for layer in mesh.uv_layers]
        if names != [UV_RENDER, UV_BAKE]:
            errors.append((obj.name, "UV maps must be exactly [%s, %s], are %s (run prep_bake.py)"
                           % (UV_RENDER, UV_BAKE, names)))
        elif uv_values(mesh.uv_layers[UV_BAKE]) == uv_values(mesh.uv_layers[UV_RENDER]):
            warnings.append((obj.name, "%s equals %s: was it unwrapped and baked?" % (UV_BAKE, UV_RENDER)))
        if mesh.users > 1:
            errors.append((obj.name, "mesh data shared with another object (lightmaps can't be shared)"))
        if obj.children and KEEP_CHILD.get(obj.children[0].name) != obj.name:
            warnings.append((obj.name, "has children: quantization will move its mesh into an unnamed node"))

    for group in GROUPS:
        if any(bake_of(obj) == group for obj in scene_objects()) and ("static_" + group) not in by_name:
            notes.append(("static_" + group, "no static mesh for group %s (fine if everything is a named node)" % group))
    if triangles > TRIANGLE_BUDGET:
        warnings.append(("scene", "%d triangles, over the %d budget (Decimate > Collapse)" % (triangles, TRIANGLE_BUDGET)))
    flap = by_name.get("vcr_flap")
    if flap is not None:
        x, y, z = flap.matrix_world.translation
        notes.append(("vcr_flap", "origin at (%.3f, %.3f, %.3f) m: it must sit on the hinge" % (x, y, z)))
    extras = [obj.name for obj in scene_objects() if obj.type in {"LIGHT", "CAMERA"}]
    if extras:
        notes.append(("export", "lights/cameras in the scene (%d): untick Include > Punctual Lights and Cameras"
                      % len(extras)))
    if abs(bpy.context.scene.unit_settings.scale_length - 1.0) > 1e-6:
        warnings.append(("scene", "Unit Scale is %g, the web expects 1 (metres)" % bpy.context.scene.unit_settings.scale_length))
    return errors, warnings, notes, triangles


def print_report(errors, warnings, notes, triangles):
    rows = [("ERROR", n, p) for n, p in errors] + [("WARN", n, p) for n, p in warnings] + [("note", n, p) for n, p in notes]
    width = max([len(n) for _, n, _ in rows] + [4])
    print("")
    print("[export_prep] naming contract report (src/three/contract.ts)")
    for level, name, problem in rows:
        print("  %-5s %-*s  %s" % (level, width, name, problem))
    print("  triangles: %d (budget %d)" % (triangles, TRIANGLE_BUDGET))
    if errors:
        print("[export_prep] %d ERROR(S): fix them before exporting." % len(errors))
    else:
        print("[export_prep] CONTRACT OK (%d warning(s)). Next: File > Export > glTF 2.0 (.glb) to "
              "blender/export/room.raw.glb, then `npm run assets` (docs/BLENDER.md)." % len(warnings))


def main():
    if bpy.app.version < (4, 2, 0):
        warn("written for Blender 4.5 LTS / 5.x; this is %s" % bpy.app.version_string)
    if not DRY_RUN:
        guard_file()
        ensure_object_mode()
        convert_tagged_curves()
        apply_modifiers()
        join_groups()
        flatten_mesh_parents()
        assign_group_materials()
    else:
        log("DRY_RUN: nothing changed, validating only")
    errors, warnings, notes, triangles = validate()
    print_report(errors, warnings, notes, triangles)
    return len(errors)


if __name__ == "__main__":
    try:
        failures = main()
    except ExportError as error:
        print("[export_prep] ERROR: %s" % error)
        if bpy.app.background:
            sys.exit(1)
        raise
    if failures and bpy.app.background:
        sys.exit(1)
