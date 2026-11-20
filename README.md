# Mirror Duplicate for Blockbench

A Blockbench 5.2+ plugin: duplicate meshes (and cubes) as **true mirror images**. You model and paint the left side,
and one step makes the right side.

## Why not Flip X?
**Transform ▸ Flip X** on a mesh mirrors only the **selected points** while you're in point, edge or face selection
mode. With no points selected it changes nothing, with no error. In object selection mode (the diamond) it does
mirror the whole mesh, but in place, so you'd need Ctrl+D first and then rename and regroup the copy by hand.
Moving a copy to negative X doesn't mirror its shape either.

## What it does
For each selected mesh or cube, in one undo step:
- **Copies and mirrors it** across a plane: X, Y or Z, through the world centre (0) or the selection's centre.
  The points, pivot and rotation are mirrored the same way Blockbench's own Flip does it, so the copy sits
  exactly opposite.
- **Fixes the face winding**, so the copy isn't inside-out.
- **Keeps the UVs and texture**, so the copy shares the painted texture.
- **Swaps the side in the name:** `_l`↔`_r`, `_L`↔`_R`, `.L`↔`.R`, `left`↔`right`. Names without a side get
  `_mirror`.
- **Places it** in the mirrored-name group if one exists (a part in `leg_l` goes to `leg_r`), otherwise next to
  the original. The same works for armature bones when you use
  [Bones as Folders](https://github.com/yarrbeard-gyps/blockbench-bones-as-folders) (`lid_l` → `lid_r`), and parts
  directly under an armature stay in it. The copies end up selected.

Cubes use Blockbench's own cube flip, which also swaps their east/west UVs.

## Install
**File ▸ Plugins ▸ Load Plugin from File**, then pick [`mirror_duplicate.js`](mirror_duplicate.js) (optionally keep
`about.md` next to it).

## Use
Select the left-side parts (Edit mode), then **Transform ▸ Mirror Duplicate...** or right-click a part ▸
**Mirror Duplicate...** Pick the axis and plane (remembered for next time) and confirm. To give it a shortcut,
search for "Mirror Duplicate" in **Settings ▸ Keybindings**.

## Limits
- A part inside a **rotated** group that has no mirrored twin group is mirrored in model space, ignoring the group's
  rotation. A message tells you to check its placement. Mirrored twin groups (`leg_l` / `leg_r`) are fine.
- Vertex weights aren't copied. Run Calculate Vertex Weights on the copies if they're rigged.

## Tested
In Blockbench 5.2.2 on a real model: left-side eyes, eyelids and legs were mirrored to the right, sharing the
painted texture and rendering the right way out.

Offline: `node tests/verify_mirror_duplicate.js` checks, in world space with a rotated mesh (Euler ZYX and XYZ),
mirrored across X, Y and Z planes:
- every point lands exactly opposite;
- the face normals come out mirrored and still point outward. The test fails if the winding fix is removed.
- the UVs are kept.

It also runs the plugin against a mock of Blockbench to check naming, twin groups, the plane choice, undo, selection,
menus and unload.

## Credits
Written with the help of an AI coding assistant (Claude). Issues and pull requests are welcome.

## License
[MIT](LICENSE)
