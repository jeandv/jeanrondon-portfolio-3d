"""
prep_bake.py - prepare ONE bake group for a Cycles bake (docs/BLENDER.md, plan section 6).

Blender 4.5 LTS or 5.x. Run it from the Text Editor (Open this file, edit the
OPTIONS block below, then Text > Run Script / Alt+P), or from a terminal:

    blender blender/room_bake.blend --background --python blender/scripts/prep_bake.py -- \
        --group desk --pass albedo --use tagged --action bake

For the meshes of GROUP (the selected ones, or every mesh tagged bake=GROUP):
  1. custom property  bake = GROUP  (and slot = N on tape_NN)
  2. single-user mesh data, so every object owns its lightmap UVs
  3. UV maps exactly [UVMap, BakeUV]: UVMap is the render map (glTF TEXCOORD_0),
     BakeUV the active one you unwrap and bake into (TEXCOORD_1); any other UV map
     is removed
  4. single-user materials for the group (a material shared with objects outside
     the group is copied), Metallic 0 (metals bake black in a Diffuse bake)
  5. in every material an Image Texture node "BAKE_TARGET" (not connected, active)
     with the image <GROUP>_<PASS>, created at SIZE and saved as //bake/<name>.png
  6. optional Cycles bake settings for PASS
     albedo: Diffuse, Color only, 16 samples, margin 16 px Extend
     irrA:   Diffuse, Direct + Indirect (no Color), 512 samples, Clamp Indirect 10
ACTION 'bake' also runs the bake and saves the image; 'save' only saves it.
"""

import argparse
import os
import re
import sys

import bpy

# ----------------------------------------------------------------------------
# OPTIONS - edit here (Text Editor) or pass them after `--` (command line)
# ----------------------------------------------------------------------------
GROUP = "desk"            # room | floor | desk | gear | shelf | props
PASS = "albedo"           # albedo | irrA
SIZE = 0                  # 0 = the plan's size for GROUP/PASS (irrA is baked at 2x, see SIZES)
USE = "selected"          # selected | tagged (every mesh whose custom property bake == GROUP)
ACTION = "prep"           # prep | bake (prep + bake + save) | save (save the image only)
SET_BAKE_SETTINGS = True  # write the Cycles bake settings for PASS
ZERO_METALLIC = True      # Metallic 0 on every Principled BSDF of the group

# ----------------------------------------------------------------------------
# Constants (keep in sync with scripts/textures.mjs and src/three/contract.ts)
# ----------------------------------------------------------------------------
GROUPS = ("room", "floor", "desk", "gear", "shelf", "props")
PASSES = ("albedo", "irrA")
USES = ("selected", "tagged")
ACTIONS = ("prep", "bake", "save")

# Web texture sizes per group (plan section 6). Irradiance is baked at IRR_OVERSAMPLE x
# that size; scripts/textures.mjs downsamples it with lanczos3, which cleans the noise.
SIZES = {
    "room": {"albedo": 2048, "irrA": 1024},
    "floor": {"albedo": 1024, "irrA": 1024},
    "desk": {"albedo": 2048, "irrA": 1024},
    "gear": {"albedo": 2048, "irrA": 1024},
    "shelf": {"albedo": 1024, "irrA": 512},
    "props": {"albedo": 1024, "irrA": 512},
}
IRR_OVERSAMPLE = 2

UV_RENDER = "UVMap"
UV_BAKE = "BakeUV"
NODE_NAME = "BAKE_TARGET"
BAKE_DIR = "//bake"
MARGIN_PX = 16

# Mirror of EXPECTED_BAKE / UNBAKED_SURFACES in src/three/contract.ts.
TAPE_NODES = tuple("tape_%02d" % i for i in range(1, 9))
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
}
EXPECTED_BAKE.update({name: "shelf" for name in TAPE_NODES})
UNBAKED_SURFACES = ("tv_screen", "pc_screen", "polaroid_photo", "window_glass")
SNAKE_CASE = re.compile(r"^[a-z0-9_]+$")


