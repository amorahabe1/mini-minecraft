import { WorldGen } from './worldgen.js';
import { meshChunk } from './mesher.js';
let gen = null;
self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') { gen = new WorldGen(m.seed); self.postMessage({ type: 'ready', id: m.id }); }
    else if (m.type === 'gen') {
      const r = gen.generate(m.cx, m.cz);
      self.postMessage({ type: 'gen', id: m.id, cx: m.cx, cz: m.cz, blocks: r.blocks, biomes: r.biomes, heights: r.heights }, [r.blocks.buffer, r.biomes.buffer, r.heights.buffer]);
    } else if (m.type === 'mesh') {
      const r = meshChunk(m.chunks, m.cx, m.cz);
      const tr = [r.light.buffer];
      for (const g of [r.solid, r.trans]) tr.push(g.pos.buffer, g.uv.buffer, g.light.buffer, g.idx.buffer);
      self.postMessage({ type: 'mesh', id: m.id, cx: m.cx, cz: m.cz, version: m.version, solid: r.solid, trans: r.trans, light: r.light }, tr);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String(err && err.stack || err) });
  }
};
