// Offline checks for mirror_duplicate.js. Run: node tests/verify_mirror_duplicate.js
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const FILE = path.resolve(__dirname, '..', 'mirror_duplicate.js');
let pass = 0;
const ok = (cond, msg) => { assert(cond, msg); pass++; console.log('ok  ' + msg); };
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
const clone = o => JSON.parse(JSON.stringify(o));
const core = require(FILE);

// ---- names
const names = { eye_l: 'eye_r', eyelid_l: 'eyelid_r', foreleg_L: 'foreleg_R', 'Arm.L': 'Arm.R', left_foot: 'right_foot', thigh_r: 'thigh_l', shin_l2: 'shin_r2' };
ok(Object.entries(names).every(([a, b]) => core.mirrorName(a) === b), 'side names swap (_l/_r, _L/_R, .L, left/right)');
ok(core.mirrorName('foot') === null && core.mirrorName('helmet') === null, 'names without a side are reported as such (no false hits in "helmet")');

// ---- weights (core)
{
	const head = { name: 'head', vertex_weights: { 'abc123:a': 1, 'abc123:b': 0.4, 'zzz999:a': 1 } };
	const lidL = { name: 'lid_l', vertex_weights: { 'abc123:b': 0.6, 'abc123:c': 1 } };
	const lidR = { name: 'lid_r', vertex_weights: {} };
	const twin = b => (b === lidL ? lidR : b === lidR ? lidL : null);
	const n = core.mirrorWeights([head, lidL, lidR], 'abc123-src', 'def456-dst', twin);
	ok(n === 4, 'every painted weight of the source copied, and only the source weights');
	ok(head.vertex_weights['def456:a'] === 1 && head.vertex_weights['def456:b'] === 0.4, 'weights on side-less bones (head) stay on that bone');
	ok(lidR.vertex_weights['def456:b'] === 0.6 && lidR.vertex_weights['def456:c'] === 1 && !lidL.vertex_weights['def456:b'], 'weights on lid_l go to lid_r, point for point');
	ok(head.vertex_weights['abc123:a'] === 1 && lidL.vertex_weights['abc123:b'] === 0.6, 'source weights untouched');
}