class PrepError(Exception):
    """A problem the user has to fix; printed without a traceback."""


def log(message):
    print("[prep_bake] " + message)


def warn(message):
    print("[prep_bake] WARNING: " + message)


# ----------------------------------------------------------------------------
# Options
# ----------------------------------------------------------------------------
def parse_cli(argv):
    """Options after `--` override the OPTIONS block (pure: returns a dict)."""
    if "--" not in argv:
        return {}
    parser = argparse.ArgumentParser(prog="prep_bake.py", description="Prepare one bake group.")
    parser.add_argument("--group", choices=GROUPS)
    parser.add_argument("--pass", dest="pass_", choices=PASSES)
    parser.add_argument("--size", type=int)
    parser.add_argument("--use", choices=USES)
    parser.add_argument("--action", choices=ACTIONS)
    parser.add_argument("--no-settings", action="store_true", help="keep the current Cycles bake settings")
    parser.add_argument("--keep-metallic", action="store_true", help="do not set Metallic to 0")
    args = parser.parse_args(argv[argv.index("--") + 1:])
    options = {}
    for key, value in (("GROUP", args.group), ("PASS", args.pass_), ("SIZE", args.size),
                       ("USE", args.use), ("ACTION", args.action)):
        if value is not None:
            options[key] = value
    if args.no_settings:
        options["SET_BAKE_SETTINGS"] = False
    if args.keep_metallic:
        options["ZERO_METALLIC"] = False
    return options


def resolve_options(argv):
    options = {
        "GROUP": GROUP,
        "PASS": PASS,
        "SIZE": SIZE,
        "USE": USE,
        "ACTION": ACTION,
        "SET_BAKE_SETTINGS": SET_BAKE_SETTINGS,
        "ZERO_METALLIC": ZERO_METALLIC,
    }
    options.update(parse_cli(argv))
    if options["GROUP"] not in GROUPS:
        raise PrepError("GROUP must be one of %s, got %r" % (", ".join(GROUPS), options["GROUP"]))
    if options["PASS"] not in PASSES:
        raise PrepError("PASS must be 'albedo' or 'irrA', got %r" % (options["PASS"],))
    if options["USE"] not in USES:
        raise PrepError("USE must be 'selected' or 'tagged', got %r" % (options["USE"],))
    if options["ACTION"] not in ACTIONS:
        raise PrepError("ACTION must be 'prep', 'bake' or 'save', got %r" % (options["ACTION"],))
    if not options["SIZE"]:
        options["SIZE"] = bake_size(options["GROUP"], options["PASS"])
    if options["SIZE"] < 64 or options["SIZE"] > 8192:
        raise PrepError("SIZE %d is out of range (64..8192)" % options["SIZE"])
    return options


def bake_size(group, pass_):
    """Bake resolution: the web size for albedo, IRR_OVERSAMPLE x for irradiance."""
    size = SIZES[group][pass_]
    return size * IRR_OVERSAMPLE if pass_ == "irrA" else size


def image_name(group, pass_):
    return "%s_%s" % (group, pass_)


# ----------------------------------------------------------------------------
# Objects
# ----------------------------------------------------------------------------
def ensure_object_mode():
    obj = bpy.context.view_layer.objects.active
    if obj is not None and obj.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")


def collect_objects(group, use):
    if use == "selected":
        selected = list(bpy.context.selected_objects)
        meshes = [obj for obj in selected if obj.type == "MESH"]
        for obj in selected:
            if obj.type != "MESH":
                warn("%s is a %s, not a mesh: skipped" % (obj.name, obj.type))
        if not meshes:
            raise PrepError("nothing selected: select the meshes of group '%s' (or use USE = 'tagged')" % group)
    else:
        meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.get("bake") == group]
        if not meshes:
            raise PrepError("no mesh has bake=%r yet: select them and run once with USE = 'selected'" % group)

    kept = []
    for obj in meshes:
        if obj.name in UNBAKED_SURFACES:
            warn("%s is a screen/photo/glass surface (runtime texture): never baked, skipped" % obj.name)
            continue
        kept.append(obj)
    if not kept:
        raise PrepError("no bakeable mesh left in the selection")
    return kept


