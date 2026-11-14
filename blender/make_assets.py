"""
IRON HORIZON — Procedural asset authoring for Blender 4.5 LTS
=============================================================
This is the "art department" of the game. It authors every hard-surface hero
asset from scratch inside Blender (no downloaded meshes), assigns hand-built
procedural PBR materials, lays the whole kit out in a showroom scene, saves a
real .blend master file and finally exports one GLB per asset for Three.js.

Run:
    blender -b -P blender/make_assets.py            (full Blender)
    python  -c "..." / bpy -b -P ...                (bpy module, headless)

Outputs:
    blender/IRON_HORIZON_KIT.blend   (compressed showroom scene, all 25 assets)
    public/assets/*.glb             (one runtime-ready GLB per asset)
"""

import bpy
import math
import os
import sys
import numpy as np
from mathutils import Vector, Euler

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
GLB_DIR = os.path.join(ROOT, "public", "assets")
os.makedirs(GLB_DIR, exist_ok=True)

# -----------------------------------------------------------------------------
# Procedural texture lab (numpy -> Blender images -> glTF embedded textures)
# -----------------------------------------------------------------------------

def _vnoise(h, w, cells, rng):
    g = rng.random((cells, cells)).astype(np.float32)
    xs = np.linspace(0, cells - 1.0001, w, dtype=np.float32)
    ys = np.linspace(0, cells - 1.0001, h, dtype=np.float32)
    x0 = np.floor(xs).astype(int); fx = xs - x0; x1 = np.minimum(x0 + 1, cells - 1)
    y0 = np.floor(ys).astype(int); fy = ys - y0; y1 = np.minimum(y0 + 1, cells - 1)
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy)
    a = g[np.ix_(y0, x0)] * (1 - fx)[None, :] + g[np.ix_(y0, x1)] * fx[None, :]
    b = g[np.ix_(y1, x0)] * (1 - fx)[None, :] + g[np.ix_(y1, x1)] * fx[None, :]
    return a * (1 - fy)[:, None] + b * fy[:, None]


def fbm(h, w, seed, octaves=5, base=3):
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        out += _vnoise(h, w, base * (2 ** o), rng) * amp
        tot += amp
        amp *= 0.52
    return out / tot


def clamp01(a):
    return np.clip(a, 0.0, 1.0)


def make_image(name, rgb, size=256):
    h, w = rgb.shape[:2]
    img = bpy.data.images.new(name, width=w, height=h, alpha=True)
    rgba = np.concatenate([clamp01(rgb).astype(np.float32),
                           np.ones((h, w, 1), np.float32)], axis=2)
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    img.file_format = 'PNG'
    return img


def height_normal(height, strength=2.2):
    gy, gx = np.gradient(height.astype(np.float32))
    nx = -gx * strength; ny = -gy * strength
    nz = np.ones_like(nx)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return clamp01(np.stack([nx / l * .5 + .5, ny / l * .5 + .5, nz / l * .5 + .5], axis=2))


def build_textures():
    S = 256
    T = {}
    n1 = fbm(S, S, 11); n2 = fbm(S, S, 29, 6, 6); n3 = fbm(S, S, 47, 4, 12)
    grain = fbm(S, S, 71, 3, 48)

    # --- painted armour steel: olive drab, chipped paint, rust blooms, scratches
    rust = clamp01((n2 * 1.55 - .62) * 2.4) * clamp01(n1 * 1.8)
    scratch = clamp01((np.abs(np.sin((n3 * 9.0 + n1 * 3.0) * 22.0)) - .93) * 16.0)
    base = np.array([.235, .255, .205], np.float32)
    dark = np.array([.115, .128, .108], np.float32)
    steel = base[None, None, :] * (0.68 + n1[..., None] * .55) + dark[None, None, :] * (1 - n1[..., None]) * .25
    rustc = np.array([.40, .185, .085], np.float32)[None, None, :] * (.55 + n2[..., None] * .8)
    col = steel * (1 - rust[..., None]) + rustc * rust[..., None]
    col += scratch[..., None] * .20 + (grain[..., None] - .5) * .055
    T['metal'] = make_image('T_ARMOR_ALBEDO', col)
    T['metal_rough'] = make_image('T_ARMOR_ROUGH', np.repeat((.62 + n2 * .3 - rust * .15)[..., None], 3, 2))
    T['metal_normal'] = make_image('T_ARMOR_NORMAL', height_normal(n1 * .6 + n2 * .4, 3.0))

    # --- concrete: aggregate, stains, hairline cracks, rebar rust drips
    cracks = clamp01((np.abs(np.sin((n1 * 4 + n3 * 2) * 28.0)) - .975) * 44.0)
    stain = clamp01((n2 - .55) * 2.2)
    conc = np.array([.44, .435, .405], np.float32)[None, None, :] * (.62 + n1[..., None] * .72)
    conc += (grain[..., None] - .5) * .12
    conc = conc * (1 - stain[..., None] * .35) - cracks[..., None] * .22
    T['concrete'] = make_image('T_CONCRETE_ALBEDO', conc)
    T['concrete_normal'] = make_image('T_CONCRETE_NORMAL', height_normal(n1 * .7 + grain * .3 - cracks * .3, 2.6))
    T['concrete_rough'] = make_image('T_CONCRETE_ROUGH', np.repeat((.85 + n2 * .12)[..., None], 3, 2))

    # --- digital-ish speckle camouflage for uniforms
    blobs = fbm(S, S, 91, 4, 5)
    bands = np.sin((blobs * 6.0 + n1 * 2.0) * 9.0)
    c1 = np.array([.155, .185, .135], np.float32)
    c2 = np.array([.30, .285, .205], np.float32)
    c3 = np.array([.085, .10, .085], np.float32)
    m = clamp01(bands * .5 + .5)[..., None]
    col = c1[None, None, :] * m + c2[None, None, :] * (1 - m)
    col = col * (1 - clamp01((blobs - .62) * 3)[..., None]) + c3[None, None, :] * clamp01((blobs - .62) * 3)[..., None]
    pix = (np.arange(S)[:, None] + np.arange(S)[None, :])
    dither = ((pix * 7919) % 17 < 6).astype(np.float32)
    col += (dither[..., None] - .5) * .035 + (grain[..., None] - .5) * .04
    T['camo'] = make_image('T_CAMO_ALBEDO', col)
    T['camo_rough'] = make_image('T_CAMO_ROUGH', np.repeat((.90 + n3 * .08)[..., None], 3, 2))

    # --- wood crates
    rings = np.sin((n1 * 6 + np.arange(S)[None, :] * .055) * 13.0) * .5 + .5
    wood = np.array([.34, .225, .125], np.float32)[None, None, :] * (.55 + rings[..., None] * .55 + n2[..., None] * .3)
    wood += (grain[..., None] - .5) * .09
    T['wood'] = make_image('T_WOOD_ALBEDO', wood)
    T['wood_normal'] = make_image('T_WOOD_NORMAL', height_normal(rings * .5 + n2 * .5, 2.0))

    # --- canvas / sandbags
    weave = (np.sin(np.arange(S)[None, :] * 1.55) * np.sin(np.arange(S)[:, None] * 1.55))[..., None]
    sand = np.array([.40, .355, .255], np.float32)[None, None, :] * (.72 + n1[..., None] * .5 + weave * .07)
    T['canvas'] = make_image('T_CANVAS_ALBEDO', sand)

    # --- corrugated shipping container (oxidised teal + rust streaks)
    streak = clamp01((n3 * 1.7 - .5)) * clamp01((np.arange(S)[:, None] / S) ** 1.5)
    cont = np.array([.145, .245, .235], np.float32)[None, None, :] * (.65 + n1[..., None] * .6)
    cont = cont * (1 - streak[..., None]) + np.array([.38, .17, .08], np.float32)[None, None, :] * streak[..., None]
    cont += (grain[..., None] - .5) * .07
    T['container'] = make_image('T_CONTAINER_ALBEDO', cont)

    T['rubber'] = make_image('T_RUBBER_ALBEDO',
        np.array([.038, .042, .043], np.float32)[None, None, :] * (.7 + grain[..., None] * .6))
    return T


