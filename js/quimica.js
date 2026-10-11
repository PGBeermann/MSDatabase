/* MSDatabase — utilidades químicas comunes para la interpretación de espectros.
 * Depende de RDKit.js (MinimalLib) y del motor EIMS (build/js/eims-engine.js), que aporta MolGraph.
 * Funciona en el navegador (window.MSDB) y en Node (globalThis.MSDB) para las pruebas.
 */
(function (G) {
  'use strict';
  const MSDB = G.MSDB = G.MSDB || {};

  const RDKIT_VERSION = '2026.3.6';
  const RDKIT_CDN = `https://cdn.jsdelivr.net/npm/@rdkit/rdkit@${RDKIT_VERSION}/dist/`;
  let promesaRDKit = null;

  /** Carga RDKit.js una sola vez (local en rdkit/, con respaldo en jsDelivr). */
  function cargarRDKit() {
    if (G.__RDKit) return Promise.resolve(G.__RDKit);
    if (promesaRDKit) return promesaRDKit;
    const intentar = (base) => new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = base + 'RDKit_minimal.js';
      s.onload = () => G.initRDKitModule({ locateFile: () => base + 'RDKit_minimal.wasm' }).then(res, rej);
      s.onerror = () => rej(new Error('No se pudo cargar ' + s.src));
      document.head.appendChild(s);
    });
    promesaRDKit = intentar('rdkit/').catch(() => intentar(RDKIT_CDN)).then(R => (G.__RDKit = R));
    return promesaRDKit;
  }

  /**
   * Clases de equivalencia topológica (refinamiento iterativo tipo Morgan/Weininger).
   * Átomos con la misma clase son constitucionalmente equivalentes (no se distinguen
   * protones diastereotópicos ni efectos de la estereoquímica).
   */
  function clasesEquivalencia(g) {
    let lab = g.atoms.map(a => [a.el, a.aromatic ? 1 : 0, a.h, a.chg, a.nbrs.length, a.rings.length ? 1 : 0,
      a.nbrs.map(n => g.bonds[n.bond].aromatic ? 1.5 : g.bonds[n.bond].order).sort().join(',')].join('|'));
    const compactar = arr => { const m = new Map(); [...new Set(arr)].sort().forEach((k, i) => m.set(k, i)); return arr.map(k => m.get(k)); };
    let cls = compactar(lab);
    let nClases = new Set(cls).size;
    for (let it = 0; it < g.n + 2; it++) {
      lab = g.atoms.map((a, i) => cls[i] + ':' + a.nbrs.map(n => {
        const b = g.bonds[n.bond];
        return (b.aromatic ? 'a' : b.order) + '-' + cls[n.atom];
      }).sort().join(','));
      const nuevo = compactar(lab);
      const nN = new Set(nuevo).size;
      cls = nuevo;
      if (nN === nClases) break;
      nClases = nN;
    }
    return cls;
  }

  /** Coincidencias de un patrón SMARTS: lista de arreglos de índices de átomos. */
  function coincidencias(R, mol, smarts) {
    let q = null;
    try {
      q = R.get_qmol(smarts);
      if (!q || (q.is_valid && !q.is_valid())) return [];
      const r = JSON.parse(mol.get_substruct_matches(q) || '[]');
      return (Array.isArray(r) ? r : []).map(m => m.atoms || []);
    } catch (_) {
      return [];
    } finally {
      if (q) q.delete();
    }
  }

  /**
   * Prepara la molécula para la interpretación a partir de un SMILES o un molfile.
   * Devuelve { R, smiles, mol, g, clases, formula, ... }. Liberar con liberar(ctx).
   */
  async function prepararMolecula(compuesto) {
    const R = await cargarRDKit();
    const entrada = (compuesto && (compuesto.smiles || compuesto.molfile)) || null;
    if (!entrada) throw new Error('No hay estructura disponible (PubChem no devolvió el molfile).');
    let m0 = R.get_mol(entrada);
    if (!m0 || !m0.is_valid()) { if (m0) m0.delete(); throw new Error('RDKit no pudo interpretar la estructura.'); }
    // Se trabaja siempre sobre el SMILES canónico (H implícitos): así los índices de átomos
    // coinciden con los del motor de fragmentación y con los dibujos.
    const smiles = m0.get_smiles();
    m0.delete();
    const frag = smiles.split('.').sort((a, b) => b.length - a.length)[0];
    const mol = R.get_mol(frag);
    const g = new G.EIMS.MolGraph(mol.get_json());
    const clases = clasesEquivalencia(g);
    return { R, smiles: frag, mol, g, clases, formula: g.formulaString, rdb: g.rdb };
  }

  function liberar(ctx) { if (ctx && ctx.mol) { try { ctx.mol.delete(); } catch (_) { /* */ } ctx.mol = null; } }

  /** Dibujo SVG de la molécula con átomos resaltados y, opcionalmente, índices de átomo. */
  function svgMolecula(ctx, atomos, opciones) {
    const o = Object.assign({ width: 320, height: 240, indices: true }, opciones || {});
    try {
      const det = { width: o.width, height: o.height, addAtomIndices: o.indices, atoms: atomos || [], bonds: [],
        highlightColour: [0.36, 0.62, 0.95] };
      return ctx.mol.get_svg_with_highlights(JSON.stringify(det));
    } catch (_) {
      try { return ctx.mol.get_svg(o.width, o.height); } catch (__) { return ''; }
    }
  }

  // ---------------------------------------------------------------- utilidades de grafo
  const esC = (g, i) => g.atoms[i].el === 'C';
  /** Tipo de carbonilo para un C carbonílico: 'acido','ester','amida','cetona','aldehido','anhidrido','haluro_acilo' */
  function tipoCarbonilo(g, i) {
    if (!esC(g, i) || g.carbonylO(i) == null) return null;
    const a = g.atoms[i];
    const vec = a.nbrs.filter(n => n.atom !== g.carbonylO(i)).map(n => ({ at: g.atoms[n.atom], ord: g.bonds[n.bond].order }));
    for (const v of vec) {
      if (['Cl', 'Br'].includes(v.at.el)) return 'haluro_acilo';
      if (v.at.el === 'N') return 'amida';
      if (v.at.el === 'O' && v.ord === 1) {
        if (v.at.h > 0) return 'acido';
        const otro = v.at.nbrs.map(n => n.atom).find(j => j !== i);
        if (otro != null && esC(g, otro) && g.carbonylO(otro) != null) return 'anhidrido';
        return 'ester';
      }
    }
    if (a.h > 0) return 'aldehido';
    return 'cetona';
  }
  function conjugadoConArilo(g, i) { return g.atoms[i].nbrs.some(n => g.atoms[n.atom].aromatic || (g.doubleBondPartner(n.atom, 'C') != null && n.atom !== i)); }

  /** Formatea una fórmula con subíndices HTML. */
  const sub = f => String(f || '').replace(/(\d+)/g, '<sub>$1</sub>');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  MSDB.quimica = { cargarRDKit, prepararMolecula, liberar, clasesEquivalencia, coincidencias, svgMolecula,
    tipoCarbonilo, conjugadoConArilo, sub, esc, RDKIT_VERSION };
})(typeof window !== 'undefined' ? window : globalThis);