def check_names(objs, group):
    for obj in objs:
        if not SNAKE_CASE.match(obj.name):
            warn("%s is not snake_case (no dots, spaces or capitals): rename it, the web contract "
                 "matches names exactly" % obj.name)
        expected = EXPECTED_BAKE.get(obj.name)
        if expected is not None and expected != group:
            warn("%s belongs to group '%s' in the contract, not '%s'" % (obj.name, expected, group))
        previous = obj.get("bake")
        if previous not in (None, group):
            warn("%s was tagged bake=%r; now bake=%r" % (obj.name, previous, group))
        if "pivot" in obj.keys():
            warn("%s has a 'pivot' custom property: three's GLTFLoader reserves that name, rename it" % obj.name)


def tag_objects(objs, group):
    for obj in objs:
        obj["bake"] = group
        if obj.name in TAPE_NODES:
            obj["slot"] = int(obj.name[-2:])


def make_single_user_meshes(objs):
    for obj in objs:
        if obj.data.users > 1:
            log("%s: mesh data '%s' was shared, made single-user" % (obj.name, obj.data.name))
            obj.data = obj.data.copy()


# ----------------------------------------------------------------------------
# UV maps
# ----------------------------------------------------------------------------
def read_uv(layer):
    """UV coordinates of a UV map as a flat list (Blender 3.5+ `uv`, older `data`)."""
    collection = getattr(layer, "uv", None)
    if collection is not None:
        values = [0.0] * (len(collection) * 2)
        collection.foreach_get("vector", values)
        return values
    values = [0.0] * (len(layer.data) * 2)
    layer.data.foreach_get("uv", values)
    return values


def write_uv(layer, values):
    collection = getattr(layer, "uv", None)
    if collection is not None:
        collection.foreach_set("vector", values)
    else:
        layer.data.foreach_set("uv", values)


def plan_uv_sources(layers):
    """
    Pure: given [(name, active_render)], the index whose coordinates become UVMap,
    the index that becomes BakeUV (None = start from a copy of UVMap) and the names
    that go away.
    """
    names = [name for name, _ in layers]
    render = None
    if UV_RENDER in names:
        render = names.index(UV_RENDER)
    else:
        for index, (name, active_render) in enumerate(layers):
            if active_render and name != UV_BAKE:
                render = index
                break
        if render is None:
            for index, name in enumerate(names):
                if name != UV_BAKE:
                    render = index
                    break
    bake = names.index(UV_BAKE) if UV_BAKE in names else None
    removed = [name for index, name in enumerate(names) if index not in (render, bake)]
    return render, bake, removed


