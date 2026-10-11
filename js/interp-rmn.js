/* MSDatabase — interpretación de espectros de RMN de ¹H y ¹³C.
 * - Entornos químicamente equivalentes: clases de equivalencia topológica de la estructura.
 * - δ estimados (aproximaciones aditivas, error típico ±0,2–0,4 ppm en ¹H y ±3–8 ppm en ¹³C):
 *     ¹H sp³: valores de metilo y regla de Shoolery para CH₂ (δ = 0,23 + Σσ) y CH;
 *     ¹H aromático: δ = 7,27 + ΣZ (incrementos orto/meta/para);  ¹³C aromático: δ = 128,5 + ΣZ.
 *     Silverstein et al., Spectrometric Identification of Organic Compounds, 8.ª ed., 2014, cap. 3–4;
 *     Pretsch, Bühlmann, Badertscher, Structure Determination of Organic Compounds, 4.ª ed., Springer, 2009.
 * - Multiplicidad de primer orden (regla n + 1) con los H vecinales no intercambiables.
 * - Señales residuales de disolventes: Fulmer, G. R. et al. Organometallics 2010, 29, 2176–2179.
 */
(function (G) {
  'use strict';
  const MSDB = G.MSDB = G.MSDB || {};
  const Q = () => MSDB.quimica;

  // Incrementos aromáticos. ¹H: [orto, meta, para]; ¹³C: [ipso, orto, meta, para]
  const Z_H = {
    CH3: [-0.18, -0.11, -0.21], alquilo: [-0.15, -0.06, -0.18], vinilo: [0.06, -0.03, -0.10], Ph: [0.37, 0.20, 0.10],
    CF3: [0.32, 0.14, 0.20], COOH: [0.85, 0.18, 0.27], COOR: [0.71, 0.11, 0.21], CHO: [0.56, 0.22, 0.29],
    COR: [0.62, 0.14, 0.21], CONH2: [0.61, 0.10, 0.17], CN: [0.36, 0.18, 0.28], OH: [-0.56, -0.12, -0.45],
    OR: [-0.48, -0.09, -0.44], OCOR: [-0.25, 0.03, -0.13], NH2: [-0.75, -0.25, -0.65], NR2: [-0.66, -0.18, -0.67],
    NHCOR: [0.12, -0.07, -0.28], NO2: [0.95, 0.26, 0.38], F: [-0.26, 0.00, -0.20], Cl: [0.03, -0.02, -0.09],
    Br: [0.18, -0.08, -0.04], I: [0.39, -0.21, 0.00], SR: [-0.08, -0.10, -0.24]
  };
  const Z_C = {
    CH3: [9.3, 0.7, -0.1, -2.9], alquilo: [15.6, -0.5, 0.0, -2.6], vinilo: [9.1, -2.4, 0.2, -0.5], Ph: [13.1, -1.1, 0.4, -1.2],
    CF3: [2.6, -3.1, 0.4, 3.4], COOH: [2.1, 1.6, -0.1, 5.2], COOR: [2.0, 1.2, -0.1, 4.3], CHO: [8.2, 1.2, 0.5, 5.8],
    COR: [8.9, 0.0, -0.1, 4.4], CONH2: [5.0, -1.2, 0.1, 3.4], CN: [-15.7, 3.6, 0.7, 4.3], OH: [26.9, -12.8, 1.4, -7.4],
    OR: [31.4, -14.4, 1.0, -7.7], OCOR: [22.4, -7.1, -0.4, -3.2], NH2: [18.2, -13.4, 0.8, -10.0], NR2: [22.4, -15.7, 0.8, -11.8],
    NHCOR: [9.7, -8.1, 0.2, -4.4], NO2: [19.9, -4.9, 0.9, 6.1], F: [34.8, -13.0, 1.6, -4.4], Cl: [6.2, 0.4, 1.3, -1.9],
    Br: [-5.5, 3.4, 1.7, -1.6], I: [-34.1, 8.9, 1.6, -1.1], SR: [10.2, -1.8, 0.4, -3.6]
  };

  // Disolventes: señales residuales ¹H y ¹³C (Fulmer et al. 2010)
  const DISOLVENTES = [
    { re: /CDCl3|chloroform/i, nombre: 'CDCl₃', h: [[7.26, 'CHCl₃ residual'], [1.56, 'H₂O']], c: [[77.16, 'CDCl₃ (triplete)']] },
    { re: /DMSO/i, nombre: 'DMSO-d₆', h: [[2.50, 'DMSO-d₅ residual'], [3.33, 'H₂O']], c: [[39.52, 'DMSO-d₆ (septuplete)']] },
    { re: /CD3OD|MeOD|methanol/i, nombre: 'CD₃OD', h: [[3.31, 'CHD₂OD residual'], [4.87, 'HOD']], c: [[49.00, 'CD₃OD']] },
    { re: /acetone/i, nombre: 'acetona-d₆', h: [[2.05, 'acetona-d₅ residual'], [2.84, 'H₂O']], c: [[29.84, 'acetona-d₆'], [206.26, 'C=O de acetona-d₆']] },
    { re: /C6D6|benzene/i, nombre: 'C₆D₆', h: [[7.16, 'C₆HD₅ residual'], [0.40, 'H₂O']], c: [[128.06, 'C₆D₆']] },
    { re: /CD3CN|acetonitrile/i, nombre: 'CD₃CN', h: [[1.94, 'CHD₂CN residual'], [2.13, 'H₂O']], c: [[1.32, 'CD₃CN'], [118.26, 'CD₃CN (C≡N)']] },
    { re: /D2O|water|H2O/i, nombre: 'D₂O/H₂O', h: [[4.79, 'HDO']], c: [] }
  ];
  const disolventeDe = s => DISOLVENTES.find(d => d.re.test(String(s || ''))) || null;

  // ---------------------------------------------------------------- clasificación de sustituyentes
  /** Sustituyente j visto desde el carbono sp³ c: { s: σ de Shoolery, me: δ(CH₃–X), et: etiqueta, fuerza } */
  /**
   * Sustituyente j visto desde el carbono sp³ c:
   *   s  = constante de Shoolery (referencia),
   *   z  = incremento ¹H para CH₂/CH (δ = 1,25 o 1,55 + Σz; los alquilos valen 0),
   *   me = δ ¹H de CH₃–X, k13 = clave de incrementos ¹³C α/β/γ, et = etiqueta.
   * Los z se ajustaron a δ de compuestos de referencia (Silverstein 2014; Pretsch 2009).
   */
  function sustituyente(g, c, j) {
    const a = g.atoms[j];
    const tc = Q().tipoCarbonilo;
    const r = (s, z, me, et, k13) => ({ s, z, me, et, k13 });
    if (a.el === 'C') {
      if (a.aromatic) return r(1.85, 1.45, 2.35, 'arilo', 'Ph');
      const t = tc(g, j);
      const arilCO = a.nbrs.some(n => n.atom !== c && g.atoms[n.atom].aromatic);
      if (t === 'aldehido') return r(1.70, 1.20, 2.20, 'CHO', 'CHO');
      if (t === 'cetona') return arilCO ? r(1.85, 1.70, 2.58, 'C(=O)Ar', 'COR') : r(1.70, 1.20, 2.12, 'C=O (cetona)', 'COR');
      if (t === 'acido') return r(1.55, 1.10, 2.08, 'COOH', 'COOH');
      if (t === 'ester' || t === 'anhidrido') return r(1.55, 1.05, 2.05, 'COOR', 'COOR');
      if (t === 'amida') return r(1.59, 1.00, 2.00, 'CONR₂', 'COOR');
      if (t === 'haluro_acilo') return r(1.75, 1.65, 2.66, 'COCl', 'COR');
      if (g.tripleBondPartner(j, 'N') != null) return r(1.70, 1.10, 2.00, 'C≡N', 'CN');
      if (g.tripleBondPartner(j, 'C') != null) return r(1.44, 0.90, 1.80, 'C≡C', 'CCH');
      if (g.doubleBondPartner(j, 'C') != null) return r(1.32, 0.75, 1.70, 'C=C', 'CHCH2');
      if (a.nbrs.filter(n => g.atoms[n.atom].el === 'F').length >= 2) return r(1.14, 0.80, 1.20, 'CF₃', null);
      return r(0.47, 0, 0.90, 'alquilo', null);
    }
    if (a.el === 'O') {
      if (a.h > 0) return r(2.56, 2.30, 3.40, 'OH', 'OH');
      const o = a.nbrs.map(n => n.atom).find(k => k !== c);
      if (o != null && g.atoms[o].aromatic) return r(3.23, 2.75, 3.80, 'O–arilo', 'OR');
      if (o != null && tc(g, o)) {
        const aril = g.atoms[o].nbrs.some(n => g.atoms[n.atom].aromatic);
        return r(3.13, aril ? 3.10 : 2.85, aril ? 3.90 : 3.68, aril ? 'O–C(=O)Ar' : 'O–C(=O)R', 'OCOR');
      }
      return r(2.36, 2.20, 3.30, 'OR', 'OR');
    }
    if (a.el === 'N') {
      if (a.nbrs.filter(n => g.atoms[n.atom].el === 'O').length >= 2) return r(3.80, 3.10, 4.30, 'NO₂', 'NO2');
      if (a.nbrs.some(n => n.atom !== c && tc(g, n.atom))) return r(2.27, 2.00, 2.90, 'N–C(=O) (amida)', 'NHCOR');
      if (a.aromatic || a.nbrs.some(n => g.atoms[n.atom].aromatic)) return r(1.90, 1.85, 2.85, 'N–arilo', 'NR2');
      return r(1.57, 1.25, 2.30, 'NR₂', a.h ? 'NH2' : 'NR2');
    }
    const tabla = { S: [1.64, 1.30, 2.10, 'SR', 'SR'], Cl: [2.53, 2.28, 3.05, 'Cl', 'Cl'], Br: [2.33, 2.15, 2.68, 'Br', 'Br'],
      I: [1.82, 1.95, 2.16, 'I', 'I'], F: [3.85, 3.20, 4.26, 'F', 'F'], P: [1.0, 0.6, 1.5, 'P', null], Si: [0, -1.2, 0, 'Si', null] };
    const t = tabla[a.el] || [1.0, 0.8, 1.5, a.el, null];
    return r(t[0], t[1], t[2], t[3], t[4]);
  }

  // Incrementos ¹³C de sustituyentes en alcanos [α terminal, α interno, β, γ] (Silverstein et al. 2014, tabla 4.x;
  // base de Grant y Paul, J. Am. Chem. Soc. 1964, 86, 2984: δ = −2,3 + 9,1·nα + 9,4·nβ − 2,5·nγ)
  const INC13 = {
    OH: [48, 41, 10, -5], OR: [58, 51, 8, -4], OCOR: [51, 45, 6, -3], COOH: [21, 16, 3, -2], COOR: [20, 17, 3, -2],
    COR: [30, 24, 1, -2], CHO: [31, 31, 0, -2], NH2: [29, 24, 11, -5], NR2: [42, 42, 6, -3], NHCOR: [27, 22, 8, -4],
    Cl: [31, 32, 11, -4], Br: [20, 28, 11, -3], I: [-6, 7, 11, -1], F: [68, 63, 9, -4], CN: [4, 1, 3, -3],
    Ph: [23, 17, 9, -2], CHCH2: [20, 20, 6, -0.5], CCH: [4.5, 4.5, 5.5, -3.5], NO2: [63, 57, 4, -1], SR: [21, 20, 7, -3]
  };

  /** δ ¹³C de un carbono sp³ por Grant–Paul + incrementos α/β/γ de grupos funcionales. */
  function grantPaul(g, i) {
    const sp3C = k => g.atoms[k].el === 'C' && g.isSp3(k) && Q().tipoCarbonilo(g, k) == null;
    let d = -2.3;
    const det = [];
    // BFS por la cadena sp³ hasta distancia 3
    const dist = new Map([[i, 0]]);
    const cola = [i];
    while (cola.length) {
      const u = cola.shift();
      const du = dist.get(u);
      for (const n of g.atoms[u].nbrs) {
        const v = n.atom;
        if (dist.has(v)) continue;
        if (sp3C(v)) {
          if (du + 1 <= 3) { dist.set(v, du + 1); cola.push(v); d += [0, 9.1, 9.4, -2.5][du + 1]; }
        } else if (du <= 2) {
          // grupo funcional unido a un carbono de la cadena a distancia du → posición α (du=0), β (1), γ (2)
          const sub = sustituyente(g, u, v);
          const inc = sub.k13 && INC13[sub.k13];
          if (inc) {
            const internoU = g.atoms[u].nbrs.filter(x => sp3C(x.atom)).length >= 2;
            const val = du === 0 ? inc[internoU ? 1 : 0] : du === 1 ? inc[2] : inc[3];
            d += val;
            det.push(`${sub.k13} ${['α', 'β', 'γ'][du]} ${val > 0 ? '+' : ''}${val}`);
          }
        }
      }
    }
    // Correcciones de Grant–Paul por ramificación: grado (n.º de C vecinos) del átomo y de cada vecino
    const gradoC = k => g.atoms[k].nbrs.filter(x => g.atoms[x.atom].el === 'C').length;
    const CORR = { '1,3': -1.1, '1,4': -3.4, '2,3': -2.5, '2,4': -7.2, '3,2': -3.7, '3,3': -9.5, '3,4': -15.0, '4,1': -1.5, '4,2': -8.4, '4,3': -15.0, '4,4': -25.0 };
    const gi = gradoC(i);
    let ram = 0;
    g.atoms[i].nbrs.forEach(n => { if (sp3C(n.atom)) ram += CORR[gi + ',' + gradoC(n.atom)] || 0; });
    if (ram) { d += ram; det.push(`ramificación ${ram.toFixed(1)}`); }
    return { d, det: 'Grant–Paul' + (det.length ? ': ' + det.join(', ') : '') };
  }

  /** Clave de incremento aromático del sustituyente j unido al carbono de anillo r. */
  function claveAromatica(g, r, j) {
    const a = g.atoms[j];
    const tc = Q().tipoCarbonilo;
    if (a.el === 'C') {
      if (a.aromatic) return 'Ph';
      const t = tc(g, j);
      if (t === 'acido') return 'COOH';
      if (t === 'ester' || t === 'anhidrido') return 'COOR';
      if (t === 'aldehido') return 'CHO';
      if (t === 'cetona' || t === 'haluro_acilo') return 'COR';
      if (t === 'amida') return 'CONH2';
      if (g.tripleBondPartner(j, 'N') != null) return 'CN';
      if (g.doubleBondPartner(j, 'C') != null) return 'vinilo';
      if (a.nbrs.filter(n => g.atoms[n.atom].el === 'F').length >= 2) return 'CF3';
      return a.h === 3 ? 'CH3' : 'alquilo';
    }
    if (a.el === 'O') {
      if (a.h > 0) return 'OH';
      const o = a.nbrs.map(n => n.atom).find(k => k !== r);
      return o != null && tc(g, o) ? 'OCOR' : 'OR';
    }
    if (a.el === 'N') {
      if (a.nbrs.filter(n => g.atoms[n.atom].el === 'O').length >= 2) return 'NO2';
      if (a.nbrs.some(n => n.atom !== r && tc(g, n.atom))) return 'NHCOR';
      return a.h >= 1 ? 'NH2' : 'NR2';
    }
    if (a.el === 'S') return 'SR';
    return ['F', 'Cl', 'Br', 'I'].includes(a.el) ? a.el : null;
  }

  /** Para un átomo de un anillo bencénico, lista de [clave, posición relativa 0..3] de los sustituyentes del anillo. */
  function incrementosAnillo(g, i) {
    const anillo = g.rings.find(r => r.length === 6 && r.includes(i) && r.every(k => g.atoms[k].aromatic && g.atoms[k].el === 'C'));
    if (!anillo) return null;
    const set = new Set(anillo);
    const k0 = anillo.indexOf(i);
    const out = [];
    anillo.forEach((ai, k) => {
      for (const n of g.atoms[ai].nbrs) {
        if (set.has(n.atom)) continue;
        const d = Math.min((k - k0 + 6) % 6, (k0 - k + 6) % 6);   // 0 ipso, 1 orto, 2 meta, 3 para
        out.push([claveAromatica(g, ai, n.atom), d, g.atoms[n.atom].aromatic && g.atoms[n.atom].rings.some(rr => g.rings[rr].includes(ai))]);
      }
    });
    if (out.some(o => o[2])) return null;   // anillo fusionado: los incrementos no aplican
    return out;
  }

  // ---------------------------------------------------------------- estimación ¹H
  function estimarH(g, i, disolv) {
    const a = g.atoms[i];
    const tc = Q().tipoCarbonilo;
    const nb = a.nbrs.map(n => n.atom);
    if (a.el === 'O') {
      const c = nb[0];
      if (c != null && tc(g, c) === 'acido') return { d: 11.5, tol: 1.5, tipo: 'COOH', inter: true };
      if (c != null && g.atoms[c].aromatic) return { d: 5.5, tol: 2.5, tipo: 'OH fenólico', inter: true };
      return { d: 2.5, tol: 2.5, tipo: 'OH alcohólico', inter: true };
    }
    if (a.el === 'N') {
      if (nb.some(c => tc(g, c) === 'amida')) return { d: a.h === 2 ? 6.3 : 7.2, tol: 1.5, tipo: 'NH de amida', inter: true };
      if (nb.some(c => g.atoms[c].aromatic) || a.aromatic) return { d: 3.6, tol: 1.2, tipo: 'NH de arilamina', inter: true };
      return { d: 1.5, tol: 1.2, tipo: 'NH de amina', inter: true };
    }
    if (a.el === 'S') return { d: 1.5, tol: 0.8, tipo: 'SH', inter: true };
    if (a.el !== 'C') return { d: 2.0, tol: 2.0, tipo: 'X–H', inter: true };

    if (a.aromatic) {
      const inc = incrementosAnillo(g, i);
      if (inc) {
        let d = 7.27; const det = [];
        for (const [k, pos] of inc) { if (!k || !Z_H[k] || pos === 0) continue; d += Z_H[k][pos - 1]; det.push(`${k} ${['orto', 'meta', 'para'][pos - 1]}`); }
        return { d, tol: 0.25, tipo: 'H aromático (benceno)', det: det.length ? '7,27 + Z(' + det.join(', ') + ')' : 'benceno' };
      }
      const adyN = nb.some(k => g.atoms[k].el === 'N' && g.atoms[k].aromatic);
      return { d: adyN ? 8.5 : 7.4, tol: 0.6, tipo: adyN ? 'H heteroaromático (α a N)' : 'H aromático (sistema fusionado/heteroaromático)' };
    }
    const t = tc(g, i);
    if (t === 'aldehido') return { d: nb.some(k => g.atoms[k].aromatic || g.doubleBondPartner(k, 'C') != null) ? 9.95 : 9.75, tol: 0.35, tipo: 'H aldehídico' };
    if (t === 'amida') return { d: 8.1, tol: 0.4, tipo: 'H de formamida' };
    if (t === 'ester' || t === 'acido') return { d: 8.05, tol: 0.4, tipo: 'H de formiato' };
    if (g.tripleBondPartner(i, 'C') != null) {
      const otro = g.tripleBondPartner(i, 'C');
      const arilo = g.atoms[otro].nbrs.some(n => g.atoms[n.atom].aromatic);
      return { d: arilo ? 3.05 : 2.0, tol: 0.5, tipo: 'H acetilénico' };
    }
    const par = g.doubleBondPartner(i, 'C');
    if (par != null) {
      let d = 5.3, tipo = 'H vinílico';
      if (a.h === 2) { const cj = g.atoms[par].nbrs.some(n => n.atom !== i && (g.atoms[n.atom].aromatic || Q().tipoCarbonilo(g, n.atom))); d = cj ? 5.5 : 4.95; tipo = cj ? '=CH₂ terminal conjugado (H cis/trans no equivalentes)' : '=CH₂ terminal'; }
      if (nb.some(k => k !== par && tc(g, k))) { d = 6.0; tipo = 'H vinílico α a C=O'; }
      if (g.atoms[par].nbrs.some(n => n.atom !== i && tc(g, n.atom))) { d = 6.9; tipo = 'H vinílico β a C=O (conjugado)'; }
      if (nb.some(k => k !== par && g.atoms[k].aromatic)) { d = Math.max(d, 6.6); tipo += ', estirénico'; }
      if (nb.some(k => g.atoms[k].el === 'O')) { d = 6.4; tipo = 'H vinílico de enol éter/éster'; }
      return { d, tol: 0.5, tipo };
    }
    // sp³
    const sust = nb.map(k => sustituyente(g, i, k)).sort((x, y) => y.s - x.s);
    if (a.h === 4) return { d: 0.23, tol: 0.2, tipo: 'CH₄' };
    if (a.h === 3) {
      const s = sust[0] || { me: 0.9, et: 'alquilo' };
      let d = s.me;
      if (s.et === 'alquilo' && nb.length) {
        const vec = g.atoms[nb[0]].nbrs.map(n => n.atom).filter(k => k !== i).map(k => sustituyente(g, nb[0], k).s);
        const mx = vec.length ? Math.max(...vec) : 0;
        if (mx >= 2.2) d += 0.35; else if (mx >= 1.3) d += 0.15;
      }
      return { d, tol: 0.25, tipo: `CH₃–${s.et}` };
    }
    // CH₂ y CH: δ = 1,25 (CH₂) o 1,55 (CH) + Σz de los sustituyentes + corrección β (+0,30/+0,35 por un
    // grupo electroatrayente en el carbono vecino)
    let beta = 0;
    nb.forEach(k => {
      if (g.atoms[k].el !== 'C' || !g.isSp3(k)) return;
      const zs = g.atoms[k].nbrs.map(n => n.atom).filter(x => x !== i).map(x => sustituyente(g, k, x).z);
      const mx = zs.length ? Math.max(...zs) : 0;
      beta += mx >= 2 ? 0.35 : mx >= 1 ? 0.3 : 0;
    });
    beta = Math.min(beta, 0.5);
    const base = a.h === 2 ? 1.25 : 1.55;
    const zt = sust.reduce((x, s) => x + s.z, 0);
    const d = base + zt + beta;
    const etq = sust.map(s => s.et).join(', ');
    return { d, tol: a.h === 2 ? 0.3 : 0.35, tipo: `${a.h === 2 ? 'CH₂' : 'CH'} (${etq})`,
      det: `${base.toFixed(2).replace('.', ',')} + Σz ${zt.toFixed(2).replace('.', ',')}${beta ? ` + β ${beta.toFixed(2).replace('.', ',')}` : ''}` };
  }

  // ---------------------------------------------------------------- estimación ¹³C
  function estimarC(g, i) {
    const a = g.atoms[i];
    const tc = Q().tipoCarbonilo;
    const nb = a.nbrs.map(n => n.atom);
    // conjugado: C vecino aromático o con doble enlace C=C (no el propio O carbonílico)
    const conj = nb.some(k => g.atoms[k].el === 'C' && (g.atoms[k].aromatic || (g.doubleBondPartner(k, 'C') != null && g.doubleBondPartner(k, 'C') !== i)));
    const t = tc(g, i);
    if (t) {
      const T = { acido: conj ? [172, 5] : [180, 5], ester: conj ? [167, 4] : [172, 4], amida: [170, 5], anhidrido: [167, 5],
        haluro_acilo: [170, 5], cetona: conj ? [198, 6] : [209, 7], aldehido: conj ? [192, 5] : [201, 5] };
      const [d, tol] = T[t];
      const NOM = { acido: 'ácido', ester: 'éster', amida: 'amida', anhidrido: 'anhídrido', haluro_acilo: 'haluro de acilo', cetona: 'cetona', aldehido: 'aldehído' };
      return { d, tol, tipo: 'C=O de ' + NOM[t] };
    }
    if (g.tripleBondPartner(i, 'N') != null) return { d: 119, tol: 5, tipo: 'C≡N' };
    if (g.tripleBondPartner(i, 'C') != null) {
      const p = g.tripleBondPartner(i, 'C');
      const arilP = g.atoms[p].nbrs.some(n => g.atoms[n.atom].aromatic);
      return a.h ? { d: arilP ? 77.3 : 68.5, tol: 4, tipo: '≡CH' } : { d: 84, tol: 5, tipo: '≡C–' };
    }
    if (a.aromatic) {
      const inc = incrementosAnillo(g, i);
      if (inc) {
        let d = 128.5; const det = [];
        for (const [k, pos] of inc) { if (!k || !Z_C[k]) continue; d += Z_C[k][pos]; det.push(`${k} ${['ipso', 'orto', 'meta', 'para'][pos]}`); }
        return { d, tol: 3, tipo: a.h ? 'CH aromático' : 'C aromático cuaternario', det: det.length ? '128,5 + Z(' + det.join(', ') + ')' : 'benceno' };
      }
      return { d: nb.some(k => g.atoms[k].el !== 'C') ? 145 : 128, tol: 12, tipo: 'C aromático (fusionado/heteroaromático)' };
    }
    const par = g.doubleBondPartner(i, 'C');
    if (par != null) {
      if (nb.some(k => k !== par && g.atoms[k].el === 'O')) return { d: 150, tol: 10, tipo: '=C–O' };
      if (g.atoms[par].nbrs.some(n => n.atom !== i && tc(g, n.atom))) return { d: 145, tol: 8, tipo: 'C=C β a C=O' };
      if (nb.some(k => k !== par && tc(g, k))) return { d: 128, tol: 8, tipo: 'C=C α a C=O' };
      return { d: a.h === 2 ? 115 : a.h === 1 ? 133 : 140, tol: 10, tipo: a.h === 2 ? '=CH₂' : a.h === 1 ? '=CH–' : '=C<' };
    }
    if (g.doubleBondPartner(i, 'N') != null) return { d: 160, tol: 10, tipo: 'C=N' };
    // sp³: Grant–Paul con incrementos de grupos funcionales
    const tipoH = ['C', 'CH', 'CH₂', 'CH₃'][a.h] || 'CH₃';
    const gp = grantPaul(g, i);
    const sust = nb.map(k => sustituyente(g, i, k)).filter(x => x.et !== 'alquilo');
    return { d: gp.d, tol: 5, tipo: `${tipoH}${sust.length ? '–' + sust.map(x => x.et).join(', ') : ' alquílico'}`, det: gp.det };
  }

  // ---------------------------------------------------------------- multiplicidad
  const NOMBRE_MULT = ['s', 'd', 't', 'q', 'quint', 'sext', 'sept'];
  function multiplicidad(g, clases, i) {
    const a = g.atoms[i];
    if (a.el !== 'C') return 's (ancho, intercambiable)';
    let n = 0;
    for (const nb of a.nbrs) {
      const b = g.atoms[nb.atom];
      if (b.el !== 'C' || clases[nb.atom] === clases[i]) continue;
      if (a.aromatic && !b.aromatic) continue;   // en el anillo solo se cuentan los H orto
      n += b.h;
    }
    const base = n <= 6 ? NOMBRE_MULT[n] : 'm';
    return a.aromatic ? (n === 0 ? 's (o d por acoplamiento meta, J≈2 Hz)' : base + ' (³J orto ≈ 7–8 Hz; acoplamientos meta adicionales)') : base;
  }

  // ---------------------------------------------------------------- entornos
  function entornos(ctx, nucleo, disolv) {
    const { g, clases } = ctx;
    const porClase = new Map();
    g.atoms.forEach((a, i) => {
      if (nucleo === '1H' ? a.h === 0 : a.el !== 'C') return;
      if (!porClase.has(clases[i])) porClase.set(clases[i], []);
      porClase.get(clases[i]).push(i);
    });
    const D2O = disolv && /D₂O/.test(disolv.nombre);
    const lista = [...porClase.values()].map(atomos => {
      const i = atomos[0];
      const e = nucleo === '1H' ? estimarH(g, i, disolv) : estimarC(g, i);
      const nH = nucleo === '1H' ? atomos.reduce((s, k) => s + g.atoms[k].h, 0) : null;
      return Object.assign(e, { atomos, n: atomos.length, nH, mult: nucleo === '1H' ? multiplicidad(g, clases, i) : ['C', 'CH', 'CH₂', 'CH₃'][g.atoms[i].h] || 'CH₃',
        intercambia: nucleo === '1H' && !!e.inter, enD2O: nucleo === '1H' && !!e.inter && D2O });
    });
    lista.sort((a, b) => b.d - a.d);
    lista.forEach((e, k) => { e.etiqueta = String.fromCharCode(97 + (k % 26)) + (k >= 26 ? Math.floor(k / 26) : ''); });
    return lista;
  }

  // ---------------------------------------------------------------- datos observados
  function frecuenciaMHz(s) { const m = String(s || '').match(/([\d.]+)\s*MHz/i); return m ? Number(m[1]) : null; }

  /** Agrupa líneas de ¹H en multipletes (separación < 20 Hz). */
  function multipletes(picos, mhz) {
    const umbral = 20 / (mhz || 400);
    const ord = picos.slice().sort((a, b) => b.ppm - a.ppm);
    const grupos = [];
    for (const p of ord) {
      const g = grupos[grupos.length - 1];
      if (g && g.ultimo - p.ppm < umbral) { g.lineas.push(p); g.ultimo = p.ppm; } else grupos.push({ lineas: [p], ultimo: p.ppm });
    }
    return grupos.map(g => {
      const s = g.lineas.reduce((x, p) => x + p.intensidad, 0) || 1;
      return { d: g.lineas.reduce((x, p) => x + p.ppm * p.intensidad, 0) / s, desde: g.lineas[g.lineas.length - 1].ppm, hasta: g.lineas[0].ppm,
        nLineas: g.lineas.length, intensidad: s, asignados: [] };
    });
  }

  /**
   * Asignación de costo mínimo (voraz sobre todos los pares): costo = |Δδ|/tolerancia, más una
   * penalización si la multiplicidad DEPT observada (S, D, T, Q) no coincide con el tipo de carbono.
   * A diferencia de un emparejamiento por orden, permite que dos señales cercanas se crucen.
   */
  function emparejar(pred, obs) {
    const DEPT = { S: 'C', D: 'CH', T: 'CH₂', Q: 'CH₃' };
    const pares = [];
    pred.forEach((p, i) => obs.forEach((o, j) => {
      let c = Math.abs(p.d - o.d) / p.tol;
      if (o.mult && DEPT[o.mult] && DEPT[o.mult] !== p.mult) c += 1.5;
      if (c <= 2.5) pares.push([c, i, j]);
    }));
    pares.sort((a, b) => a[0] - b[0]);
    const usP = new Set(), usO = new Set(), out = [];
    for (const [, i, j] of pares) {
      if (usP.has(i) || usO.has(j)) continue;
      usP.add(i); usO.add(j); out.push([i, j]);
    }
    return out;
  }

  function interpretar(ctx, esp) {
    const nucleo = esp.nucleo;
    const disolv = disolventeDe(esp.disolvente);
    const amb = entornos(ctx, nucleo, disolv);
    const notas = [];
    const ph = Number(String(esp.ph || '').replace(',', '.'));
    if (disolv && /D₂O/.test(disolv.nombre)) {
      notas.push('Disolvente acuoso (D₂O/H₂O): los H intercambiables (OH, NH, COOH) se intercambian con el deuterio o con el agua y no aparecen como señales propias.');
      if (amb.some(e => /COOH|C=O de acido/.test(e.tipo)) && ph >= 5) notas.push(`A pH ${esp.ph} el ácido carboxílico está como carboxilato (pKa ≈ 4–5): los δ del anillo/cadena adyacente difieren de los del ácido libre en CDCl₃ (≈ 0,1–0,3 ppm menores en ¹H).`);
    }

    if (nucleo === '1H') {
      const mhz = frecuenciaMHz(esp.frecuencia);
      const mults = multipletes(esp.picos, mhz);
      const visibles = amb.filter(e => !e.enD2O);
      // cada entorno se asigna al multiplete más cercano dentro de su tolerancia (se admiten solapamientos)
      visibles.forEach(e => {
        let mejor = null, dmin = Infinity;
        mults.forEach(m => { const dd = Math.abs(m.d - e.d); if (dd < dmin) { dmin = dd; mejor = m; } });
        if (mejor && dmin <= e.tol + 0.25) { e.obs = mejor; mejor.asignados.push(e); }
      });
      // integración relativa: se escala para que la suma de multipletes asignados iguale los H asignados
      const asig = mults.filter(m => m.asignados.length);
      const sumI = asig.reduce((x, m) => x + m.intensidad, 0);
      const sumH = asig.reduce((x, m) => x + m.asignados.reduce((y, e) => y + e.nH, 0), 0);
      const k = sumI ? sumH / sumI : 0;
      mults.forEach(m => {
        m.hInt = m.intensidad * k;
        if (!m.asignados.length && disolv) {
          const r = disolv.h.find(([d]) => Math.abs(d - m.d) < 0.06);
          if (r) m.disolvente = `${r[1]} (${disolv.nombre}, δ ${r[0]})`;
        }
      });
      const total = amb.reduce((x, e) => x + e.nH, 0);
      notas.push(`${amb.length} entornos de ¹H no equivalentes (${total} H en total${amb.some(e => e.enD2O) ? `; ${amb.filter(e => e.enD2O).reduce((x, e) => x + e.nH, 0)} intercambiables no observables` : ''}); ${mults.length} multipletes observados a ${mhz || '?'} MHz.`);
      notas.push('Integración aproximada a partir de la suma de alturas de las líneas de cada multiplete (las listas de picos no traen áreas).');
      return { nucleo, entornos: amb, observados: mults, notas, disolvente: disolv ? disolv.nombre : esp.disolvente };
    }

    // ¹³C
    const obs = [];
    esp.picos.slice().sort((a, b) => b.ppm - a.ppm).forEach(p => {
      const u = obs[obs.length - 1];
      if (u && Math.abs(u.d - p.ppm) < 0.2) { u.intensidad = Math.max(u.intensidad, p.intensidad); return; }
      obs.push({ d: p.ppm, intensidad: p.intensidad, mult: p.multiplicidad || null, asignados: [] });
    });
    let candidatos = obs;
    if (disolv) {
      obs.forEach(o => { const r = disolv.c.find(([d]) => Math.abs(d - o.d) < 0.6); if (r) o.disolvente = `${r[1]} (δ ${r[0]})`; });
      candidatos = obs.filter(o => !o.disolvente);
    }
    emparejar(amb, candidatos).forEach(([i, j]) => { amb[i].obs = candidatos[j]; candidatos[j].asignados.push(amb[i]); });
    // multiplicidad DEPT experimental (NMRShiftDB: S, D, T, Q) frente a la esperada
    const DEPT = { S: 'C', D: 'CH', T: 'CH₂', Q: 'CH₃' };
    amb.forEach(e => { if (e.obs && e.obs.mult) e.coincideDEPT = DEPT[e.obs.mult] === e.mult; });
    const nC = amb.reduce((x, e) => x + e.n, 0);
    notas.push(`${ctx.g.formula.C || 0} átomos de C en ${amb.length} entornos no equivalentes${nC !== amb.length ? ' (la simetría hace equivalentes algunos carbonos)' : ''}; ${candidatos.length} señales observadas${obs.length !== candidatos.length ? ' (sin contar el disolvente)' : ''}.`);
    if (candidatos.length < amb.length) notas.push('Hay menos señales que entornos: posibles solapamientos o carbonos cuaternarios débiles (relajación T₁ larga y sin NOE).');
    return { nucleo, entornos: amb, observados: obs, notas, disolvente: disolv ? disolv.nombre : esp.disolvente };
  }

  // ---------------------------------------------------------------- presentación
  function renderizar(r, svg) {
    const { esc } = Q();
    const fmt = (x, n) => (x == null ? '—' : x.toFixed(n));
    const dec = r.nucleo === '1H' ? 2 : 1;
    const filasE = r.entornos.map(e => `<tr data-atomos="${e.atomos.join(',')}" class="${e.obs ? '' : 'falta'}">
      <td class="izq"><b>${e.etiqueta}</b></td><td class="izq">${e.atomos.join(', ')}</td>
      <td class="izq">${esc(e.tipo)}${e.det ? `<br><span class="muted small">${esc(e.det)}</span>` : ''}</td>
      ${r.nucleo === '1H' ? `<td>${e.nH}</td>` : `<td>${e.n}</td>`}
      <td>${fmt(e.d, dec)} ± ${fmt(e.tol, dec)}</td><td class="izq">${esc(e.mult)}</td>
      <td>${e.enD2O ? '<span class="muted">intercambiado</span>' : e.obs ? fmt(e.obs.d, dec) + (r.nucleo === '13C' && e.coincideDEPT === false ? ' <span class="muted">(DEPT ≠)</span>' : '') : '<span class="muted">sin asignar</span>'}</td></tr>`).join('');
    const filasO = r.observados.map(o => `<tr><td>${fmt(o.d, dec)}</td>
      ${r.nucleo === '1H' ? `<td>${o.nLineas} línea(s)${o.nLineas > 1 ? ` (${fmt(o.desde, 3)}–${fmt(o.hasta, 3)})` : ''}</td><td>${o.asignados.length ? fmt(o.hInt, 1) + ' H' : '—'}</td>` : `<td>${o.mult ? esc(o.mult) : '—'}</td>`}
      <td class="izq">${o.asignados.length ? o.asignados.map(e => `<b>${e.etiqueta}</b> ${esc(e.tipo)}${r.nucleo === '1H' ? ` (${e.nH} H, ${esc(e.mult.split(' ')[0])})` : ''}`).join('<br>') : o.disolvente ? `<span class="muted">${esc(o.disolvente)}</span>` : '<span class="muted">sin asignar</span>'}</td></tr>`).join('');
    return `<h3>Interpretación del espectro de RMN de ${r.nucleo === '1H' ? '¹H' : '¹³C'}</h3>
      <ul class="interp-notas">${r.notas.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
      <div class="rmn-grid"><div class="mol rmn-mol">${svg || ''}</div>
      <div><h4 class="sub-h">Entornos de la estructura (pulse una fila para resaltar los átomos)</h4>
      <div class="tabla-wrap"><table class="tabla-entornos"><thead><tr><th class="izq">Señal</th><th class="izq">Átomos</th><th class="izq">Entorno</th><th>${r.nucleo === '1H' ? 'n H' : 'n C'}</th>
        <th>δ estimado</th><th class="izq">${r.nucleo === '1H' ? 'Multiplicidad' : 'Tipo (DEPT)'}</th><th>δ obs.</th></tr></thead><tbody>${filasE}</tbody></table></div></div></div>
      <h4 class="sub-h">Señales observadas y asignación</h4>
      <div class="tabla-wrap"><table><thead><tr><th>δ (ppm)</th>${r.nucleo === '1H' ? '<th>Multiplete</th><th>Integral rel.</th>' : '<th>Multiplicidad</th>'}<th class="izq">Asignación</th></tr></thead><tbody>${filasO}</tbody></table></div>
      <p class="nota">δ estimados por aditividad (Silverstein et al., 2014; Pretsch et al., 2009): valores orientativos con error típico de ±0,2–0,4 ppm (¹H) y ±3–8 ppm (¹³C). La equivalencia es topológica (no distingue protones diastereotópicos) y las multiplicidades son de primer orden.
        Señales residuales de disolventes: Fulmer et al., <i>Organometallics</i> 2010, 29, 2176.</p>`;
  }

  MSDB.interpRMN = { interpretar, renderizar, entornos, multipletes, estimarH, estimarC, DISOLVENTES };
})(typeof window !== 'undefined' ? window : globalThis);
