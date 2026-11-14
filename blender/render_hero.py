"""
DEMİR UFUK — cinematic key frame, rendered entirely inside Blender/Cycles.
Reuses the exact same asset + texture pipeline as the game (make_assets.py),
stages a dusk diorama, and applies a subtle filmic bloom/grade pass.

    blender -b -P blender/render_hero.py
Output: blender/hero.png
"""
import bpy
import math
import os
import sys
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
sys.path.insert(0, HERE)
import make_assets as K  # noqa: E402

bpy.ops.wm.read_factory_settings(use_empty=True)
K.TEX = K.build_textures()
K.M = K.build_materials()
M, TEX = K.M, K.TEX

# ---------------------------------------------------------------- ground ---
S = 100
xs = np.linspace(-90, 90, S, dtype=np.float32)
zs = np.linspace(-90, 90, S, dtype=np.float32)
X, Z = np.meshgrid(xs, zs)
n1 = K.fbm(S, S, 101, 5, 4)
n2 = K.fbm(S, S, 202, 4, 12)
H = (n1 - .5) * 3.2 + (n2 - .5) * .8
for cx, cz, r, d in [(-18, 12, 9, 1.1), (14, -8, 7, .9), (30, 20, 11, 1.3), (-32, -20, 8, 1.0)]:
    dd = np.sqrt((X - cx) ** 2 + (Z - cz) ** 2)
    H -= d * np.clip(1 - (dd / r) ** 2, 0, 1) ** 2
H += .25 * np.sin(X * .08) * np.cos(Z * .07)

verts = [(float(X[j, i]), float(Z[j, i]), float(H[j, i])) for j in range(S) for i in range(S)]
faces = []
for j in range(S - 1):
    for i in range(S - 1):
        a = j * S + i
        faces.append((a, a + 1, a + S + 1, a + S))
mesh = bpy.data.meshes.new('TerrainMesh')
mesh.from_pydata(verts, [], faces)
mesh.update()
uv = mesh.uv_layers.new(name='UVMap')
for poly in mesh.polygons:
    for li in poly.loop_indices:
        v = mesh.vertices[mesh.loops[li].vertex_index].co
        uv.data[li].uv = ((v.x + 90) / 180 * 12, (v.y + 90) / 180 * 12)
ground = bpy.data.objects.new('TERRAIN', mesh)
bpy.context.collection.objects.link(ground)

# earthy ground texture from the same noise lab
grain = K.fbm(256, 256, 303, 5, 6)
macro = K.fbm(256, 256, 404, 4, 3)
scorch = K.clamp01((K.fbm(256, 256, 505, 3, 8) - .66) * 5)
base = np.array([.20, .175, .135], np.float32)[None, None, :] * (.65 + macro[..., None] * .8)
base += (grain[..., None] - .5) * .09
base = base * (1 - scorch[..., None] * .55)
grnd_img = K.make_image('T_GROUND_HERO', base)
grnd_nrm = K.make_image('T_GROUND_HERO_N', K.height_normal(macro * .7 + grain * .3, 2.4))
gm = bpy.data.materials.new('M_GroundHero'); gm.use_nodes = True
bs = gm.node_tree.nodes.get('Principled BSDF')
bs.inputs['Roughness'].default_value = .98
t = gm.node_tree.nodes.new('ShaderNodeTexImage'); t.image = grnd_img; t.extension = 'REPEAT'
gm.node_tree.links.new(t.outputs['Color'], bs.inputs['Base Color'])
tn = gm.node_tree.nodes.new('ShaderNodeTexImage'); tn.image = grnd_nrm
tn.image.colorspace_settings.name = 'Non-Color'
nm = gm.node_tree.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = .8
gm.node_tree.links.new(tn.outputs['Color'], nm.inputs['Color'])
gm.node_tree.links.new(nm.outputs['Normal'], bs.inputs['Normal'])
ground.data.materials.append(gm)


def gh(x, y):
    i = int(np.clip((x + 90) / 180 * (S - 1), 0, S - 1))
    j = int(np.clip((y + 90) / 180 * (S - 1), 0, S - 1))
    return float(H[j, i])


def put(obj, x, y, rot=0, scale=1, lift=0):
    obj.location = (x, y, gh(x, y) + lift)
    obj.rotation_euler.z = math.radians(rot)
    obj.scale = (scale, scale, scale)
    return obj