def enforce_uv_layers(obj):
    """Leaves exactly [UVMap, BakeUV] with BakeUV active and UVMap as the render map."""
    mesh = obj.data
    names = [layer.name for layer in mesh.uv_layers]
    if names != [UV_RENDER, UV_BAKE]:
        render, bake, removed = plan_uv_sources([(layer.name, layer.active_render) for layer in mesh.uv_layers])
        render_uv = read_uv(mesh.uv_layers[render]) if render is not None else None
        bake_uv = read_uv(mesh.uv_layers[bake]) if bake is not None else None
        while len(mesh.uv_layers) > 0:
            mesh.uv_layers.remove(mesh.uv_layers[0])
        uvmap = mesh.uv_layers.new(name=UV_RENDER, do_init=True)
        if uvmap is None:
            raise PrepError("%s: Blender refused to create the %s UV map" % (obj.name, UV_RENDER))
        if render_uv is not None:
            write_uv(uvmap, render_uv)
        else:
            warn("%s had no UV map: UVMap starts with Blender's default layout" % obj.name)
        bakeuv = mesh.uv_layers.new(name=UV_BAKE, do_init=False)
        if bakeuv is None:
            raise PrepError("%s: Blender refused to create the %s UV map" % (obj.name, UV_BAKE))
        write_uv(bakeuv, bake_uv if bake_uv is not None else read_uv(uvmap))
        if removed:
            log("%s: removed UV map(s) %s" % (obj.name, ", ".join(removed)))
        if bake_uv is None:
            log("%s: created %s (a copy of %s until you unwrap it)" % (obj.name, UV_BAKE, UV_RENDER))
    mesh.uv_layers[UV_RENDER].active_render = True
    mesh.uv_layers.active = mesh.uv_layers[UV_BAKE]


def bake_uv_problem(obj):
    """Why BakeUV is not ready to bake into (None when it looks unwrapped)."""
    mesh = obj.data
    if UV_BAKE not in mesh.uv_layers or UV_RENDER not in mesh.uv_layers:
        return "missing %s / %s" % (UV_RENDER, UV_BAKE)
    bake = read_uv(mesh.uv_layers[UV_BAKE])
    if not bake:
        return "no faces"
    if bake == read_uv(mesh.uv_layers[UV_RENDER]):
        return "%s is still a copy of %s (Smart UV Project it)" % (UV_BAKE, UV_RENDER)
    if min(bake) < -1e-4 or max(bake) > 1 + 1e-4:
        return "%s goes outside the 0..1 square (Pack Islands)" % UV_BAKE
    return None


# ----------------------------------------------------------------------------
# Materials and images
# ----------------------------------------------------------------------------
def default_material(group):
    name = "BAKE_" + group
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    enable_nodes(material)
    return material


def enable_nodes(material):
    # Blender 5.x materials always use nodes (use_nodes is deprecated there).
    if getattr(material, "node_tree", None) is None or not getattr(material, "use_nodes", True):
        try:
            material.use_nodes = True
        except AttributeError:
            pass
    if material.node_tree is None:
        raise PrepError("material %s has no node tree" % material.name)


def used_outside(material, selection):
    for obj in bpy.data.objects:
        if obj in selection:
            continue
        for slot in getattr(obj, "material_slots", ()):
            if slot.material == material:
                return True
    return False


def group_materials(objs, group):
    """Gives the group materials of its own; returns them (unique, in order)."""
    selection = set(objs)
    copies = {}
    materials = []
    for obj in objs:
        if len(obj.material_slots) == 0:
            obj.data.materials.append(default_material(group))
        for slot in obj.material_slots:
            material = slot.material
            if material is None:
                slot.material = material = default_material(group)
            elif material in copies:
                slot.material = material = copies[material]
            elif used_outside(material, selection):
                original = material
                material = original.copy()
                material.name = "%s_%s" % (original.name, group)
                copies[original] = material
                slot.material = material
                log("material %s is shared outside the group: '%s' gets its own copy %s" % (
                    original.name, group, material.name))
            if material not in materials:
                materials.append(material)
    for material in materials:
        enable_nodes(material)
    return materials


def zero_metallic(material):
    changed = False
    tree = material.node_tree
    for node in tree.nodes:
        if node.type != "BSDF_PRINCIPLED":
            continue
        socket = node.inputs.get("Metallic")
        if socket is None:
            continue
        for link in list(socket.links):
            tree.links.remove(link)
            changed = True
        if socket.default_value != 0.0:
            socket.default_value = 0.0
            changed = True
    return changed