TEX = {}


def mat(name, color, rough=.7, metal=.0, tex=None, rough_tex=None, normal_tex=None, emissive=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if tex:
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = TEX[tex]; n.location = (-520, 220)
        n.extension = 'REPEAT'
        nt.links.new(n.outputs['Color'], bsdf.inputs['Base Color'])
    if rough_tex:
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = TEX[rough_tex]; n.location = (-520, -60)
        n.image.colorspace_settings.name = 'Non-Color'
        nt.links.new(n.outputs['Color'], bsdf.inputs['Roughness'])
    if normal_tex:
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = TEX[normal_tex]; n.location = (-520, -300)
        n.image.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = .65
        nt.links.new(n.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if emissive:
        bsdf.inputs['Emission Color'].default_value = (*emissive, 1)
        bsdf.inputs['Emission Strength'].default_value = 2.0
    return m


def build_materials():
    M = {}
    M['armor'] = mat('M_ArmorSteel', (.23, .25, .2), .65, .55, 'metal', 'metal_rough', 'metal_normal')
    M['armor_dark'] = mat('M_ArmorDark', (.12, .14, .12), .72, .6, 'metal', 'metal_rough', 'metal_normal')
    M['gunmetal'] = mat('M_Gunmetal', (.075, .08, .085), .38, .85)
    M['steel'] = mat('M_BareSteel', (.34, .35, .36), .35, .85)
    M['rust'] = mat('M_Rust', (.36, .17, .075), .92, .25)
    M['concrete'] = mat('M_Concrete', (.45, .44, .41), .9, .02, 'concrete', 'concrete_rough', 'concrete_normal')
    M['concrete_dark'] = mat('M_ConcreteDark', (.26, .26, .25), .95, .0, 'concrete', 'concrete_rough', 'concrete_normal')
    M['camo'] = mat('M_Uniform', (.2, .22, .16), .9, .0, 'camo', 'camo_rough')
    M['camo_dark'] = mat('M_UniformDark', (.13, .15, .12), .92, .0, 'camo', 'camo_rough')
    M['canvas'] = mat('M_Canvas', (.4, .35, .25), .95, .0, 'canvas')
    M['wood'] = mat('M_Wood', (.34, .23, .13), .88, .0, 'wood', normal_tex='wood_normal')
    M['container'] = mat('M_Container', (.17, .26, .25), .78, .35, 'container')
    M['rubber'] = mat('M_Rubber', (.04, .045, .045), .95, .0, 'rubber')
    M['glass'] = mat('M_OpticGlass', (.015, .045, .06), .08, .4, emissive=(.01, .09, .13))
    M['skin'] = mat('M_Skin', (.48, .35, .27), .85)
    M['black'] = mat('M_Black', (.025, .028, .03), .6, .2)
    M['red'] = mat('M_EmissiveRed', (.5, .03, .02), .4, .1, emissive=(1.0, .08, .03))
    M['amber'] = mat('M_EmissiveAmber', (.7, .35, .05), .4, .1, emissive=(1.0, .55, .12))
    M['blue'] = mat('M_EmissiveBlue', (.05, .3, .6), .4, .1, emissive=(.12, .55, 1.0))
    M['sand'] = mat('M_Sand', (.42, .37, .27), 1.0, .0, 'canvas')
    M['cloth'] = mat('M_FlagCloth', (.52, .09, .07), .9)
    M['dirt'] = mat('M_Dirt', (.22, .19, .14), 1.0)
    return M


M = {}

# -----------------------------------------------------------------------------
# Modelling toolbox
# -----------------------------------------------------------------------------

def empty(name, parent=None, loc=(0, 0, 0)):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o.empty_display_type = 'PLAIN_AXES'
    o.empty_display_size = .18
    o.parent = parent
    o.location = loc
    return o


def _assign(o, material):
    if material:
        o.data.materials.append(material)


def _bevel(o, width=.02, seg=2):
    if width <= 0:
        return
    mod = o.modifiers.new('EdgeWear', 'BEVEL')
    mod.width = width; mod.segments = seg
    mod.affect = 'EDGES'
    try:
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=mod.name)
    except Exception:
        pass


def box(name, loc, dim, material=None, bevel=.012, parent=None, rot=None):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.object
    o.name = name
    o.parent = parent
    o.location = loc
    if rot:
        o.rotation_euler = [math.radians(a) for a in rot]
    o.scale = dim
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    _assign(o, material)
    _bevel(o, min(bevel, min(dim) * .24))
    return o


def cyl(name, loc, radius, depth, material=None, verts=16, parent=None, rot=None, bevel=.006):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth)
    o = bpy.context.object
    o.name = name
    o.parent = parent
    o.location = loc
    if rot:
        o.rotation_euler = [math.radians(a) for a in rot]
    _assign(o, material)
    _bevel(o, bevel)
    return o