# ---------------------------------------------------------------- staging ---
# build directly (builders accept None as the parent)
tank = K.tank(None, 'HERO_TANK')
put(tank, -2, 2, -68, 1, .05)
tur = next((o for o in tank.children_recursive if o.name == 'Turret'), None)
gun = next((o for o in tank.children_recursive if o.name == 'Gun'), None)
if tur: tur.rotation_euler.z = math.radians(18)
if gun: gun.rotation_euler.x = math.radians(-4)

for i, (x, y, r) in enumerate([(-9, -7, 25), (-13, 1, 12), (6, -11, -35), (12, -4, -60)]):
    s = K.soldier(None, 'HERO_SOLDIER_%d' % i, 'enemy' if i % 3 else 'ally')
    put(s, x, y, r, 1.0, .0)

bunk = K.bunker(None, 'HERO_BUNKER'); put(bunk, -26, 20, 24, 1, 0)
tow = K.watchtower(None, 'HERO_TOWER'); put(tow, -34, -18, -12, 1, 0)
ant = K.antenna(None, 'HERO_ANTENNA'); put(ant, 30, -26, 0, 1, 0)
heli = K.heli_wreck(None, 'HERO_HELI'); put(heli, 26, 24, 32, 1.1, .3)
for i, (x, y, r) in enumerate([(16, 13, 8), (16, 19, 6), (22, 12, 92)]):
    c = K.container(None, 'HERO_CONTAINER_%d' % i); put(c, x, y, r, 1, 0)
for i, (x, y, r) in enumerate([(-5, -14, 14), (4, -18, -8), (10, 8, 30)]):
    sb = K.sandbag_wall(None, 'HERO_SANDBAGS_%d' % i); put(sb, x, y, r, 1, 0)
for i, (x, y) in enumerate([(-7, 7), (-9, 9), (8, -2), (9, -4), (3, 13)]):
    b = K.barrel(None, 'HERO_BARREL_%d' % i) if i % 2 else K.crate(None, 'HERO_CRATE_%d' % i)
    put(b, x, y, i * 37, 1, 0)
for i, (x, y) in enumerate([(-40, 10), (-42, -6), (36, 6), (40, -12), (-20, 36), (8, 38)]):
    tr = K.burnt_tree(None, 'HERO_TREE_%d' % i); put(tr, x, y, i * 53, .9 + (i % 3) * .25, 0)
for i, (x, y) in enumerate([(-16, 26), (20, 30), (-28, 4)]):
    br = K.barrier(None, 'HERO_BARRIER_%d' % i); put(br, x, y, i * 21, 1, 0)

# scatter rubble
rng = np.random.default_rng(77)
for i in range(180):
    x = float(rng.uniform(-55, 55)); y = float(rng.uniform(-40, 45))
    b = K.box('Rubble_%d' % i, (x, y, gh(x, y) + .06),
              (float(rng.uniform(.15, .8)), float(rng.uniform(.12, .6)), float(rng.uniform(.05, .18))),
              M['concrete_dark'] if i % 3 else M['rust'], .01)
    b.rotation_euler = (float(rng.uniform(0, 3)), float(rng.uniform(0, 3)), float(rng.uniform(0, 6)))

# ---------------------------------------------------------------- lighting ---
world = bpy.data.worlds.new('Dusk Nishita')
bpy.context.scene.world = world
world.use_nodes = True
nt = world.node_tree
nt.nodes.clear()
out = nt.nodes.new('ShaderNodeOutputWorld')
bg = nt.nodes.new('ShaderNodeBackground')
sky = nt.nodes.new('ShaderNodeTexSky')
sky.sky_type = 'NISHITA'
sky.sun_elevation = math.radians(3.2)
sky.sun_rotation = math.radians(118)
sky.air_density = 1.4
sky.dust_density = 3.4
sky.ozone_density = 1.1
bg.inputs['Strength'].default_value = .85
nt.links.new(sky.outputs['Color'], bg.inputs['Color'])
nt.links.new(bg.outputs['Background'], out.inputs['Surface'])

sun = bpy.data.lights.new('Low Sun', 'SUN')
sun.energy = 2.4; sun.color = (1.0, .58, .29); sun.angle = math.radians(1.4)
so = bpy.data.objects.new('Low Sun', sun); bpy.context.collection.objects.link(so)
so.rotation_euler = (math.radians(78), math.radians(-16), math.radians(128))
fill = bpy.data.lights.new('Cool Fill', 'AREA'); fill.energy = 2600; fill.size = 40
fill.color = (.42, .6, 1.0)
fo = bpy.data.objects.new('Cool Fill', fill); bpy.context.collection.objects.link(fo)
fo.location = (-30, -40, 24)
fo.rotation_euler = (Vector((0, 0, 4)) - fo.location).to_track_quat('-Z', 'Y').to_euler()