// ---- geometry: world-space check with a rotated mesh, Euler order ZYX and XYZ
const rad = d => d * Math.PI / 180;
const mul = (A, B) => A.map((r, i) => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const Rx = a => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const Ry = a => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
const Rz = a => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
const euler = (r, order) => { const m = { X: Rx(rad(r[0])), Y: Ry(rad(r[1])), Z: Rz(rad(r[2])) }; return mul(mul(m[order[0]], m[order[1]]), m[order[2]]); };
const apply = (M, v) => M.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const worldPts = (d, order) => { const R = euler(d.rotation, order); return Object.fromEntries(Object.entries(d.vertices).map(([k, v]) => [k, apply(R, v).map((x, i) => x + d.origin[i])])); };
const normal = (pts, face) => { const [a, b, c] = face.vertices.map(k => pts[k]); const u = b.map((x, i) => x - a[i]), w = c.map((x, i) => x - a[i]); return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; };

const src = {
	origin: [3, 2, -1], rotation: [20, -35, 50],
	vertices: { a: [0, 0, 0], b: [1, 0, 0], c: [1, 1, 0], d: [0, 1, 0.2], e: [0.5, 0.5, 1] },
	faces: { q: { vertices: ['a', 'b', 'c', 'd'], uv: { a: [0, 0], b: [4, 0], c: [4, 4], d: [0, 4] } }, t: { vertices: ['a', 'b', 'e'], uv: { a: [5, 5], b: [9, 5], e: [7, 9] } } },
};
for (const [axis, center] of [[0, 0], [0, 2.5], [1, 0], [2, -3]]) {
	for (const order of ['ZYX', 'XYZ']) {
		const m = core.mirrorMeshData(clone(src), axis, center);
		const before = worldPts(src, order), after = worldPts(m, order);
		const reflect = p => p.map((x, i) => (i === axis ? 2 * center - x : x));
		const pointsOk = Object.keys(before).every(k => near(after[k], reflect(before[k])));
		// A mirrored outward normal is the original normal with the mirror axis negated.
		const reflectDir = n => n.map((x, i) => (i === axis ? -x : x));
		const windOk = Object.keys(src.faces).every(f => near(normal(after, m.faces[f]), reflectDir(normal(before, src.faces[f]))));
		ok(pointsOk, `${'XYZ'[axis]} = ${center}, ${order}: every point lands exactly opposite`);
		ok(windOk, `${'XYZ'[axis]} = ${center}, ${order}: face normals mirrored (still pointing outward)`);
	}
}
const m0 = core.mirrorMeshData(clone(src), 0, 0);
ok(JSON.stringify(m0.faces.q.uv) === JSON.stringify(src.faces.q.uv) && JSON.stringify(m0.faces.t.uv) === JSON.stringify(src.faces.t.uv), 'UVs kept per point');

// ---- plugin layer against a mock of Blockbench
class Group { constructor(name, parent, rotation = [0, 0, 0]) { this.name = name; this.parent = parent; this.rotation = rotation; this.children = []; } }
class Node {
	constructor(data) { Object.assign(this, clone(data)); this.uuid = 'n' + Math.random(); }
	getSaveCopy() { const d = clone(this); d.uuid = this.uuid; delete d.parent; return d; }
	sortInBefore(el) { this.parent = el.parent; this.inserted = 'beside'; return this; }
	addTo(p) { this.parent = p; p.children.push(this); return this; }
	init() { return this; } markAsSelected() { selected.push(this); }
}
class Mesh extends Node {}
class Cube extends Node { flip(axis, center) { this.flipped = [axis, center]; this.name = 'blockbench-renamed'; } }
class ArmatureBone { constructor(name) { this.name = name; this.children = []; this.vertex_weights = {}; } getArmature() { return rig; } }
const lidBoneL = new ArmatureBone('lid_l'), lidBoneR = new ArmatureBone('lid_r'), headBone = new ArmatureBone('head'); ArmatureBone.all = [lidBoneL, lidBoneR, headBone];
const rig = { getAllBones: () => [headBone, lidBoneL, lidBoneR] };
const armature = { name: 'armature', children: [] };
const legL = new Group('leg_l', 'root'), legR = new Group('leg_r', 'root'), body = new Group('body', 'root', [0, 0, 10]);
const thigh = new Mesh(Object.assign(clone(src), { name: 'thigh_l', texture: 't1' })); thigh.parent = legL;
const eye = new Mesh(Object.assign(clone(src), { name: 'eye_l' })); eye.parent = body;
const box = new Cube({ name: 'nail', origin: [1, 0, 0], from: [0, 0, 0], to: [1, 1, 1], rotation: [0, 0, 0] }); box.parent = 'root';
let selected = [], undo = [], quick = '', registered, action, dialog, menus = { transform: [] };
const sep = id => Object.assign(Object.create(MenuSeparator.prototype), { id });
function MenuSeparator() {}
Mesh.prototype.menu = { structure: ['a', sep('settings'), 'b'], addAction(a, i) { this.structure.splice(i, 0, a); } };
Cube.prototype.menu = { structure: [sep('settings')], addAction(a, i) { this.structure.splice(i, 0, a); } };
const ctx = {
	Plugin: { register: (id, o) => { registered = { id, o }; } }, BARS: {}, Mesh, Cube, Group, MenuSeparator, ArmatureBone,
	Outliner: { selected: [thigh, eye, box] }, getSelectionCenter: () => [7, 0, 0],
	Undo: { initEdit: a => undo.push(['init', a]), finishEdit: m => undo.push(['finish', m]) },
	unselectAllElements: () => { selected = []; }, updateSelection() {}, Canvas: { updateView() {} },
	Blockbench: { showQuickMessage: m => { quick = m; } },
	localStorage: { _s: {}, getItem(k) { return this._s[k] ?? null; }, setItem(k, v) { this._s[k] = v; } },
	MenuBar: { addAction: (a, p) => menus[p].push(a) },
	Action: class { constructor(id, o) { action = this; Object.assign(this, o); } delete() { this.deleted = true; } },
	Dialog: class { constructor(o) { dialog = this; this.o = o; } show() {} delete() {} },
};
Group.all = [legL, legR, body];
Array.prototype.remove = function (x) { const i = this.indexOf(x); if (i >= 0) this.splice(i, 1); };
new Function(...Object.keys(ctx), fs.readFileSync(FILE, 'utf8'))(...Object.values(ctx));
registered.o.onload();
ok(menus.transform[0] === action && Mesh.prototype.menu.structure[1] === action && Cube.prototype.menu.structure[0] === action, 'in Transform menu and mesh/cube right-click menus');

action.click();
ok(dialog.o.form.axis.value === '0' && dialog.o.form.plane.value === 'world', 'defaults: X, world centre');
dialog.o.onConfirm({ axis: '0', plane: 'world' });
const [tR, eR, bR] = undo[0][1].elements;
ok(undo.length === 2 && undo[1][1] === 'Mirror duplicate' && undo[0][1].outliner, 'one undo step');
ok(tR.name === 'thigh_r' && eR.name === 'eye_r' && bR.name === 'nail_mirror', 'copies renamed (side swapped, else _mirror)');
ok(tR.parent === legR && eR.parent === body && eR.inserted === 'beside', 'copy goes to the mirrored group (leg_r) or beside the original');
ok(near(tR.origin, [-3, 2, -1]) && near(tR.rotation, [20, 35, -50]), 'origin and rotation mirrored');
ok(tR.vertices.b[0] === -1 && JSON.stringify(tR.faces.q.vertices) === '["b","a","c","d"]', 'points mirrored and winding reversed');
ok(JSON.stringify(tR.faces.q.uv) === JSON.stringify(src.faces.q.uv) && tR.texture === 't1', 'UVs and texture kept');
ok(near(thigh.origin, [3, 2, -1]) && thigh.vertices.b[0] === 1, 'original untouched');
ok(JSON.stringify(bR.flipped) === '[0,0]' && bR.name === 'nail_mirror', 'cube mirrored with Blockbench\'s own flip, name kept');
ok(selected.length === 3 && selected.includes(tR), 'copies selected');
ok(/rotated group/.test(quick), 'warns about the part in a rotated group without a twin');

undo = [];
dialog.o.onConfirm({ axis: '0', plane: 'selection' });
ok(near(undo[0][1].elements[0].origin, [11, 2, -1]), 'selection centre plane (X = 7)');
action.click();
ok(dialog.o.form.plane.value === 'selection', 'last options remembered');

// Parents that aren't groups: an armature (copy stays inside it) and a bone with a twin (Bones as Folders).
const armPart = new Mesh(Object.assign(clone(src), { name: 'toe_l' })); armPart.parent = armature;
const lidPart = new Mesh(Object.assign(clone(src), { name: 'eyelid_l' })); lidPart.parent = lidBoneL;
ctx.Outliner.selected.splice(0, 3, armPart, lidPart);
undo = [];
dialog.o.onConfirm({ axis: '0', plane: 'world' });
const [toeR, lidR] = undo[0][1].elements;
ok(toeR.parent === armature && toeR.name === 'toe_r', 'part under an armature stays in that armature');
ok(lidR.parent === lidBoneR && lidR.name === 'eyelid_r', 'part inside bone lid_l goes into bone lid_r');

// Weights: eyelid_l inside lid_l, back painted to head, front to lid_l, middle split.
const lidPart2 = new Mesh(Object.assign(clone(src), { name: 'eyelid_l' })); lidPart2.parent = lidBoneL; lidPart2.uuid = 'eyeL01-uuid';
lidPart2.getArmature = () => rig;
headBone.vertex_weights = { 'eyeL01:a': 1, 'eyeL01:e': 0.5 };
lidBoneL.vertex_weights = { 'eyeL01:c': 1, 'eyeL01:d': 1, 'eyeL01:e': 0.5 };
lidBoneR.vertex_weights = {};
ctx.Outliner.selected.splice(0, ctx.Outliner.selected.length, lidPart2);
undo = [];
dialog.o.onConfirm({ axis: '0', plane: 'world' });
const tracked = undo[0][1].elements, eyeR = tracked[tracked.length - 1];
const k = vk => eyeR.uuid.substring(0, 6) + ':' + vk;
ok(eyeR.parent === lidBoneR && eyeR.name === 'eyelid_r', 'copy lands inside lid_r by itself');
ok(headBone.vertex_weights[k('a')] === 1 && headBone.vertex_weights[k('e')] === 0.5, 'back and middle weights on head copied');
ok(lidBoneR.vertex_weights[k('c')] === 1 && lidBoneR.vertex_weights[k('e')] === 0.5 && !lidBoneL.vertex_weights[k('c')], 'lid weights moved to lid_r');
ok(['head', 'lid_l', 'lid_r'].every(n => tracked.some(t => t.name === n)) && undo[1][1] === 'Mirror duplicate', 'bones are part of the one undo step');
ok(/vertex weights/.test(quick), 'message mentions the weights');
registered.o.onunload();
ok(action.deleted && !Mesh.prototype.menu.structure.includes(action), 'unload cleans up');
console.log(`\n${pass} checks passed`);