def ensure_image(name, size):
    image = bpy.data.images.get(name)
    if image is None:
        image = bpy.data.images.new(name, width=size, height=size, alpha=False, float_buffer=False)
        log("created image %s (%dx%d)" % (name, size, size))
    elif tuple(image.size) != (size, size):
        log("image %s was %dx%d, scaled to %dx%d" % (name, image.size[0], image.size[1], size, size))
        image.scale(size, size)
    try:
        # 8-bit sRGB on disk; the web decodes both maps as sRGB (src/three/materials/baked.ts).
        image.colorspace_settings.name = "sRGB"
    except TypeError:
        warn("could not set %s to the sRGB colour space: check Image > Colour Space" % name)
    image.filepath_raw = "%s/%s.png" % (BAKE_DIR, name)
    image.file_format = "PNG"
    return image


def ensure_bake_node(material, image):
    tree = material.node_tree
    node = tree.nodes.get(NODE_NAME)
    if node is not None and node.type != "TEX_IMAGE":
        tree.nodes.remove(node)
        node = None
    if node is None:
        node = tree.nodes.new("ShaderNodeTexImage")
        node.name = NODE_NAME
        node.label = NODE_NAME
        output = next((n for n in tree.nodes if n.type == "OUTPUT_MATERIAL"), None)
        x, y = (output.location.x, output.location.y) if output is not None else (0.0, 0.0)
        node.location = (x - 300.0, y + 300.0)
    node.image = image
    # Never part of the shading: it is only the bake target.
    for link in list(tree.links):
        if link.from_node == node:
            tree.links.remove(link)
    for other in tree.nodes:
        other.select = False
    node.select = True
    tree.nodes.active = node


# ----------------------------------------------------------------------------
# Cycles
# ----------------------------------------------------------------------------
def configure_cycles(scene, pass_):
    scene.render.engine = "CYCLES"
    cycles = scene.cycles
    cycles.bake_type = "DIFFUSE"
    bake = scene.render.bake
    bake.target = "IMAGE_TEXTURES"
    bake.use_selected_to_active = False
    bake.use_clear = True
    bake.margin = MARGIN_PX
    bake.margin_type = "EXTEND"
    if pass_ == "albedo":
        bake.use_pass_direct = False
        bake.use_pass_indirect = False
        bake.use_pass_color = True
        cycles.samples = 16
    else:
        bake.use_pass_direct = True
        bake.use_pass_indirect = True
        bake.use_pass_color = False
        cycles.samples = 512
        cycles.sample_clamp_indirect = 10.0
    try:
        preferences = bpy.context.preferences.addons["cycles"].preferences
        if preferences.has_active_device():
            cycles.device = "GPU"
    except (KeyError, AttributeError):
        pass
    log("Cycles bake settings for %s: Diffuse %s, %d samples, margin %d px Extend, device %s" % (
        pass_, "Color only" if pass_ == "albedo" else "Direct+Indirect (no Color)",
        cycles.samples, MARGIN_PX, cycles.device))


def save_image(image):
    if not bpy.data.filepath:
        raise PrepError("save the .blend first (e.g. blender/room_bake.blend): images go to //bake/ next to it")
    path = bpy.path.abspath(image.filepath_raw)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    image.save()
    log("saved %s -> %s" % (image.name, path))


