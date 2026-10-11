/* MSDatabase — análisis conjunto EM + IR + RMN.
 * Correlaciona, para cada grupo funcional de la estructura, la evidencia de las cuatro técnicas
 * (estrategia de Silverstein et al. 2014, cap. 8; Pavia et al. 2015, cap. 10):
 *   fórmula e IDH → EM (M⁺•, regla del N, pérdidas) → IR (grupos) → RMN ¹³C y ¹H (entornos, integración).
 * Usa el primer espectro disponible de cada técnica.
 */
(function (G) {
  'use strict';
  const MSDB = G.MSDB = G.MSDB || {};
  const Q = () => MSDB.quimica;

  /** Descomposición del IDH en anillos y enlaces π a partir de la estructura. */
  function descomponerIDH(g) {
    const anillos = g.rings.length;
    let pi = 0, piAr = 0, piCO = 0, piCC = 0, piTriple = 0, piOtros = 0;
    for (const b of g.bonds) {
      if (b.aromatic) { piAr += 0.5; continue; }
      const els = [g.atoms[b.a].el, g.atoms[b.b].el].sort().join('');
      if (b.order === 2) { if (els === 'CO') piCO++; else if (els === 'CC') piCC++; else piOtros++; }
      if (b.order === 3) piTriple += 2;
    }
    piAr = Math.floor(piAr);
    pi = piAr + piCO + piCC + piTriple + piOtros;
    const partes = [];
    if (anillos) partes.push(`${anillos} anillo(s)`);
    if (piAr) partes.push(`${piAr} π aromáticos`);
    if (piCO) partes.push(`${piCO} C=O`);
    if (piCC) partes.push(`${piCC} C=C`);
    if (piTriple) partes.push(`${piTriple / 2} enlace(s) triple(s) (2 π c/u)`);
    if (piOtros) partes.push(`${piOtros} otro(s) enlace(s) doble(s) (C=N, N=O, S=O…)`);
    return { total: anillos + pi, texto: partes.join(' + ') || 'ninguno (compuesto saturado y acíclico)' };
  }

  function analizar(ctx, datos) {
    const r = { idh: descomponerIDH(ctx.g), formula: ctx.formula, rdb: ctx.rdb, ms: null, ir: null, h: null, c: null, grupos: [], conclusiones: [] };
    const esp = datos.espectros && datos.espectros[0];
    const ir = datos.ir && datos.ir[0];
    const h1 = datos.rmn && datos.rmn['1H'] && datos.rmn['1H'][0];
    const c13 = datos.rmn && datos.rmn['13C'] && datos.rmn['13C'][0];
    try { if (esp) r.ms = MSDB.interpMS.interpretar(ctx, esp); } catch (_) { /* sin EM */ }
    try { if (ir) r.ir = MSDB.interpIR.interpretar(ctx, ir); } catch (_) { /* sin IR */ }
    try { if (h1) r.h = MSDB.interpRMN.interpretar(ctx, h1); } catch (_) { /* sin ¹H */ }
    try { if (c13) r.c = MSDB.interpRMN.interpretar(ctx, c13); } catch (_) { /* sin ¹³C */ }

    // grupos funcionales (lista del módulo IR, aunque no haya espectro IR)
    const grupos = r.ir ? r.ir.grupos : MSDB.interpIR.interpretar(ctx, { bandas: [], rango_cm1: [0, 0] }).grupos;
    const tocan = (e, atomos) => e.atomos.some(a => atomos.includes(a)) ||
      e.atomos.some(a => ctx.g.atoms[a].nbrs.some(n => atomos.includes(n.atom)) && atomos.length <= 4);
    r.grupos = grupos.filter(gq => !['alquilo'].includes(gq.id)).map(gq => {
      const fila = { nombre: gq.nombre, ir: [], c13: [], h1: [] };
      if (r.ir) gq.filas.filter(f => f.banda && f.diag).forEach(f => fila.ir.push(`${f.modo} ${f.bandasObs.map(b => b.numero_onda.toFixed(0)).join('/')}`));
      if (r.ir && !fila.ir.length && gq.filas.some(f => f.diag && f.estado === 'ausente')) fila.ir.push('bandas diagnósticas no observadas');
      if (r.c) r.c.entornos.filter(e => e.obs && e.atomos.some(a => gq.atomos.includes(a)))
        .slice(0, 4).forEach(e => fila.c13.push(`${e.obs.d.toFixed(1)} (${e.tipo})`));
      if (r.h) r.h.entornos.filter(e => tocan(e, gq.atomos)).slice(0, 4)
        .forEach(e => fila.h1.push(e.enD2O ? `${e.tipo}: intercambiado (D₂O)` : e.obs ? `${e.obs.d.toFixed(2)} (${e.nH} H, ${e.mult.split(' ')[0]})` : `${e.tipo}: sin asignar`));
      fila.estado = gq.confirmacion;
      return fila;
    });

    // conclusiones
    const C = r.conclusiones;
    C.push(`Fórmula ${r.formula}: IDH = ${r.rdb} = ${r.idh.texto}.`);
    if (r.ms) {
      const mObs = r.ms.asignaciones.some(a => a.mz === r.ms.M);
      C.push(mObs ? `EM: el M⁺• en m/z ${r.ms.M} confirma la masa molecular nominal de ${r.formula}.` : `EM: no se observa M⁺• (m/z ${r.ms.M}); la masa molecular debe inferirse de los fragmentos.`);
      const perd = r.ms.asignaciones.filter(a => a.tipo === 'mecanismo' && a.perdida > 0 && a.perdida < 80).sort((a, b) => b.intensidad - a.intensidad).slice(0, 3);
      if (perd.length) C.push('EM: fragmentaciones principales: ' + perd.map(a => `m/z ${a.mz} (M−${a.perdida}, ${a.explicacion.pathway[a.explicacion.pathway.length - 1].ruleName})`).join('; ') + '.');
    }
    if (r.ir) {
      const conf = r.ir.grupos.filter(x => x.confirmacion === 'confirmado').map(x => x.nombre.toLowerCase());
      if (conf.length) C.push('IR: confirma ' + conf.join(', ') + '.');
      r.ir.ausencias.forEach(a => C.push('IR: ' + a));
    }
    if (r.c) {
      const nE = r.c.entornos.length, nO = r.c.observados.filter(o => !o.disolvente).length;
      C.push(`¹³C: ${nO} señales para ${nE} carbonos no equivalentes${nO === nE ? ' (coincide con la simetría de la estructura)' : nO < nE ? ' (hay solapamientos o C cuaternarios no detectados)' : ' (sobran señales: impurezas o confórmeros)'}.`);
    }
    if (r.h) {
      const asig = r.h.entornos.filter(e => e.obs).length, vis = r.h.entornos.filter(e => !e.enD2O).length;
      C.push(`¹H: ${asig} de ${vis} entornos observables asignados a ${r.h.observados.filter(o => o.asignados.length).length} multipletes.`);
    }
    return r;
  }

  function renderizar(r) {
    const { esc, sub } = Q();
    const celda = arr => arr.length ? arr.map(esc).join('<br>') : '<span class="muted">—</span>';
    const filas = r.grupos.map(f => `<tr><td class="izq"><b>${esc(f.nombre)}</b><br><span class="badge ${f.estado === 'confirmado' ? 'ok' : f.estado === 'parcial' ? 'warn' : 'bad'}">${esc(f.estado || '')}</span></td>
      <td class="izq">${celda(f.ir)}</td><td class="izq">${celda(f.c13)}</td><td class="izq">${celda(f.h1)}</td></tr>`).join('');
    return `<ul class="interp-notas">${r.conclusiones.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
      ${r.grupos.length ? `<div class="tabla-wrap"><table><thead><tr><th class="izq">Grupo funcional</th><th class="izq">IR (cm⁻¹)</th><th class="izq">¹³C (δ ppm)</th><th class="izq">¹H (δ ppm)</th></tr></thead><tbody>${filas}</tbody></table></div>` : ''}
      <p class="nota">Correlación automática para ${sub(r.formula)} con el primer espectro de cada técnica; los detalles y las demás alternativas están en cada pestaña.</p>`;
  }

  MSDB.interpConjunto = { analizar, renderizar, descomponerIDH };
})(typeof window !== 'undefined' ? window : globalThis);
