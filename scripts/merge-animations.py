"""
Imports every .fbx in INPUT_DIR, renames its animation action to the filename
(no extension), then exports all actions combined into OUTPUT_GLB.

Usage (headless):
  blender --background --python scripts/merge-animations.py
"""

import bpy
import os

INPUT_DIR  = r"E:\dev\web\Lucky-claude\Animations_new"
OUTPUT_GLB = r"E:\dev\web\lucky-luke-duel\public\animations.glb"

# Start from a clean slate
bpy.ops.wm.read_factory_settings(use_empty=True)

for filename in sorted(os.listdir(INPUT_DIR)):
    if not filename.lower().endswith(".fbx"):
        continue

    anim_name = os.path.splitext(filename)[0]   # strip .fbx
    filepath  = os.path.join(INPUT_DIR, filename)

    print(f"Importing: {filename}  →  action '{anim_name}'")

    # Snapshot actions that already exist before this import
    before = set(bpy.data.actions.keys())

    bpy.ops.import_scene.fbx(filepath=filepath)

    # Find all actions added by this import and rename them
    new_actions = [a for a in bpy.data.actions if a.name not in before]
    for i, action in enumerate(new_actions):
        action.name = anim_name if i == 0 else f"{anim_name}.{i:03d}"
        print(f"  renamed → '{action.name}'")

# Export all objects + animations as a single GLB
bpy.ops.export_scene.gltf(
    filepath=OUTPUT_GLB,
    export_format="GLB",
    export_animations=True,
    export_all_influences=False,
    export_morph=False,
    export_lights=False,
    export_cameras=False,
)

print(f"\nDone → {OUTPUT_GLB}")
print("Actions exported:")
for a in bpy.data.actions:
    print(f"  {a.name}")
