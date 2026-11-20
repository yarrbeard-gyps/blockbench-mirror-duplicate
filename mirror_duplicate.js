/*
 * Mirror Duplicate for Blockbench 5.2+
 *
 * Duplicates the selected meshes (and cubes) and mirrors each copy across a plane: world X = 0 by default,
 * or Y / Z, through the world centre or the selection's centre. Points, pivot and rotation are mirrored the
 * same way Blockbench's own Flip does it (Mesh.flipSelection in object mode): local points negated on the
 * axis, origin reflected about the plane, the other two rotation angles negated. The face winding is
 * reversed so normals point outward. UVs and textures are kept, so the copy shares the painted texture. Names
 * swap side (_l/_r, _L/_R, left/right), and the copy goes into the mirrored-name group if there is one.
 *
 * Why Transform ▸ Flip X "does nothing" (Blockbench 5.2.2): on meshes it calls Mesh.flipSelection, which in
 * point, edge or face selection mode mirrors only the *selected points*. With none selected, nothing changes and
 * nothing is logged. In object selection mode (the diamond) it mirrors the whole mesh, but in place, moving the
 * original.
 *
 * The functions above "Blockbench layer" have no Blockbench dependencies, for Node tests.
 */
(function () {
	'use strict';

	const PLUGIN_ID = 'mirror_duplicate';
	const STORE_KEY = 'mirror_duplicate.options';

	const SIDE_WORDS = [['left', 'right'], ['Left', 'Right'], ['LEFT', 'RIGHT']];
	const SIDE_LETTERS = [['l', 'r'], ['L', 'R']];

	/** Swap the side in a name: eye_l → eye_r, Arm.L → Arm.R, left_foot → right_foot. null if no side found. */
	function mirrorName(name) {
		for (const [a, b] of SIDE_WORDS) {
			const re = new RegExp(`${a}|${b}`, 'g');
			if (re.test(name)) return name.replace(new RegExp(`${a}|${b}`, 'g'), m => (m === a ? b : a));
		}
		// A lone l/r/L/R token, separated by _ . - or space (or at the start/end).
		const re = /(^|[_.\- ])([lLrR])(?=$|[_.\- ]|\d)/g;
		if (!re.test(name)) return null;
		return name.replace(/(^|[_.\- ])([lLrR])(?=$|[_.\- ]|\d)/g, (m, sep, ch) => {
			for (const [a, b] of SIDE_LETTERS) {
				if (ch === a) return sep + b;
				if (ch === b) return sep + a;
			}
			return m;
		});
	}

	/**
	 * Mirror mesh data in place across the plane axis = center (model space).
	 * data: {origin, rotation, vertices: {key: [x,y,z]}, faces: {key: {vertices: [...]}}}
	 */
	function mirrorMeshData(data, axis, center) {
		for (const k in data.vertices) data.vertices[k][axis] *= -1;
		data.origin[axis] = 2 * center - data.origin[axis];
		for (let i = 0; i < 3; i++) if (i !== axis) data.rotation[i] = -data.rotation[i];
		for (const k in data.faces) {
			const v = data.faces[k].vertices;
			if (v && v.length >= 3) [v[0], v[1]] = [v[1], v[0]]; // same as MeshFace.invert()
		}
		return data;
	}

	/**
	 * Copy a mesh's vertex weights to its mirrored copy. Weights live on the bones, keyed meshuuid[0:6]:vkey;
	 * the copy keeps the same vertex keys (each point maps to its own mirror image). Each weight moves to the
	 * bone's twin (lid_l → lid_r) if there is one, else stays on the same bone (head, bag).
	 * bones: [{vertex_weights}], twinOf(bone) → bone | null. Returns how many weights were copied.
	 */
	function mirrorWeights(bones, srcUuid, dstUuid, twinOf) {
		const src = srcUuid.substring(0, 6) + ':', dst = dstUuid.substring(0, 6) + ':';
		const writes = [];
		for (const bone of bones) {
			for (const key of Object.keys(bone.vertex_weights || {})) {
				if (!key.startsWith(src)) continue;
				const w = bone.vertex_weights[key];
				if (!(w > 0)) continue;
				writes.push([twinOf(bone) || bone, dst + key.substring(src.length), w]);
			}
		}
		for (const [bone, key, w] of writes) {
			if (!bone.vertex_weights) bone.vertex_weights = {};
			bone.vertex_weights[key] = w;
		}
		return writes.length;
	}

	const core = { mirrorName, mirrorMeshData, mirrorWeights };

	// Outside Blockbench (Node tests) export the core and stop here.
	if (typeof Plugin === 'undefined' || typeof BARS === 'undefined') {
		if (typeof module === 'object' && module && module.exports) module.exports = core;
		return;
	}

	// ================================================================ Blockbench layer

	const DEFAULTS = { axis: '0', plane: 'world' };
	function loadOptions() {
		try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); }
		catch (err) { return Object.assign({}, DEFAULTS); }
	}
	function saveOptions(o) {
		try { localStorage.setItem(STORE_KEY, JSON.stringify({ axis: o.axis, plane: o.plane })); } catch (err) { /* ignore */ }
	}

	function planeCenter(axis, plane, sources) {
		if (plane !== 'selection') return 0;
		if (typeof getSelectionCenter === 'function') return getSelectionCenter()[axis];
		const vals = sources.map(el => el.origin[axis]);
		return vals.reduce((a, b) => a + b, 0) / vals.length;
	}

	function targetParent(el) {
		const parent = el.parent;
		if (!parent || parent === 'root' || typeof parent !== 'object') return 'root';
		// Groups, armatures and armature bones (Bones as Folders): prefer a twin of the same type, e.g. lid_l → lid_r.
		const name = mirrorName(parent.name || '');
		const pool = parent instanceof Group ? Group.all
			: (typeof ArmatureBone !== 'undefined' && parent instanceof ArmatureBone) ? ArmatureBone.all : [];
		const twin = name && pool.find(g => g.name === name && g !== parent);
		return twin || parent;
	}

	function hasRotatedAncestor(node) {
		let p = node;
		while (p instanceof Group) {
			if (p.rotation && p.rotation.some(r => r)) return true;
			p = p.parent;
		}
		return false;
	}

	function mirrorDuplicate(options) {
		const axis = Number(options.axis) || 0;
		const sources = Outliner.selected.filter(el => el instanceof Mesh || el instanceof Cube);
		if (!sources.length) {
			Blockbench.showQuickMessage('Select one or more meshes or cubes first', 2000);
			return;
		}
		const center = planeCenter(axis, options.plane, sources);
		const copies = [];
		let warnRotated = 0, weightsCopied = 0;

		// Bones of the armatures involved: their weights change, so they're part of the undo step.
		const armatureOf = el => (el instanceof Mesh && typeof el.getArmature === 'function') ? el.getArmature() : undefined;
		const armatures = [...new Set(sources.map(armatureOf).filter(Boolean))];
		const tracked = armatures.flatMap(a => a.getAllBones());
		const twinOf = bone => {
			const name = mirrorName(bone.name || '');
			if (!name) return null;
			const arm = bone.getArmature ? bone.getArmature() : null;
			return (arm ? arm.getAllBones() : []).find(b => b.name === name && b !== bone) || null;
		};

		Undo.initEdit({ elements: tracked, outliner: true, selection: true });
		for (const el of sources) {
			const data = el.getSaveCopy();
			delete data.uuid;
			const parent = targetParent(el);
			if (parent === el.parent && parent instanceof Group && hasRotatedAncestor(parent)) warnRotated++;

			let copy;
			if (el instanceof Mesh) {
				mirrorMeshData(data, axis, center);
				copy = new Mesh(data);
			} else {
				copy = new Cube(data);
			}
			copy.name = mirrorName(el.name) || (el.name + '_mirror');

			if (parent === el.parent) copy.sortInBefore(el, 1);
			else copy.addTo(parent);
			copy.init();
			if (copy instanceof Cube) {
				const name = copy.name;
				copy.flip(axis, center, false); // Blockbench's own cube flip: from/to, origin, rotation, UV faces
				copy.name = name;
			}
			copies.push(copy);
			tracked.push(copy);

			// Vertex weights (armature-direct meshes, and meshes inside bones with Bones as Folders).
			const arm = armatureOf(el);
			if (arm && copy instanceof Mesh) weightsCopied += mirrorWeights(arm.getAllBones(), el.uuid, copy.uuid, twinOf);
		}

		unselectAllElements();
		copies.forEach(c => c.markAsSelected());
		Canvas.updateView({ elements: copies, element_aspects: { transform: true, geometry: true, faces: true, uv: true }, selection: true });
		updateSelection();
		Undo.finishEdit('Mirror duplicate');

		let msg = `Mirrored ${copies.length} part${copies.length === 1 ? '' : 's'} across ${'XYZ'[axis]} = ${+center.toFixed(4)}`;
		if (weightsCopied) msg += `, with their vertex weights`;
		if (warnRotated) msg += `. ${warnRotated} sit in a rotated group that has no mirrored twin, so check their placement`;
		Blockbench.showQuickMessage(msg, 3500);
	}

	let dialog = null, action = null;

	function openDialog() {
		const o = loadOptions();
		if (dialog) dialog.delete();
		dialog = new Dialog({
			id: 'mirror_duplicate_dialog',
			title: 'Mirror Duplicate',
			width: 380,
			form: {
				axis: { label: 'Mirror across', type: 'inline_select', value: o.axis, options: { '0': 'X', '1': 'Y', '2': 'Z' } },
				plane: { label: 'Plane through', type: 'inline_select', value: o.plane, options: { world: 'World centre (0)', selection: 'Selection centre' } },
			},
			onConfirm(r) {
				saveOptions(r);
				mirrorDuplicate(r);
			},
		});
		dialog.show();
	}

	Plugin.register(PLUGIN_ID, {
		title: 'Mirror Duplicate',
		author: 'yarrbeard-gyps',
		description: 'Duplicate meshes and cubes as true mirror images (points, pivot, rotation, winding), keeping UVs and swapping _l/_r names.',
		icon: 'flip',
		version: '1.1.0',
		variant: 'both',
		min_version: '5.2.0',
		tags: ['Modeling', 'Mesh'],
		onload() {
			action = new Action('mirror_duplicate', {
				name: 'Mirror Duplicate...',
				description: 'Duplicate the selection as a mirror image (swaps _l/_r names, keeps UVs)',
				icon: 'flip',
				category: 'edit',
				condition: { modes: ['edit'], method: () => Outliner.selected.some(el => el instanceof Mesh || el instanceof Cube) },
				click: openDialog,
			});
			MenuBar.addAction(action, 'transform');
			// Element right-click menus, just above the "settings" section (after Duplicate and the like).
			for (const type of [Mesh, Cube]) {
				const menu = type.prototype.menu;
				if (!menu || !Array.isArray(menu.structure)) continue;
				const i = menu.structure.findIndex(item => item && item.id === 'settings' && item instanceof MenuSeparator);
				menu.addAction(action, i >= 0 ? i : '');
			}
		},
		onunload() {
			for (const type of [Mesh, Cube]) {
				if (type.prototype.menu && Array.isArray(type.prototype.menu.structure)) type.prototype.menu.structure.remove(action);
			}
			if (action) action.delete();
			if (dialog) dialog.delete();
			action = dialog = null;
		},
	});
})();