def sphere(name, loc, radius, material=None, parent=None, scale=(1, 1, 1), seg=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=max(8, seg // 2), radius=radius)
    o = bpy.context.object
    o.name = name
    o.parent = parent
    o.location = loc
    o.scale = scale
    _assign(o, material)
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def torus(name, loc, major, minor, material=None, parent=None, rot=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor,
                                     major_segments=24, minor_segments=8)
    o = bpy.context.object
    o.name = name
    o.parent = parent
    o.location = loc
    if rot:
        o.rotation_euler = [math.radians(a) for a in rot]
    _assign(o, material)
    return o


def tube(name, a, b, radius, material=None, parent=None, verts=8):
    a, b = Vector(a), Vector(b)
    d = b - a
    o = cyl(name, (a + b) * .5, radius, d.length, material, verts, parent)
    o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    return o


def plane(name, loc, dim, material=None, parent=None, rot=None):
    bpy.ops.mesh.primitive_plane_add(size=1)
    o = bpy.context.object
    o.name = name
    o.parent = parent
    o.location = loc
    if rot:
        o.rotation_euler = [math.radians(a) for a in rot]
    o.scale = (dim[0], dim[1], 1)
    _assign(o, material)
    return o


# -----------------------------------------------------------------------------
# ASSET: Kestrel AR-12 assault rifle  (also the player's view model)
# -----------------------------------------------------------------------------

def rifle(root, name='AR12', small=False):
    g = empty(name, root)
    s = 1.0
    box('Receiver_Lower', (0, 0, 0), (.062, .29, .075), M['gunmetal'], .008, g)
    box('Receiver_Upper', (0, .005, .052), (.058, .27, .052), M['gunmetal'], .006, g)
    box('MagWell', (0, -.055, -.055), (.055, .075, .085), M['gunmetal'], .006, g)
    mag = box('Magazine_Curved', (0, -.075, -.15), (.052, .075, .19), M['black'], .008, g, rot=(11, 0, 0))
    for i in range(5):
        box('MagRib_%d' % i, (0, -.075, -.09 - i * .034), (.055, .079, .006), M['gunmetal'], .002, g, rot=(11, 0, 0))
    box('PistolGrip', (0, -.115, -.085), (.05, .06, .15), M['black'], .01, g, rot=(-14, 0, 0))
    box('TriggerGuard', (0, -.055, -.055), (.012, .09, .012), M['gunmetal'], .003, g)
    box('Trigger', (0, -.055, -.042), (.008, .008, .032), M['steel'], .002, g)
    # stock + buffer
    box('BufferTube', (0, -.19, .012), (.036, .16, .036), M['gunmetal'], .005, g)
    box('Stock', (0, -.30, .005), (.052, .13, .075), M['black'], .012, g)
    box('CheekRest', (0, -.30, .047), (.045, .11, .016), M['black'], .006, g)
    box('Buttpad', (0, -.368, .005), (.056, .014, .082), M['rubber'], .004, g)
    # handguard + rail
    box('Handguard', (0, .20, .012), (.056, .27, .058), M['black'], .009, g)
    for i, z in enumerate([.045, -.018]):
        box('SideRail_%d' % i, (0, .20, z), (.061, .255, .008), M['gunmetal'], .003, g)
    box('TopRail', (0, .115, .083), (.043, .43, .012), M['gunmetal'], .003, g)
    for i in range(13):
        box('RailTooth_%d' % i, (0, -.085 + i * .033, .091), (.043, .012, .008), M['gunmetal'], .001, g)
    # barrel, gas block, muzzle device
    cyl('Barrel', (0, .385, .012), .011, .24, M['gunmetal'], 14, g, rot=(90, 0, 0))
    cyl('GasBlock', (0, .325, .012), .019, .045, M['steel'], 12, g, rot=(90, 0, 0))
    cyl('MuzzleBrake', (0, .505, .012), .019, .065, M['steel'], 12, g, rot=(90, 0, 0))
    for i in range(3):
        torus('BrakePort_%d' % i, (0, .49 + i * .017, .012), .019, .003, M['black'], g, rot=(90, 0, 0))
    tube('GasTube', (0, .30, .043), (0, .39, .043), .006, M['steel'], g)
    # optic
    box('OpticMount', (0, .055, .105), (.04, .075, .022), M['gunmetal'], .004, g)
    cyl('OpticTube', (0, .055, .135), .026, .105, M['gunmetal'], 20, g, rot=(90, 0, 0))
    cyl('OpticFrontGlass', (0, .108, .135), .023, .003, M['glass'], 20, g, rot=(90, 0, 0))
    cyl('OpticRearGlass', (0, .002, .135), .023, .003, M['glass'], 20, g, rot=(90, 0, 0))
    cyl('OpticTurret', (0, .055, .164), .012, .018, M['gunmetal'], 12, g)
    box('RedDotHood', (0, .055, .118), (.052, .05, .045), M['black'], .006, g)
    # foregrip, flashlight, laser, sling, charging handle
    box('Foregrip', (0, .245, -.058), (.036, .04, .09), M['black'], .008, g, rot=(8, 0, 0))
    cyl('Flashlight', (.038, .27, .022), .015, .075, M['gunmetal'], 12, g, rot=(90, 0, 0))
    cyl('LampLens', (.038, .309, .022), .014, .004, M['amber'], 12, g, rot=(90, 0, 0))
    box('PEQ', (-.037, .16, .045), (.022, .055, .035), M['black'], .004, g)
    box('ChargingHandle', (0, -.085, .062), (.055, .03, .012), M['steel'], .003, g)
    box('BoltRelease', (.032, -.015, .005), (.008, .035, .018), M['steel'], .002, g)
    box('Selector', (-.033, -.085, -.005), (.01, .028, .018), M['steel'], .002, g)
    for i, y in enumerate([-.34, .30]):
        torus('SlingLoop_%d' % i, (0, y, .01), .014, .003, M['steel'], g, rot=(0, 90, 0))
    if small:
        g.scale = (.82, .82, .82)
    return g


# -----------------------------------------------------------------------------
# ASSET: infantry soldier with a joint hierarchy for runtime animation
# -----------------------------------------------------------------------------

def soldier(root, name='SOLDIER', faction='enemy'):
    cloth = M['camo'] if faction == 'enemy' else M['camo_dark']
    accent = M['red'] if faction == 'enemy' else M['blue']
    r = empty(name, root)
    hips = empty('Hips', r, (0, 0, .98))
    torso = empty('Torso', hips, (0, 0, .12))
    head = empty('Head', torso, (0, 0, .46))
    armL = empty('ArmL', torso, (-.215, 0, .35))
    armR = empty('ArmR', torso, (.215, 0, .35))
    legL = empty('LegL', hips, (-.105, 0, -.02))
    legR = empty('LegR', hips, (.105, 0, -.02))

    box('Pelvis', (0, 0, -.02), (.30, .19, .17), cloth, .03, hips)
    box('Belt', (0, 0, .055), (.32, .21, .045), M['black'], .012, hips)
    for i in range(4):
        box('BeltPouch_%d' % i, (-.14 + i * .095, -.115, .05), (.07, .055, .09), cloth, .012, hips)

    box('Chest', (0, 0, .15), (.37, .23, .42), cloth, .045, torso)
    box('PlateCarrier', (0, -.005, .16), (.40, .255, .35), M['camo_dark'] if faction == 'enemy' else M['camo'], .035, torso)
    box('FrontPlate', (0, -.135, .17), (.27, .03, .30), M['black'], .02, torso)
    for i in range(3):
        for j in range(2):
            box('MagPouch_%d%d' % (i, j), (-.10 + i * .10, -.155, .07 + j * .10), (.085, .045, .075), cloth, .01, torso)
    box('Backpack', (0, .165, .16), (.30, .14, .34), cloth, .03, torso)
    box('Radio', (.11, .245, .27), (.07, .04, .12), M['black'], .008, torso)
    tube('RadioAntenna', (.11, .245, .33), (.125, .255, .58), .004, M['black'], torso)
    box('ShoulderL', (-.215, 0, .33), (.10, .17, .12), cloth, .02, torso)
    box('ShoulderR', (.215, 0, .33), (.10, .17, .12), cloth, .02, torso)
    box('Collar', (0, 0, .39), (.19, .19, .07), cloth, .02, torso)
    box('Armband', (-.215, 0, .28), (.105, .175, .035), accent, .008, torso)

    sphere('Neck', (0, 0, .435), .055, M['skin'], torso, (1, 1, 1.2))
    sphere('Head', (0, 0, .035), .105, M['skin'], head, (1, 1.05, 1.15))
    box('Jaw', (0, -.025, -.01), (.15, .13, .075), M['skin'], .02, head)
    box('Balaclava', (0, .01, .02), (.175, .18, .15), M['black'], .025, head)
    box('GoggleLens', (0, -.095, .055), (.16, .018, .045), M['glass'], .012, head)
    sphere('Helmet', (0, .015, .085), .125, cloth, head, (1.08, 1.12, .85))
    box('HelmetBrim', (0, -.02, .075), (.25, .21, .025), cloth, .012, head)
    box('NVGMount', (0, -.105, .11), (.055, .045, .045), M['gunmetal'], .008, head)
    cyl('NVG', (0, -.14, .10), .024, .09, M['gunmetal'], 12, head, rot=(90, 0, 0))

    for side, parent in ((-1, armL), (1, armR)):
        box('UpperArm', (side * .035, 0, -.14), (.105, .115, .27), cloth, .028, parent)
        box('Elbow', (side * .045, 0, -.275), (.095, .105, .08), M['camo_dark'], .02, parent)
        box('Forearm', (side * .045, -.015, -.38), (.09, .10, .22), cloth, .025, parent)
        box('Glove', (side * .05, -.025, -.50), (.085, .10, .085), M['black'], .02, parent)
        box('ArmPatch', (side * .10, 0, -.13), (.012, .085, .065), accent, .005, parent)

    for side, parent in ((-1, legL), (1, legR)):
        box('Thigh', (0, 0, -.22), (.15, .17, .40), cloth, .035, parent)
        box('KneePad', (0, -.095, -.44), (.14, .05, .12), M['black'], .02, parent)
        box('Shin', (0, 0, -.65), (.135, .15, .40), cloth, .03, parent)
        box('Boot', (0, -.045, -.88), (.15, .26, .13), M['black'], .025, parent)
        box('BootSole', (0, -.055, -.945), (.155, .27, .025), M['rubber'], .008, parent)

    # weapon carried at the ready, parented to right arm
    w = rifle(armR, 'Weapon')
    w.location = (-.055, -.09, -.47)
    w.rotation_euler = (math.radians(88), 0, math.radians(-4))
    w.scale = (.86, .86, .86)
    return r


# -----------------------------------------------------------------------------
# ASSET: Kalkan-9 main battle tank (drivable, named Turret / Gun pivots)
# -----------------------------------------------------------------------------

def tank(root, name='TANK'):
    r = empty(name, root)
    hull = empty('Hull', r)
    turret = empty('Turret', r, (0, -.15, 1.72))
    gun = empty('Gun', turret, (0, 1.02, .02))

    box('LowerHull', (0, 0, .85), (3.15, 6.4, 1.05), M['armor'], .09, hull)
    box('Glacis', (0, 2.75, 1.28), (3.15, 1.15, .42), M['armor'], .06, hull, rot=(-24, 0, 0))
    box('UpperDeck', (0, -.2, 1.42), (3.1, 5.4, .22), M['armor'], .05, hull)
    box('RearDeck', (0, -2.65, 1.38), (3.0, 1.1, .30), M['armor_dark'], .05, hull)
    for s in (-1, 1):
        box('SideSkirt_%s' % s, (s * 1.62, .05, .92), (.10, 5.5, .72), M['armor_dark'], .03, hull)
        # tracks: individual links around an oval loop
        for i in range(30):
            a = (i / 30.0) * math.pi * 2
            y = math.cos(a) * 2.85
            z = .68 + math.sin(a) * .50
            rot = (math.degrees(a), 0, 0)
            if abs(y) < 2.85:
                box('TrackLink_%s_%d' % (s, i), (s * 1.55, y, z), (.34, .20, .10), M['rubber'], .015, hull, rot=rot)
        for i in range(6):
            cyl('RoadWheel_%s_%d' % (s, i), (s * 1.53, -2.25 + i * .9, .63), .34, .18, M['gunmetal'], 16, hull, rot=(0, 90, 0))
            cyl('Hub_%s_%d' % (s, i), (s * 1.64, -2.25 + i * .9, .63), .13, .03, M['steel'], 12, hull, rot=(0, 90, 0))
        cyl('Sprocket_%s' % s, (s * 1.53, 2.62, .70), .40, .18, M['gunmetal'], 14, hull, rot=(0, 90, 0))
        cyl('Idler_%s' % s, (s * 1.53, -2.62, .70), .36, .18, M['gunmetal'], 14, hull, rot=(0, 90, 0))
        box('Fender_%s' % s, (s * 1.62, 0, 1.34), (.36, 6.1, .09), M['armor_dark'], .02, hull)
        for i in range(3):
            box('Stowage_%s_%d' % (s, i), (s * 1.3, -1.9 + i * .75, 1.62), (.42, .62, .32), M['armor_dark'], .03, hull)
        tube('TowCable_%s' % s, (s * 1.2, 1.2, 1.57), (s * 1.25, 2.4, 1.57), .026, M['gunmetal'], hull)
    for i in range(2):
        box('Headlight_%d' % i, ((i - .5) * 1.7, 3.18, 1.30), (.22, .10, .20), M['amber'], .02, hull)
    box('TowHooks', (0, -3.18, .76), (2.2, .12, .16), M['steel'], .02, hull)

    # turret shell + ERA bricks
    box('TurretBasket', (0, -.2, -.12), (2.55, 3.0, .55), M['armor'], .10, turret)
    box('TurretFront', (0, 1.25, .10), (2.3, .85, .62), M['armor'], .12, turret, rot=(-12, 0, 0))
    box('TurretRoof', (0, -.1, .46), (2.4, 2.9, .14), M['armor_dark'], .07, turret)
    for s in (-1, 1):
        for i in range(4):
            box('ERA_%s_%d' % (s, i), (s * 1.16, -.9 + i * .68, .18), (.12, .55, .36), M['armor_dark'], .015, turret, rot=(0, s * 9, 0))
    for i in range(5):
        box('ERA_Front_%d' % i, (-.84 + i * .42, 1.55, .28), (.36, .12, .34), M['armor_dark'], .015, turret)
    cyl('CommandersHatch', (-.55, -.55, .56), .38, .10, M['gunmetal'], 16, turret)
    cyl('LoadersHatch', (.55, -.55, .56), .34, .10, M['gunmetal'], 16, turret)
    box('CommandersCupola', (-.55, -.55, .66), (.62, .62, .18), M['armor_dark'], .04, turret)
    for i in range(6):
        a = i / 6.0 * math.pi * 2
        box('VisionBlock_%d' % i, (-.55 + math.cos(a) * .33, -.55 + math.sin(a) * .33, .76), (.10, .10, .06), M['glass'], .01, turret)
    cyl('Periscope', (.15, .95, .62), .075, .28, M['gunmetal'], 10, turret)
    cyl('SmokeLauncher_L', (-1.12, .85, .36), .09, .30, M['gunmetal'], 10, turret, rot=(70, 0, -22))
    cyl('SmokeLauncher_R', (1.12, .85, .36), .09, .30, M['gunmetal'], 10, turret, rot=(70, 0, 22))
    tube('Antenna', (-1.05, -.95, .55), (-1.14, -1.05, 3.15), .012, M['gunmetal'], turret)
    box('StowageRack', (0, -1.62, .30), (1.9, .50, .45), M['armor_dark'], .03, turret)

    # main gun: pivots around Gun empty so the game can elevate it
    box('Mantlet', (0, .12, 0), (.72, .55, .62), M['armor_dark'], .10, gun)
    cyl('Barrel', (0, 1.85, 0), .115, 3.25, M['gunmetal'], 18, gun, rot=(90, 0, 0))
    cyl('FumeExtractor', (0, 2.05, 0), .155, .38, M['gunmetal'], 18, gun, rot=(90, 0, 0))
    cyl('MuzzleBrake', (0, 3.48, 0), .155, .28, M['steel'], 18, gun, rot=(90, 0, 0))
    cyl('Bore', (0, 3.63, 0), .085, .02, M['black'], 18, gun, rot=(90, 0, 0))
    box('CoaxMG', (-.30, .55, -.08), (.12, .75, .12), M['gunmetal'], .02, gun)
    cyl('CoaxBarrel', (-.30, 1.15, -.08), .026, .70, M['gunmetal'], 10, gun, rot=(90, 0, 0))
    # roof heavy machine gun
    mg = empty('RoofMG', turret, (.35, .35, .62))
    box('MGBody', (0, 0, .12), (.16, .40, .16), M['gunmetal'], .02, mg)
    cyl('MGBarrel', (0, .48, .12), .022, .62, M['gunmetal'], 10, mg, rot=(90, 0, 0))
    box('MGShield', (0, .12, .28), (.42, .06, .38), M['armor_dark'], .02, mg)
    return r


# -----------------------------------------------------------------------------
# ASSET: fortifications and battlefield dressing
# -----------------------------------------------------------------------------

def bunker(root, name='BUNKER'):
    r = empty(name, root)
    for s in (-1, 1):
        box('WallSide_%s' % s, (s * 3.1, 0, 1.45), (.55, 7.2, 2.9), M['concrete'], .05, r)
        for i in range(4):
            tube('Rebar_%s_%d' % (s, i), (s * 3.1, -2.6 + i * 1.6, 2.9), (s * 3.1, -2.6 + i * 1.6, 3.6), .018, M['rust'], r)
    box('WallBack', (0, -3.5, 1.45), (6.7, .55, 2.9), M['concrete'], .05, r)
    box('WallFront', (0, 3.5, 1.45), (6.7, .55, 2.9), M['concrete'], .05, r)
    box('EmbrasureL', (-2.25, 3.5, 1.65), (2.2, .55, 1.0), M['concrete'], .04, r)
    box('EmbrasureLintel', (0, 3.5, 2.55), (6.7, .55, .65), M['concrete'], .04, r)
    box('EmbrasureSill', (0, 3.5, 1.05), (6.7, .55, .35), M['concrete'], .04, r)
    box('Roof', (0, 0, 3.05), (7.1, 7.7, .38), M['concrete_dark'], .06, r)
    for i in range(3):
        box('RoofBeam_%d' % i, (-2.2 + i * 2.2, 0, 2.82), (.16, 7.3, .16), M['steel'], .01, r)
    box('DoorFrame', (-1.2, -3.78, 1.1), (1.35, .18, 2.2), M['steel'], .02, r)
    box('BlastDoor', (-1.2, -3.86, 1.05), (1.15, .10, 2.0), M['armor_dark'], .02, r)
    cyl('DoorWheel', (-1.2, -3.95, 1.05), .16, .06, M['rust'], 12, r, rot=(90, 0, 0))
    for i in range(3):
        box('Step_%d' % i, (-1.2, -4.15 - i * .35, .28 - i * .22), (1.5, .35, .22), M['concrete'], .02, r)
    # sandbag revetment
    for row in range(3):
        for i in range(9):
            off = .12 if row % 2 else 0
            b = sphere('Sandbag_%d_%d' % (row, i), (-3.3 + i * .82 + off, 4.15, .30 + row * .27), .28,
                       M['canvas'], r, (1.35, .72, .55), 10)
            b.rotation_euler.z = math.radians((i * 37 + row * 11) % 14 - 7)
    return r


def container(root, name='CONTAINER', tint='container'):
    r = empty(name, root)
    W, H, L = 2.44, 2.59, 6.06
    box('Floor', (0, 0, .09), (W, L, .18), M['armor_dark'], .02, r)
    box('Roof', (0, 0, H), (W + .10, L + .10, .14), M[tint], .02, r)
    for s in (-1, 1):
        for i in range(26):
            x = -L / 2 + .12 + i * (L - .24) / 25
            box('Rib_%s_%d' % (s, i), (s * W / 2, x, H / 2), (.055, .085, H - .3), M[tint], .008, r)
        box('SidePanel_%s' % s, (s * W / 2, 0, H / 2), (.035, L, H - .22), M[tint], .01, r)
        for y in (-L / 2, L / 2):
            box('Post_%s_%s' % (s, y), (s * W / 2, y, H / 2), (.14, .14, H), M['rust'], .015, r)
    box('EndA', (0, -L / 2, H / 2), (W, .05, H), M[tint], .01, r)
    for s in (-1, 1):
        box('Door_%s' % s, (s * .58, L / 2, H / 2), (1.14, .06, H - .12), M[tint], .015, r)
        for i in range(3):
            box('DoorRib_%s_%d' % (s, i), (s * .58, L / 2 + .045, .45 + i * .85), (1.0, .03, .05), M['rust'], .006, r)
        cyl('LockRod_%s' % s, (s * 1.02, L / 2 + .06, H / 2), .022, H - .2, M['steel'], 8, r)
    for x in (-L / 2, L / 2):
        for sy in (-W / 2, W / 2):
            for z in (.05, H):
                box('CornerCasting', (sy, x, z), (.22, .22, .18), M['rust'], .015, r)
    return r


def watchtower(root, name='WATCHTOWER'):
    r = empty(name, root)
    for x in (-1.5, 1.5):
        for y in (-1.5, 1.5):
            tube('Leg_%s_%s' % (x, y), (x * 1.22, y * 1.22, 0), (x, y, 7.0), .095, M['armor_dark'], r)
    for h in (2.0, 4.5, 6.9):
        for s in (-1, 1):
            tube('BraceX_%s_%s' % (h, s), (-1.5 * (1 - h * .034), s * 1.5 * (1 - h * .034), h),
                 (1.5 * (1 - h * .034), s * 1.5 * (1 - h * .034), h), .045, M['rust'], r)
            tube('BraceY_%s_%s' % (h, s), (s * 1.5 * (1 - h * .034), -1.5 * (1 - h * .034), h),
                 (s * 1.5 * (1 - h * .034), 1.5 * (1 - h * .034), h), .045, M['rust'], r)
        tube('Diagonal_%s' % h, (-1.45, -1.45, h), (1.45, 1.45, h + 2.3), .035, M['rust'], r)
    box('Platform', (0, 0, 7.05), (3.6, 3.6, .16), M['wood'], .02, r)
    for s in (-1, 1):
        box('Railing_%s' % s, (s * 1.75, 0, 7.7), (.06, 3.5, 1.2), M['armor_dark'], .015, r)
        box('RailingB_%s' % s, (0, s * 1.75, 7.7), (3.5, .06, 1.2), M['armor_dark'], .015, r)
    for i in range(11):
        box('LadderRung_%d' % i, (-1.8, 0, .55 + i * .60), (.42, .07, .06), M['steel'], .008, r)
    tube('LadderRailL', (-1.8, -.2, 0), (-1.8, -.2, 7.0), .03, M['steel'], r)
    tube('LadderRailR', (-1.8, .2, 0), (-1.8, .2, 7.0), .03, M['steel'], r)
    box('Cabin', (0, 0, 8.35), (3.4, 3.4, 1.5), M['wood'], .03, r)
    for s in (-1, 1):
        box('Window_%s' % s, (s * 1.72, 0, 8.45), (.03, 2.4, .8), M['glass'], .008, r)
    box('Roof', (0, 0, 9.2), (4.1, 4.1, .18), M['armor_dark'], .04, r)
    tube('Mast', (0, 0, 9.25), (0, 0, 12.4), .035, M['steel'], r)
    cyl('Beacon', (0, 0, 12.5), .10, .16, M['red'], 12, r)
    for i in range(4):
        tube('Guy_%d' % i, (0, 0, 11.0),
             (math.cos(i * math.pi / 2) * 3.1, math.sin(i * math.pi / 2) * 3.1, 7.2), .012, M['gunmetal'], r)
    # searchlight
    sl = empty('Searchlight', r, (1.1, 1.9, 8.9))
    cyl('SL_Housing', (0, 0, 0), .30, .42, M['gunmetal'], 16, sl, rot=(90, 0, 0))
    cyl('SL_Lens', (0, .23, 0), .27, .03, M['amber'], 16, sl, rot=(90, 0, 0))
    return r


def crate(root, name='CRATE'):
    r = empty(name, root)
    box('Body', (0, 0, .45), (.9, .9, .9), M['wood'], .02, r)
    for s in (-1, 1):
        for z in (.10, .80):
            box('BattonX_%s_%s' % (s, z), (0, s * .455, z), (.92, .035, .09), M['wood'], .008, r)
            box('BattonY_%s_%s' % (s, z), (s * .455, 0, z), (.035, .92, .09), M['wood'], .008, r)
        box('Diagonal_%s' % s, (0, s * .463, .45), (.06, .02, 1.15), M['wood'], .006, r, rot=(0, 0, 45))
    box('Stencil', (0, -.462, .55), (.45, .012, .14), M['black'], .004, r)
    for x in (-.38, .38):
        for y in (-.38, .38):
            box('Corner_%s_%s' % (x, y), (x, y, .45), (.09, .09, .92), M['steel'], .008, r)
    return r


def barrel(root, name='BARREL'):
    r = empty(name, root)
    cyl('Drum', (0, 0, .44), .29, .88, M['rust'], 20, r)
    for z in (.16, .44, .72):
        torus('Rib_%s' % z, (0, 0, z), .295, .018, M['armor_dark'], r)
    cyl('Lid', (0, 0, .885), .28, .03, M['armor_dark'], 20, r)
    cyl('Bung', (.13, .08, .905), .045, .035, M['gunmetal'], 10, r)
    return r


def sandbag_wall(root, name='SANDBAGS', length=6.0):
    r = empty(name, root)
    n = int(length / .78)
    for row in range(3):
        for i in range(n - (row % 2)):
            x = -length / 2 + .4 + i * .78 + (row % 2) * .39
            b = sphere('Bag_%d_%d' % (row, i), (x, 0, .22 + row * .40), .27, M['canvas'], r, (1.45, .80, .62), 10)
            b.rotation_euler.z = math.radians(((i * 41 + row * 17) % 13) - 6)
    return r


def barrier(root, name='DRAGONTOOTH'):
    r = empty(name, root)
    box('Base', (0, 0, .12), (1.25, 1.25, .24), M['concrete'], .04, r)
    pyramid = bpy.data.meshes.new('ToothMesh')
    verts = [(-.52, -.52, .24), (.52, -.52, .24), (.52, .52, .24), (-.52, .52, .24), (0, 0, 1.35)]
    faces = [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (0, 3, 2, 1)]
    pyramid.from_pydata(verts, [], faces); pyramid.update()
    o = bpy.data.objects.new('Tooth', pyramid)
    bpy.context.collection.objects.link(o); o.parent = r
    _assign(o, M['concrete']); _bevel(o, .05, 2)
    for i in range(3):
        tube('RebarTip_%d' % i, (-.2 + i * .2, 0, 1.34), (-.2 + i * .2, 0, 1.62), .012, M['rust'], r)
    return r


def burnt_tree(root, name='BURNT_TREE'):
    r = empty(name, root)
    tube('Trunk', (0, 0, 0), (.12, .05, 3.8), .23, M['black'], r)
    for i in range(5):
        a = i * 1.9
        tube('Branch_%d' % i, (.06 + math.cos(a) * .1, math.sin(a) * .1, 2.2 + i * .28),
             (math.cos(a) * (1.3 + i * .12), math.sin(a) * (1.3 + i * .12), 3.4 + i * .42),
             .085 - i * .01, M['black'], r)
        tube('Twig_%d' % i, (math.cos(a) * 1.0, math.sin(a) * 1.0, 3.1 + i * .4),
             (math.cos(a) * 1.6, math.sin(a) * 1.6, 4.0 + i * .45), .03, M['black'], r)
    return r


def heli_wreck(root, name='HELI_WRECK'):
    r = empty(name, root)
    hull = empty('Fuselage', r, (0, 0, 1.1))
    sphere('Nose', (0, 2.4, -.2), 1.15, M['armor_dark'], hull, (1, 1.6, .85), 20)
    box('Cabin', (0, .2, .0), (2.1, 3.4, 1.9), M['armor_dark'], .22, hull)
    box('CockpitGlass', (0, 2.0, .38), (1.75, 1.5, .9), M['glass'], .18, hull)
    tube('TailBoom', (0, -1.5, .25), (0, -6.2, .95), .32, M['armor_dark'], hull)
    box('TailFin', (0, -6.2, 1.55), (.12, .85, 1.3), M['armor_dark'], .05, hull)
    cyl('RotorHub', (0, 0, 1.15), .28, .30, M['gunmetal'], 12, hull)
    for i in range(4):
        a = i * math.pi / 2 + .3
        tube('RotorBlade_%d' % i, (0, 0, 1.28), (math.cos(a) * 5.6, math.sin(a) * 5.6, 1.15 - i * .12),
             .075, M['gunmetal'], hull)
    for s in (-1, 1):
        box('Skid_%s' % s, (s * 1.0, 0, -.95), (.10, 3.4, .10), M['steel'], .02, hull)
        for y in (-1.0, 1.0):
            tube('SkidStrut_%s_%s' % (s, y), (s * 1.0, y, -.9), (s * .75, y, -.45), .05, M['steel'], hull)
    r.rotation_euler = (math.radians(13), math.radians(-9), math.radians(22))
    return r


def flag(root, name='FLAG', faction='enemy'):
    r = empty(name, root)
    tube('Pole', (0, 0, 0), (0, 0, 5.2), .045, M['steel'], r)
    cyl('Finial', (0, 0, 5.25), .085, .14, M['amber'], 12, r)
    cloth = plane('Cloth', (.62, 0, 4.45), (1.24, .85),
                  M['cloth'] if faction == 'enemy' else M['blue'], r, rot=(90, 0, 0))
    for i in range(4):
        box('Fold_%d' % i, (.12 + i * .3, 0, 4.45), (.03, .85, .02),
            M['black'], .002, r, rot=(90, 0, 0))
    return r


def antenna(root, name='ANTENNA'):
    r = empty(name, root)
    for z in (1.0, 5.0, 9.0, 13.0):
        s = 1.0 - z * .045
        for x in (-s, s):
            for y in (-s, s):
                tube('Leg_%s_%s_%s' % (z, x, y), (x * 1.25, y * 1.25, z - 3.6), (x, y, z), .035, M['steel'], r)
        tube('Ring_%s' % z, (-s, -s, z), (s, -s, z), .025, M['steel'], r)
        tube('RingB_%s' % z, (s, -s, z), (s, s, z), .025, M['steel'], r)
        tube('RingC_%s' % z, (s, s, z), (-s, s, z), .025, M['steel'], r)
        tube('RingD_%s' % z, (-s, s, z), (-s, -s, z), .025, M['steel'], r)
    tube('Mast', (0, 0, 13), (0, 0, 17), .04, M['steel'], r)
    cyl('Dish', (0, 0, 14.2), .65, .12, M['armor'], 20, r, rot=(70, 0, 0))
    cyl('Beacon', (0, 0, 17.1), .10, .18, M['red'], 10, r)
    return r


# -----------------------------------------------------------------------------
# Scene assembly / showroom / export
# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# ASSET: family of distinct small arms, driven by one parametric builder
# -----------------------------------------------------------------------------

def gun(root, name, kind='smg'):
    """Compact SMG / belt-fed LMG / pump shotgun / bolt sniper / rocket tube."""
    g = empty(name, root)
    gunmetal, black, steel, wood = M['gunmetal'], M['black'], M['steel'], M['wood']
    L = {'smg': .46, 'lmg': .82, 'shotgun': .72, 'sniper': .95, 'launcher': .86}[kind]

    if kind == 'launcher':
        cyl('Tube', (0, .18, 0), .058, .92, M['armor_dark'], 18, g, rot=(90, 0, 0))
        cyl('TubeMouth', (0, .64, 0), .068, .06, steel, 18, g, rot=(90, 0, 0))
        cyl('TubeRear', (0, -.28, 0), .075, .07, black, 18, g, rot=(90, 0, 0))
        box('Grip', (0, -.02, -.105), (.05, .06, .14), black, .008, g, rot=(-12, 0, 0))
        box('TriggerGroup', (0, .02, -.075), (.055, .11, .06), gunmetal, .008, g)
        cyl('Optic', (.045, .12, .065), .026, .13, gunmetal, 12, g, rot=(90, 0, 0))
        box('SightBracket', (.04, .12, .035), (.02, .1, .06), steel, .004, g)
        cyl('Rocket', (0, .58, 0), .042, .32, M['rust'], 14, g, rot=(90, 0, 0))
        cone = bpy.data.meshes.new('WarheadMesh')
        cone.from_pydata([(0, 0, .18), (.042, 0, 0), (0, .042, 0), (-.042, 0, 0), (0, -.042, 0)],
                         [], [(0, 1, 2), (0, 2, 3), (0, 3, 4), (0, 4, 1)])
        cone.update()
        w = bpy.data.objects.new('Warhead', cone); bpy.context.collection.objects.link(w)
        w.parent = g; w.location = (0, .74, 0); w.rotation_euler.x = math.radians(-90)
        _assign(w, black)
        return g

    box('Receiver', (0, 0, 0), (.068, .24, .082), gunmetal, .01, g)
    box('Upper', (0, .02, .052), (.062, .22, .044), gunmetal, .006, g)
    box('Handguard', (0, L * .42, .008), (.058, L * .48, .056), black, .012, g)
    cyl('Barrel', (0, L * .78, .012), .012 if kind != 'shotgun' else .019, L * .55,
        gunmetal, 14, g, rot=(90, 0, 0))
    if kind == 'shotgun':
        cyl('MagTube', (0, L * .44, -.032), .016, L * .5, steel, 12, g, rot=(90, 0, 0))
        box('Pump', (0, L * .42, -.052), (.062, .10, .045), black, .01, g)
        cyl('Muzzle', (0, L * 1.02, .012), .024, .035, steel, 12, g, rot=(90, 0, 0))
    if kind == 'sniper':
        cyl('MuzzleBrake', (0, L * 1.03, .012), .022, .075, steel, 12, g, rot=(90, 0, 0))
        cyl('BoltHandle', (.042, -.06, .02), .012, .075, steel, 10, g, rot=(0, 0, 90))
    if kind == 'lmg':
        cyl('BipodL', (-.04, L * .62, -.06), .008, .22, steel, 8, g, rot=(0, 0, -18))
        cyl('BipodR', (.04, L * .62, -.06), .008, .22, steel, 8, g, rot=(0, 0, 18))
        box('CarryHandle', (0, -.01, .095), (.05, .09, .018), gunmetal, .004, g)
    # stock
    if kind in ('smg', 'lmg'):
        box('Stock', (0, -.19, .005), (.05, .15, .07), black, .01, g)
        cyl('Buffer', (0, -.11, .01), .018, .13, gunmetal, 10, g, rot=(90, 0, 0))
    elif kind == 'shotgun':
        box('Stock', (0, -.20, -.01), (.055, .19, .075), wood, .014, g, rot=(-6, 0, 0))
    else:
        box('Stock', (0, -.20, .0), (.062, .20, .085), M['camo_dark'], .016, g)
        box('Cheek', (0, -.20, .05), (.05, .15, .016), black, .006, g)
    box('PistolGrip', (0, -.085, -.09), (.05, .06, .14), black, .01, g, rot=(-14, 0, 0))
    # magazine
    if kind == 'lmg':
        box('BeltBox', (-.085, .01, -.075), (.09, .14, .16), M['armor_dark'], .012, g)
        for i in range(5):
            box('BeltRound_%d' % i, (-.04 + i * .016, .08, -.02), (.012, .02, .012), M['amber'], .002, g)
    elif kind == 'sniper':
        box('Mag', (0, .02, -.09), (.05, .10, .09), black, .008, g)
    elif kind == 'shotgun':
        pass
    else:
        box('Mag', (0, .02, -.12), (.052, .07, .20), black, .008, g, rot=(9, 0, 0))
    # optic
    if kind in ('sniper', 'lmg'):
        cyl('Scope', (0, .015, .115), .036, .30, gunmetal, 18, g, rot=(90, 0, 0))
        cyl('ScopeBell', (0, .165, .115), .044, .05, gunmetal, 18, g, rot=(90, 0, 0))
        cyl('ScopeGlass', (0, .19, .115), .038, .004, M['glass'], 18, g, rot=(90, 0, 0))
        for z in (-.02, .05):
            box('ScopeRing', (0, z, .09), (.075, .022, .05), black, .004, g)
        cyl('ScopeTurret', (0, .015, .152), .014, .024, gunmetal, 10, g)
    else:
        box('Sight', (0, .02, .088), (.04, .07, .03), gunmetal, .005, g)
        box('SightGlass', (0, .055, .09), (.03, .008, .025), M['glass'], .003, g)
    box('TopRail', (0, .04, .078), (.042, .22, .01), gunmetal, .003, g)
    box('Flashlight', (.04, L * .3, .03), (.018, .07, .018), gunmetal, .004, g, rot=(90, 0, 0))
    cyl('Lamp', (.04, L * .3 + .04, .03), .017, .005, M['amber'], 10, g, rot=(90, 0, 0))
    for i, y in enumerate((-.24, L * .55)):
        torus('Sling_%d' % i, (0, y, .01), .014, .003, steel, g, rot=(0, 90, 0))
    return g


# -----------------------------------------------------------------------------
# ASSET: ZPT-16 wheeled armoured personnel carrier (second drivable vehicle)
# -----------------------------------------------------------------------------

def apc(root, name='APC'):
    r = empty(name, root)
    hull = empty('Hull', r)
    turret = empty('Turret', r, (0, -.35, 2.15))
    gun = empty('Gun', turret, (0, .55, .12))

    box('LowerHull', (0, 0, 1.05), (2.7, 6.0, 1.25), M['armor'], .10, hull)
    box('Glacis', (0, 2.75, 1.55), (2.7, 1.1, .55), M['armor'], .07, hull, rot=(-28, 0, 0))
    box('UpperHull', (0, -.2, 1.72), (2.6, 4.6, .55), M['armor'], .09, hull)
    box('RearRamp', (0, -3.02, 1.05), (2.4, .12, 1.4), M['armor_dark'], .03, hull, rot=(12, 0, 0))
    for s in (-1, 1):
        box('SidePlate_%s' % s, (s * 1.36, .1, 1.45), (.09, 5.6, 1.0), M['armor_dark'], .03, hull)
        for i in range(3):
            y = -1.9 + i * 1.9
            cyl('Wheel_%s_%d' % (s, i), (s * 1.42, y, .62), .48, .28, M['rubber'], 18, hull, rot=(0, 90, 0))
            cyl('Hub_%s_%d' % (s, i), (s * 1.58, y, .62), .19, .05, M['steel'], 12, hull, rot=(0, 90, 0))
            cyl('Rim_%s_%d' % (s, i), (s * 1.60, y, .62), .30, .03, M['gunmetal'], 14, hull, rot=(0, 90, 0))
        box('Fender_%s' % s, (s * 1.4, 0, 1.42), (.34, 6.0, .08), M['armor_dark'], .02, hull)
        for i in range(3):
            box('Stowage_%s_%d' % (s, i), (s * 1.15, -1.7 + i * 1.1, 2.05), (.42, .7, .34), M['armor_dark'], .03, hull)
        box('FiringPort_%s' % s, (s * 1.41, .2, 1.72), (.03, .22, .12), M['glass'], .004, hull)
        box('Headlight_%s' % s, (s * .95, 3.02, 1.55), (.20, .10, .20), M['amber'], .02, hull)
    box('Windshield', (0, 2.52, 2.02), (1.9, .05, .55), M['glass'], .02, hull, rot=(-25, 0, 0))
    tube('Antenna', (-1.1, -2.4, 2.0), (-1.2, -2.5, 4.5), .014, M['gunmetal'], hull)

    box('TurretBase', (0, 0, 0), (1.5, 1.7, .35), M['armor_dark'], .08, turret)
    box('TurretShield', (0, .52, .24), (1.4, .12, .75), M['armor'], .04, turret)
    cyl('Hatch', (0, -.5, .28), .32, .09, M['gunmetal'], 16, turret)
    cyl('Periscope', (.35, -.3, .35), .055, .22, M['gunmetal'], 10, turret)
    for s in (-1, 1):
        cyl('Smoke_%s' % s, (s * .72, .35, .18), .075, .26, M['gunmetal'], 10, turret, rot=(65, 0, s * 20))
    cyl('MGBody', (0, .28, .12), .085, .48, M['gunmetal'], 12, gun, rot=(90, 0, 0))
    cyl('MGBarrel', (0, .92, .12), .028, 1.05, M['gunmetal'], 12, gun, rot=(90, 0, 0))
    box('MGBox', (-.22, .18, .06), (.22, .28, .22), M['armor_dark'], .02, gun)
    return r


def mcom(root, name='MCOM'):
    r = empty(name, root)
    box('Base', (0, 0, .12), (1.2, 1.0, .24), M['armor_dark'], .03, r)
    box('Body', (0, 0, .85), (.9, .72, 1.3), M['armor_dark'], .06, r)
    box('Screen', (0, -.365, 1.0), (.62, .02, .42), M['glass'], .01, r)
    box('Keypad', (0, -.38, .62), (.36, .02, .16), M['gunmetal'], .008, r)
    box('AntennaBase', (0, .0, 1.55), (.18, .18, .14), M['gunmetal'], .02, r)
    tube('Mast', (0, 0, 1.6), (0, 0, 2.9), .028, M['steel'], r)
    cyl('Beacon', (0, 0, 2.95), .09, .16, M['red'], 12, r)
    for s in (-1, 1):
        box('Panel_%s' % s, (s * .46, 0, .85), (.03, .6, 1.1), M['armor'], .01, r)
        cyl('Cable_%s' % s, (s * .38, .2, .35), .02, .7, M['rubber'], 8, r)
    return r


def ruin_wall(root, name='RUIN_WALL'):
    r = empty(name, root)
    for i in range(7):
        h = 2.6 if i < 3 else (1.8 if i < 5 else 1.1)
        if i == 6: continue
        box('Slab_%d' % i, (-3.2 + i * 1.05, 0, h / 2), (1.0, .42, h), M['concrete'], .04, r,
            rot=(0, 0, (-4 + i * 3)))
        tube('Rebar_%d' % i, (-3.2 + i * 1.05, 0, h), (-3.25 + i * 1.05, .05, h + .7), .014, M['rust'], r)
    for i in range(9):
        box('Rubble_%d' % i, (-3.5 + i * .85, .35 + (i % 3) * .12, .14),
            (.6, .55, .28), M['concrete_dark'], .03, r, rot=(i * 13, i * 7, i * 21))
    return r


def rocket(root, name='RPG_ROUND'):
    """Standalone RPG projectile: shaped warhead, motor tube, folding fins."""
    r = empty(name, root)
    cyl('Motor', (0, 0, 0), .043, .44, M['armor_dark'], 14, r, rot=(90, 0, 0))
    cyl('Nozzle', (0, -.235, 0), .052, .055, M['gunmetal'], 14, r, rot=(90, 0, 0))
    cyl('WarheadBand', (0, .18, 0), .046, .035, M['steel'], 14, r, rot=(90, 0, 0))
    mesh = bpy.data.meshes.new('WarheadMesh')
    verts = [(0, .38, 0)]
    for i in range(12):
        a = i / 12 * math.tau
        verts.append((math.cos(a) * .045, .18, math.sin(a) * .045))
    faces = [(0, 1 + i, 1 + (i + 1) % 12) for i in range(12)]
    mesh.from_pydata(verts, [], faces); mesh.update()
    nose = bpy.data.objects.new('Warhead', mesh); bpy.context.collection.objects.link(nose)
    nose.parent = r; _assign(nose, M['rust'])
    for i in range(4):
        a = i / 4 * math.tau
        fin = box('Fin_%d' % i, (math.cos(a) * .055, -.14, math.sin(a) * .055),
                  (.012, .17, .085), M['steel'], .003, r, rot=(0, -a * 180 / math.pi, 0))
        fin.rotation_euler.y = -a
    return r


def bridge(root, name='BRIDGE'):
    r = empty(name, root)
    for s in (-1, 1):
        for i in range(9):
            x = -8 + i * 2
            tube('TrussPost_%s_%d' % (s, i), (x, s * 1.7, 0), (x, s * 1.7, 2.4), .07, M['rust'], r)
            if i < 8:
                tube('TrussDiag_%s_%d' % (s, i), (x, s * 1.7, 0), (x + 2, s * 1.7, 2.4), .05, M['rust'], r)
                tube('TopRail_%s_%d' % (s, i), (x, s * 1.7, 2.4), (x + 2, s * 1.7, 2.4), .06, M['rust'], r)
        tube('BottomRail_%s' % s, (-8, s * 1.7, 0), (8, s * 1.7, 0), .08, M['rust'], r)
    for i in range(17):
        box('Deck_%d' % i, (-8 + i, 0, -.12), (.95, 3.3, .14), M['wood'], .02, r)
    for i in range(9):
        tube('Cross_%d' % i, (-8 + i * 2, -1.7, 2.4), (-8 + i * 2, 1.7, 2.4), .045, M['rust'], r)
    return r


ASSETS = [
    ('soldier_enemy', lambda root: soldier(root, 'SOLDIER_ENEMY', 'enemy')),
    ('soldier_ally', lambda root: soldier(root, 'SOLDIER_ALLY', 'ally')),
    ('rifle', lambda root: rifle(root, 'AR12_KESTREL')),
    ('tank', lambda root: tank(root, 'KALKAN9_TANK')),
    ('bunker', lambda root: bunker(root, 'BUNKER')),
    ('container', lambda root: container(root, 'CONTAINER')),
    ('watchtower', lambda root: watchtower(root, 'WATCHTOWER')),
    ('crate', lambda root: crate(root, 'CRATE')),
    ('barrel', lambda root: barrel(root, 'BARREL')),
    ('sandbags', lambda root: sandbag_wall(root, 'SANDBAGS')),
    ('barrier', lambda root: barrier(root, 'DRAGONTOOTH')),
    ('burnt_tree', lambda root: burnt_tree(root, 'BURNT_TREE')),
    ('heli_wreck', lambda root: heli_wreck(root, 'HELI_WRECK')),
    ('flag', lambda root: flag(root, 'FLAG')),
    ('antenna', lambda root: antenna(root, 'ANTENNA')),
    ('apc', lambda root: apc(root, 'ZPT16_APC')),
    ('mcom', lambda root: mcom(root, 'MCOM')),
    ('ruin_wall', lambda root: ruin_wall(root, 'RUIN_WALL')),
    ('bridge', lambda root: bridge(root, 'BRIDGE')),
    ('wpn_smg', lambda root: gun(root, 'WPN_SMG', 'smg')),
    ('wpn_lmg', lambda root: gun(root, 'WPN_LMG', 'lmg')),
    ('wpn_shotgun', lambda root: gun(root, 'WPN_SHOTGUN', 'shotgun')),
    ('wpn_sniper', lambda root: gun(root, 'WPN_SNIPER', 'sniper')),
    ('wpn_launcher', lambda root: gun(root, 'WPN_LAUNCHER', 'launcher')),
    ('rocket', lambda root: rocket(root, 'RPG_ROUND')),
]


def descendants(o):
    out = [o]
    for c in o.children:
        out += descendants(c)
    return out


def main():
    global M, TEX
    bpy.ops.wm.read_factory_settings(use_empty=True)
    TEX = build_textures()
    M = build_materials()

    roots = {}
    cols = 5
    for idx, (key, builder) in enumerate(ASSETS):
        x = (idx % cols) * 14.0
        y = -(idx // cols) * 14.0
        root = empty('ROOT_' + key.upper(), None, (x, y, 0))
        roots[key] = (root, (x, y, 0))
        builder(root)
        print('[kit] modelled %-16s %3d objects' % (key, len(descendants(root)) - 1))

    # lighting / camera for anybody opening the .blend
    world = bpy.data.worlds.new('Dusk Sky')
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (.16, .18, .24, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = .9
    sun = bpy.data.lights.new('Low Sun', 'SUN'); sun.energy = 3.2; sun.color = (1, .72, .45)
    so = bpy.data.objects.new('Low Sun', sun); bpy.context.collection.objects.link(so)
    so.rotation_euler = (math.radians(58), math.radians(-22), math.radians(-35))
    fill = bpy.data.lights.new('Sky Fill', 'AREA'); fill.energy = 900; fill.size = 30
    fo = bpy.data.objects.new('Sky Fill', fill); bpy.context.collection.objects.link(fo)
    fo.location = (-10, -20, 24)
    cam = bpy.data.cameras.new('Showroom Camera')
    co = bpy.data.objects.new('Showroom Camera', cam); bpy.context.collection.objects.link(co)
    co.location = (34, -46, 26)
    co.rotation_euler = (math.radians(58), 0, math.radians(30))
    bpy.context.scene.camera = co
    bpy.context.scene.render.engine = 'CYCLES'
    bpy.context.scene.cycles.samples = 32

    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, 'blender', 'IRON_HORIZON_KIT.blend'),
                                compress=True)
    print('[kit] saved master .blend')

    for key, (root, orig) in roots.items():
        root.location = (0, 0, 0)
        bpy.context.view_layer.update()
        bpy.ops.object.select_all(action='DESELECT')
        for o in descendants(root):
            o.select_set(True)
        bpy.context.view_layer.objects.active = root
        bpy.ops.export_scene.gltf(
            filepath=os.path.join(GLB_DIR, key + '.glb'),
            export_format='GLB',
            use_selection=True,
            export_apply=False,
            export_yup=True,
            export_materials='EXPORT',
            export_image_format='AUTO',
            export_cameras=False,
            export_lights=False,
            export_extras=True,
        )
        print('[kit] exported %-16s -> %s.glb' % (key, key))
        root.location = orig
    bpy.context.view_layer.update()
    print('[kit] DONE')


if __name__ == '__main__':
    main()