def run_bake(objs, pass_, image):
    problems = ["%s: %s" % (obj.name, problem) for obj in objs for problem in [bake_uv_problem(obj)] if problem]
    if problems:
        raise PrepError("BakeUV is not ready:\n  " + "\n  ".join(problems))
    hidden = [obj.name for obj in objs if not obj.visible_get()]
    if hidden:
        raise PrepError("unhide these objects before baking: " + ", ".join(hidden))
    for obj in bpy.context.view_layer.objects:
        obj.select_set(False)
    for obj in objs:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    pass_filter = {"COLOR"} if pass_ == "albedo" else {"DIRECT", "INDIRECT"}
    log("baking %s into %s (this blocks Blender until it finishes)..." % (pass_, image.name))
    result = bpy.ops.object.bake(
        type="DIFFUSE",
        pass_filter=pass_filter,
        margin=MARGIN_PX,
        margin_type="EXTEND",
        use_clear=True,
        target="IMAGE_TEXTURES",
        uv_layer=UV_BAKE,
    )
    if "FINISHED" not in result:
        raise PrepError("the bake did not finish (%s); see the messages above" % ", ".join(result))
    save_image(image)


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------
def next_steps(options, names):
    group, pass_ = options["GROUP"], options["PASS"]
    name = image_name(group, pass_)
    lines = [
        "",
        "Next steps for group '%s' (%d objects: %s)" % (group, len(names), ", ".join(names[:8]) + (" ..." if len(names) > 8 else "")),
    ]
    if pass_ == "albedo" and options["ACTION"] == "prep":
        lines += [
            " 1. Keep them all selected, Tab into Edit Mode, select all (A).",
            "    BakeUV is the active UV map: UV > Smart UV Project (Island Margin 0.003),",
            "    then UV > Pack Islands (Margin 0.01). Check it in the UV Editor (no overlaps).",
        ]
    if options["ACTION"] == "prep":
        lines += [
            " 2. Back in Object Mode: Render Properties > Bake > Bake (settings already set),",
            "    or run again with ACTION = 'bake'.",
            " 3. Save the image: Image Editor > Image > Save (it is //bake/%s.png),"
            % name,
            "    or run again with ACTION = 'save'.",
        ]
    if pass_ == "albedo":
        lines.append(" -> then PASS = 'irrA' with USE = 'tagged' (no need to select again).")
    else:
        lines += [
            " -> irradiance brighter than 1.0 clips: halve the lights and set IRR_SCALE = 2",
            "    in src/three/materials/baked.ts.",
            " -> next group, or `npm run assets:textures` once the PNGs are in blender/bake/.",
        ]
    print("\n".join(lines))


def main(argv):
    options = resolve_options(argv)
    group, pass_, size = options["GROUP"], options["PASS"], options["SIZE"]
    if bpy.app.version < (4, 2, 0):
        warn("written for Blender 4.5 LTS / 5.x; this is %s" % bpy.app.version_string)
    log("group=%s pass=%s size=%d use=%s action=%s" % (group, pass_, size, options["USE"], options["ACTION"]))

    if options["ACTION"] == "save":
        image = bpy.data.images.get(image_name(group, pass_))
        if image is None:
            raise PrepError("there is no image %s yet: run with ACTION = 'prep' first" % image_name(group, pass_))
        save_image(image)
        return

    ensure_object_mode()
    objs = collect_objects(group, options["USE"])
    check_names(objs, group)
    tag_objects(objs, group)
    make_single_user_meshes(objs)
    for obj in objs:
        enforce_uv_layers(obj)

    image = ensure_image(image_name(group, pass_), size)
    materials = group_materials(objs, group)
    zeroed = []
    for material in materials:
        if options["ZERO_METALLIC"] and zero_metallic(material):
            zeroed.append(material.name)
        ensure_bake_node(material, image)
    if zeroed:
        log("Metallic set to 0 on: " + ", ".join(zeroed))
    log("%s active in %d material(s) -> image %s" % (NODE_NAME, len(materials), image.name))

    if options["SET_BAKE_SETTINGS"]:
        configure_cycles(bpy.context.scene, pass_)

    if options["ACTION"] == "bake":
        run_bake(objs, pass_, image)
    else:
        for obj in objs:
            problem = bake_uv_problem(obj)
            if problem and pass_ == "irrA":
                warn("%s: %s" % (obj.name, problem))

    next_steps(options, [obj.name for obj in objs])


if __name__ == "__main__":
    try:
        main(sys.argv)
    except PrepError as error:
        print("[prep_bake] ERROR: %s" % error)
        if bpy.app.background:
            sys.exit(1)
        raise
