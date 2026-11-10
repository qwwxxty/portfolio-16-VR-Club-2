// Згладжує нормалі моделі: усереднює нормалі граней у вершинах з однаковою позицією (кут до 60°).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const [src, dst] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const COS = Math.cos(60 * Math.PI / 180);
for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
  const pos = prim.getAttribute('POSITION').getArray();
  const idx = prim.getIndices().getArray();
  const nV = pos.length / 3;
  const key = new Int32Array(nV); const ids = new Map();
  for (let i = 0; i < nV; i++) {
    const k = Math.round(pos[i*3]*2e4) + '_' + Math.round(pos[i*3+1]*2e4) + '_' + Math.round(pos[i*3+2]*2e4);
    let id = ids.get(k); if (id === undefined) { id = ids.size; ids.set(k, id); } key[i] = id;
  }
  const lists = Array.from({ length: ids.size }, () => []);
  const own = new Float32Array(nV * 3); // власна (плоска) нормаль вершини
  for (let f = 0; f < idx.length; f += 3) {
    const [a, b, c] = [idx[f], idx[f+1], idx[f+2]];
    const e1 = [pos[b*3]-pos[a*3], pos[b*3+1]-pos[a*3+1], pos[b*3+2]-pos[a*3+2]];
    const e2 = [pos[c*3]-pos[a*3], pos[c*3+1]-pos[a*3+1], pos[c*3+2]-pos[a*3+2]];
    const n = [e1[1]*e2[2]-e1[2]*e2[1], e1[2]*e2[0]-e1[0]*e2[2], e1[0]*e2[1]-e1[1]*e2[0]]; // вага = площа
    for (const v of [a, b, c]) { lists[key[v]].push(n); own[v*3] += n[0]; own[v*3+1] += n[1]; own[v*3+2] += n[2]; }
  }
  const out = new Float32Array(nV * 3);
  for (let i = 0; i < nV; i++) {
    let ox = own[i*3], oy = own[i*3+1], oz = own[i*3+2]; const ol = Math.hypot(ox, oy, oz) || 1; ox/=ol; oy/=ol; oz/=ol;
    let x = 0, y = 0, z = 0;
    for (const n of lists[key[i]]) { const l = Math.hypot(n[0], n[1], n[2]) || 1; if ((n[0]*ox + n[1]*oy + n[2]*oz) / l >= COS) { x += n[0]; y += n[1]; z += n[2]; } }
    const l = Math.hypot(x, y, z) || 1; out[i*3] = x/l; out[i*3+1] = y/l; out[i*3+2] = z/l;
  }
  /* Додаткова дифузія нормалей між сусідами (до 40°): прибирає «гранованість» відбиттів на склі. */
  const nb = Array.from({ length: nV }, () => new Set());
  for (let f = 0; f < idx.length; f += 3) { const t = [idx[f], idx[f+1], idx[f+2]]; for (const u of t) for (const w of t) if (u !== w) nb[u].add(w); }
  const groups = Array.from({ length: ids.size }, () => []);
  for (let i = 0; i < nV; i++) groups[key[i]].push(i);
  for (let i = 0; i < nV; i++) { const mine = new Set(nb[i]); for (const j of groups[key[i]]) if (j !== i) { mine.add(j); for (const w of nb[j]) mine.add(w); } nb[i] = [...mine]; }
  const COS2 = Math.cos(40 * Math.PI / 180);
  let cur = out;
  for (let it = 0; it < 16; it++) {
    const nx = new Float32Array(nV * 3);
    for (let i = 0; i < nV; i++) {
      const ax = cur[i*3], ay = cur[i*3+1], az = cur[i*3+2]; let x = ax, y = ay, z = az;
      for (const j of nb[i]) { const bx = cur[j*3], by = cur[j*3+1], bz = cur[j*3+2]; if (ax*bx + ay*by + az*bz >= COS2) { x += bx; y += by; z += bz; } }
      const l = Math.hypot(x, y, z) || 1; nx[i*3] = x/l; nx[i*3+1] = y/l; nx[i*3+2] = z/l;
    }
    cur = nx;
  }
  prim.getAttribute('NORMAL').setArray(cur);
  console.log('verts', nV, 'unique positions', ids.size);
}
await io.write(dst, doc);