# warm practical lights (burning wrecks)
for x, y in [(26, 24), (-26, 20)]:
    l = bpy.data.lights.new('Fire', 'POINT'); l.energy = 900; l.color = (1, .35, .08); l.shadow_soft_size = 2
    o = bpy.data.objects.new('Fire', l); bpy.context.collection.objects.link(o)
    o.location = (x, y, gh(x, y) + 2)

# low ground haze volume
vol_mat = bpy.data.materials.new('M_Haze'); vol_mat.use_nodes = True
vn = vol_mat.node_tree.nodes; vn.clear()
vo = vn.new('ShaderNodeOutputMaterial')
vol = vn.new('ShaderNodeVolumePrincipled')
vol.inputs['Color'].default_value = (.55, .42, .32, 1)
vol.inputs['Density'].default_value = .012
vol.inputs['Anisotropy'].default_value = .45
vol_mat.node_tree.links.new(vol.outputs['Volume'], vo.inputs['Volume'])
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 8))
haze = bpy.context.object; haze.name = 'HAZE'
haze.scale = (170, 170, 16)
haze.data.materials.append(vol_mat)

# ---------------------------------------------------------------- camera ---
cam_data = bpy.data.cameras.new('Hero Camera')
cam = bpy.data.objects.new('Hero Camera', cam_data)
bpy.context.collection.objects.link(cam)
cam.location = (-19, -27, 3.4)
cam.rotation_euler = (Vector((1, 6, 2.4)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam_data.lens = 40
cam_data.dof.use_dof = True
cam_data.dof.focus_distance = 32
cam_data.dof.aperture_fstop = 6.3
bpy.context.scene.camera = cam

sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = 40
sc.cycles.use_denoising = True
sc.render.resolution_x = 1400
sc.render.resolution_y = 800
sc.render.resolution_percentage = 100
sc.render.image_settings.file_format = 'PNG'
sc.render.film_transparent = False
sc.view_settings.view_transform = 'AgX'
try:
    sc.view_settings.look = 'AgX - Medium High Contrast'
except Exception:
    pass
sc.view_settings.exposure = .35
sc.render.filepath = os.path.join(HERE, 'hero_raw.png')
bpy.ops.render.render(write_still=True)

# ---------------------------------------------------------------- filmic post ---
img = bpy.data.images.load(sc.render.filepath)
w, h = img.size
arr = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[:, :, :3].copy()
lum = arr @ np.array([.2126, .7152, .0722], np.float32)
bright = np.maximum(lum - .68, 0)[..., None] * arr
# cheap separable-ish bloom via multi-scale box blur
blur = np.zeros_like(arr)
for k in (3, 9, 19, 35):
    pad = np.pad(bright, ((k, k), (k, k), (0, 0)), mode='edge')
    acc = np.zeros_like(bright)
    for dy in (-k, 0, k):
        for dx in (-k, 0, k):
            acc += pad[k + dy:k + dy + h, k + dx:k + dx + w]
    blur += acc / 9.0
arr = arr + blur * .16
# warm/cool split tone + contrast
arr = arr * np.array([1.045, 1.0, .955], np.float32)[None, None, :]
arr = (arr - .5) * 1.06 + .5
# vignette
yy = np.linspace(-1, 1, h)[:, None]; xx = np.linspace(-1, 1, w)[None, :]
vig = 1 - .32 * np.clip((xx * xx + yy * yy) - .28, 0, 1)
arr *= vig[..., None]
# fine grain
arr += (np.random.default_rng(5).random((h, w, 1)).astype(np.float32) - .5) * .018
arr = np.clip(arr, 0, 1)
out_arr = np.concatenate([arr, np.ones((h, w, 1), np.float32)], axis=2)
res = bpy.data.images.new('HERO_GRADED', width=w, height=h, alpha=True)
res.pixels.foreach_set(out_arr.ravel())
res.file_format = 'PNG'
res.filepath_raw = os.path.join(HERE, 'hero.png')
res.save()
print('[hero] saved', res.filepath_raw, os.path.getsize(res.filepath_raw))
