/* MSDatabase — interpretación del espectro EI experimental.
 * 1) El motor mecanístico de PGBeermann/masas (window.EIMS) genera las rutas de fragmentación
 *    de la estructura; cada pico experimental se asocia con el ion de igual m/z nominal.
 * 2) Los picos que el motor no explica se contrastan con tablas de pérdidas neutras desde M⁺•
 *    y de iones característicos (McLafferty & Tureček 1993, tablas A.5 y A.6; Silverstein 2014, cap. 1).
 * 3) Se evalúan el ion molecular, la regla del nitrógeno y los patrones isotópicos (Cl, Br, S, ¹³C).
 */
(function (G) {
  'use strict';
  const MSDB = G.MSDB = G.MSDB || {};
  const Q = () => MSDB.quimica;

  // Pérdidas neutras frecuentes desde M⁺• (Δm nominal → posibles neutros)
  const PERDIDAS = {
    1: 'H• (α-escisión en aldehídos, aminas, éteres; arenos)', 2: 'H₂',
    15: '•CH₃ (metilo en posición α o ramificación)', 16: 'O (N-óxidos, nitroarenos) o •NH₂ (amidas)',
    17: '•OH (ácidos, efecto orto en nitroarenos) o NH₃', 18: 'H₂O (alcoholes, ácidos, aldehídos)',
    19: 'F•', 20: 'HF', 26: 'C₂H₂ (aromáticos) o •CN', 27: 'HCN (anilinas, nitrilos, azinas)',
    28: 'CO (fenoles, quinonas, acilio→arilo) o C₂H₄ (McLafferty, RDA, ésteres de etilo)',
    29: '•CHO (aldehídos, fenoles) o •C₂H₅', 30: 'CH₂O (anisoles, éteres) o NO• (nitroarenos)',
    31: '•OCH₃ (ésteres metílicos) o •CH₂OH (alcoholes 1°)', 32: 'CH₃OH (ésteres metílicos, efecto orto) o S',
    33: '•SH', 34: 'H₂S', 35: 'Cl• (³⁵Cl)', 36: 'HCl', 37: 'Cl• (³⁷Cl)', 38: 'HCl (H³⁷Cl)',
    41: '•C₃H₅ (alilo)', 42: 'C₃H₆ (McLafferty) o CH₂=C=O (cetena: acetatos de arilo, acetanilidas)',
    43: '•C₃H₇ o CH₃CO• (metilcetonas, acetatos)', 44: 'CO₂ (ácidos, ésteres cíclicos) o CH₃CHO',
    45: '•COOH (ácidos) o •OC₂H₅ (ésteres etílicos)', 46: '•NO₂ (nitro) o C₂H₅OH',
    55: '•C₄H₇', 56: 'C₄H₈ (McLafferty en ésteres de butilo, alquilbencenos)', 57: '•C₄H₉ (butilo) o C₂H₅CO•',
    59: '•COOCH₃ o CH₃CONH₂', 60: 'CH₃COOH (acetatos)', 77: 'C₆H₅• (fenilo)', 79: 'Br• (⁷⁹Br)', 81: 'Br• (⁸¹Br)',
    91: 'C₇H₇• (bencilo)', 127: 'I•', 128: 'HI'
  };
  // Iones de baja masa característicos (m/z → identidad habitual)
  const IONES = {
    15: 'CH₃⁺', 18: 'H₂O⁺• (fondo)', 26: 'C₂H₂⁺•', 27: 'C₂H₃⁺ / HCN⁺•', 28: 'CO⁺• / C₂H₄⁺• / N₂⁺• (aire)',
    29: 'CHO⁺ / C₂H₅⁺', 30: 'CH₂=NH₂⁺ (aminas 1°) / NO⁺', 31: 'CH₂=OH⁺ (alcoholes 1°, éteres)',
    32: 'O₂⁺• (aire)', 39: 'C₃H₃⁺ (ciclopropenilo; aromáticos)', 41: 'C₃H₅⁺ (alilo)',
    42: 'C₃H₆⁺• / CH₂=C=O⁺•', 43: 'CH₃CO⁺ (acilio) / C₃H₇⁺', 44: 'CO₂⁺• / CH₂=CH–OH⁺• (McLafferty de aldehídos) / C₂H₆N⁺',
    45: 'COOH⁺ / CH₃CH=OH⁺ / C₂H₅O⁺', 46: 'NO₂⁺', 50: 'C₄H₂⁺• (aromáticos)', 51: 'C₄H₃⁺ (aromáticos: 77 − C₂H₂)',
    55: 'C₄H₇⁺ / C₃H₃O⁺', 57: 'C₄H₉⁺ / C₂H₅CO⁺', 58: 'C₃H₆O⁺• (McLafferty de metilcetonas) / C₃H₈N⁺',
    59: 'C₃H₇O⁺ / CH₃OC=O⁺', 60: 'C₂H₄O₂⁺• (McLafferty de ácidos)', 65: 'C₅H₅⁺ (91 − C₂H₂)', 66: 'C₅H₆⁺• (fenoles − CO)',
    69: 'CF₃⁺ / C₅H₉⁺', 74: 'C₃H₆O₂⁺• (McLafferty de ésteres metílicos)', 76: 'C₆H₄⁺• (aromáticos disustituidos)',
    77: 'C₆H₅⁺ (fenilo)', 78: 'C₆H₆⁺•', 79: 'C₆H₇⁺ / Br⁺', 91: 'C₇H₇⁺ (tropilio)', 92: 'C₇H₈⁺• (McLafferty de alquilbencenos)',
    93: 'C₆H₅O⁺ / C₆H₇N⁺•', 94: 'C₆H₆O⁺•', 105: 'C₆H₅CO⁺ (benzoílo) / C₈H₉⁺', 119: 'C₉H₁₁⁺', 120: 'C₈H₈O⁺• / C₇H₄O₂⁺•',
    121: 'C₇H₅O₂⁺ / C₈H₉O⁺', 149: 'C₈H₅O₃⁺ (ftalatos: contaminante habitual)'
  };

  const iRel = (picos, mz) => { const p = picos.find(x => x.mz === mz); return p ? p.intensidad_relativa : 0; };

  /** Coseno entre dos espectros nominales (intensidades lineales normalizadas). */
  function coseno(exp, pred) {
    const a = new Map(); exp.forEach(p => a.set(Math.round(p.mz), p.intensidad_relativa));
    const b = new Map(); pred.forEach(p => b.set(p.mz, p.intensity));
    let ab = 0, aa = 0, bb = 0;
    for (const [k, v] of a) { aa += v * v; ab += v * (b.get(k) || 0); }
    for (const v of b.values()) bb += v * v;
    return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
  }

  /**
   * Interpreta un espectro experimental. ctx: resultado de MSDB.quimica.prepararMolecula().
   * esp: espectro normalizado de ms_api.php (picos [{mz, intensidad_relativa}]).
   */
  function interpretar(ctx, esp, opciones) {
    const o = Object.assign({ umbral: 5, maxPicos: 16 }, opciones || {});
    const pred = G.EIMS.predict(ctx.R, ctx.smiles, { threshold: 0.05, topExplain: 80 });
    const f = pred.formula;
    const M = pred.nominalMass;
    const picos = esp.picos.map(p => ({ mz: Math.round(p.mz), intensidad_relativa: p.intensidad_relativa }));

    // --- picos a explicar: los más intensos (≥ umbral) + el ion molecular
    let sel = picos.filter(p => p.intensidad_relativa >= o.umbral).sort((a, b) => b.intensidad_relativa - a.intensidad_relativa).slice(0, o.maxPicos);
    if (!sel.find(p => p.mz === M) && iRel(picos, M) > 0) sel.push(picos.find(p => p.mz === M));
    sel.sort((a, b) => b.mz - a.mz);

    const explic = new Map(); pred.explanations.forEach(x => { if (!explic.has(x.mz)) explic.set(x.mz, x); });
    const espPred = new Map(); pred.spectrum.forEach(p => espPred.set(p.mz, p));

    const asignaciones = sel.map(p => {
      const r = { mz: p.mz, intensidad: p.intensidad_relativa, perdida: M - p.mz, tipo: null, texto: null, explicacion: null };
      const x = explic.get(p.mz);
      if (x) {
        r.tipo = 'mecanismo';
        r.explicacion = x;
        r.texto = `${x.formula}${x.ionType.startsWith('OE') ? '⁺•' : '⁺'} — ${x.pathway[x.pathway.length - 1].ruleName}`;
        return r;
      }
      const pp = espPred.get(p.mz);
      if (pp && pp.assignments[0] && pp.assignments[0].isotope) {
        const a = pp.assignments[0];
        r.tipo = 'isotopo';
        r.texto = `Pico isotópico M+${a.offset} del ion ${a.formula} (¹³C, ³⁷Cl, ⁸¹Br, ³⁴S…)`;
        return r;
      }
      const cand = [];
      if (p.mz === M) cand.push('Ion molecular M⁺•');
      if (r.perdida > 0 && PERDIDAS[r.perdida]) cand.push(`M − ${r.perdida}: pérdida de ${PERDIDAS[r.perdida]}`);
      if (IONES[p.mz]) cand.push(`Ion característico: ${IONES[p.mz]}`);
      r.tipo = cand.length ? 'tabla' : 'sin_explicar';
      r.texto = cand.length ? cand.join(' · ') : 'No explicado por las reglas del motor ni por las tablas de pérdidas/iones: posible reordenamiento no contemplado, impureza o fragmento de segunda generación.';
      return r;
    });

    // --- ion molecular, regla del N, isótopos
    const fo = ctx.g.formula;   // {C: 7, H: 6, O: 2, ...}
    const nN = fo.N || 0, nC = fo.C || 0, nCl = fo.Cl || 0, nBr = fo.Br || 0, nS = fo.S || 0;
    const iM = iRel(picos, M), iM1 = iRel(picos, M + 1), iM2 = iRel(picos, M + 2);
    const notas = [];
    notas.push(iM > 0
      ? `Ion molecular M⁺• observado en m/z ${M} (${iM.toFixed(1)} %).${iM < 5 ? ' Es débil, típico de alcoholes, aminas, éteres y alcanos ramificados.' : iM >= 50 ? ' Es intenso, como en sistemas aromáticos o conjugados que estabilizan el radical-catión.' : ''}`
      : `No se observa M⁺• en m/z ${M}: el ion molecular es inestable para esta clase de compuesto (o el espectro se registró desde m/z mayor).`);
    notas.push(`Regla del nitrógeno: ${nN} átomo(s) de N → M nominal ${nN % 2 ? 'impar' : 'par'} (${M}) ${(M % 2) === (nN % 2) ? '✓' : '✗'}.`);
    notas.push(`Índice de deficiencia de hidrógeno (IDH = anillos + enlaces π) para ${f}: ${pred.rdb}.`);
    if (iM >= 5 && iM1 > 0) {
      const nCest = (iM1 / iM) / 1.1 * 100;
      notas.push(`Relación (M+1)/M = ${(iM1 / iM * 100).toFixed(1)} % → n(C) ≈ ${nCest.toFixed(1)} (1,1 % de ¹³C por átomo de C; fórmula: C${nC}). La estimación es aproximada porque M+1 incluye contribuciones de ¹⁵N, ²H y de iones [M+H]⁺.`);
    }
    if (nCl || nBr) {
      const esperado = nCl === 1 && !nBr ? 32 : nBr === 1 && !nCl ? 97 : nCl === 2 && !nBr ? 64 : nBr === 2 && !nCl ? 195 : null;
      notas.push(`Halógenos: ${nCl ? nCl + ' Cl ' : ''}${nBr ? nBr + ' Br' : ''}. ${esperado ? `M+2/M esperado ≈ ${esperado} %` : 'Patrón M, M+2, M+4 característico'}${iM >= 5 ? `; observado ${(iM2 / iM * 100).toFixed(0)} %.` : '.'}`);
    } else if (nS) {
      notas.push(`Azufre: ${nS} S → M+2 ≈ ${(4.4 * nS).toFixed(1)} % de M por ³⁴S${iM >= 5 ? `; observado ${(iM2 / iM * 100).toFixed(1)} %` : ''}.`);
    }
    const basePeak = picos.reduce((a, b) => (b.intensidad_relativa > a.intensidad_relativa ? b : a), picos[0]);
    const bpAsig = asignaciones.find(a => a.mz === basePeak.mz);

    return {
      formula: f, M, rdb: pred.rdb, smiles: pred.smiles, picoBase: basePeak.mz, picoBaseTexto: bpAsig ? bpAsig.texto : null,
      coseno: coseno(esp.picos, pred.spectrum), picoBasePredicho: pred.basePeak ? pred.basePeak.mz : null,
      notas, asignaciones,
      resumen: {
        mecanismo: asignaciones.filter(a => a.tipo === 'mecanismo').length,
        isotopo: asignaciones.filter(a => a.tipo === 'isotopo').length,
        tabla: asignaciones.filter(a => a.tipo === 'tabla').length,
        sin: asignaciones.filter(a => a.tipo === 'sin_explicar').length
      },
      referencias: pred.references, motor: pred.meta
    };
  }

  // ---------------------------------------------------------------- presentación
  function tarjeta(x, a, abierto) {
    const { esc, sub } = Q();
    const oe = x.ionType.startsWith('OE');
    const pasos = x.pathway.map((s, k) => `
      <div class="step">
        <h4>${k + 1}. ${esc(s.ruleName)}</h4>
        <div class="eq">
          ${s.mechSvg ? `<figure class="mol mech">${s.mechSvg}<figcaption>${esc(s.precursorLabel || '')}</figcaption></figure>${s.rule === 'M' ? '' : '<span class="op">→</span>'}`
            : k === 0 && s.rule !== 'M' ? '<span class="mono">M⁺•</span><span class="op">→</span>' : k > 0 ? `<span class="mono">m/z ${x.pathway[k - 1].ionMz}</span><span class="op">→</span>` : ''}
          ${s.rule === 'M' && s.mechSvg ? '' : s.ionSvg ? `<figure class="mol">${s.ionSvg}<figcaption>${sub(s.ionFormula)}${s.oddElectron ? '⁺•' : '⁺'} · m/z ${s.ionMz}</figcaption></figure>` : `<span class="mono"><b>${sub(s.ionFormula)}${s.oddElectron ? '⁺•' : '⁺'}</b> (m/z ${s.ionMz})</span>`}
          ${s.neutralFormula ? `<span class="op">+</span>${s.neutralSvg ? `<figure class="mol small">${s.neutralSvg}<figcaption>${sub(s.neutralFormula)}</figcaption></figure>` : `<span class="mono">${sub(s.neutralFormula)}</span>`}<span class="muted small">(${esc(s.neutralLabel || 'neutro')})</span>` : ''}
        </div>
        <ol>${s.mechanism.map(t => `<li>${esc(t)}</li>`).join('')}</ol>
      </div>`).join('');
    return `<details class="ion" data-mz="${x.mz}" ${abierto ? 'open' : ''}>
      <summary><span class="mz">m/z ${x.mz}</span><span class="bar" title="${a.intensidad}% (experimental)"><i style="width:${Math.min(100, a.intensidad)}%"></i></span>
        <span class="title">${sub(x.formula)}${oe ? '⁺•' : '⁺'} — ${esc(x.pathway[x.pathway.length - 1].ruleName)}</span>
        <span class="badge ${oe ? 'oe' : 'ee'}">${esc(x.ionType)}</span>
        <span class="muted small">exp. ${a.intensidad.toFixed(1)} % · m/z exacto ${x.mzExact}${x.lossFromM ? ` · M−${x.lossFromM}` : ''}</span></summary>
      <div class="ion-body">
        <div><div class="mol">${x.parentHighlightSvg || ''}</div><p class="small muted">RDB = ${x.rdb} (${Number.isInteger(x.rdb) ? 'entero → ion impar-electrónico' : 'semientero → ion par-electrónico'})</p></div>
        <div>${pasos}${x.alternatives.length ? `<div class="alt">Rutas competitivas para la misma composición: ${x.alternatives.map(t => `${esc(t.ruleName)} (${Math.round(t.share * 100)} %)`).join('; ')}</div>` : ''}</div>
      </div></details>`;
  }

  function renderizar(r) {
    const { esc, sub } = Q();
    const fila = a => `<tr class="t-${a.tipo}"><td>${a.mz}</td><td>${a.intensidad.toFixed(1)}</td><td>${a.perdida > 0 ? 'M−' + a.perdida : a.perdida === 0 ? 'M⁺•' : ''}</td>
      <td class="izq">${a.tipo === 'mecanismo' ? `<a href="#ion-${a.mz}" data-ion="${a.mz}">${esc(a.texto)}</a>` : esc(a.texto)}</td></tr>`;
    const tarjetas = r.asignaciones.filter(a => a.tipo === 'mecanismo')
      .sort((a, b) => b.intensidad - a.intensidad)
      .map((a, i) => tarjeta(a.explicacion, a, i < 2)).join('');
    return `
      <h3>Interpretación del espectro de masas</h3>
      <ul class="interp-notas">${r.notas.map(n => `<li>${esc(n)}</li>`).join('')}
        <li>Pico base experimental: m/z ${r.picoBase}${r.picoBaseTexto ? ' → ' + esc(r.picoBaseTexto) : ''}. Pico base predicho por el motor: m/z ${r.picoBasePredicho ?? '—'}.</li>
        <li>Similitud coseno experimental vs. predicho: ${r.coseno.toFixed(3)}. Picos explicados: ${r.resumen.mecanismo} con mecanismo, ${r.resumen.isotopo} isotópicos, ${r.resumen.tabla} por tablas, ${r.resumen.sin} sin explicar.</li></ul>
      <div class="tabla-wrap"><table><thead><tr><th>m/z</th><th>Int. exp. (%)</th><th>Relación con M</th><th class="izq">Asignación</th></tr></thead>
        <tbody>${r.asignaciones.map(fila).join('')}</tbody></table></div>
      <h4 class="sub-h">Mecanismos de fragmentación de los picos observados</h4>
      <p class="nota">Rutas generadas por el motor mecanístico de <i>Predictor EI‑MS</i> (formalismo de sitio de carga/radical; flechas de 1 e⁻ en naranja y de 2 e⁻ en azul) para la estructura ${sub(r.formula)}; se muestran solo los iones que coinciden con picos experimentales.</p>
      <div class="expl">${tarjetas || '<p class="nota">Ningún pico experimental coincide con los iones generados por el motor.</p>'}</div>
      <p class="nota">Bibliografía de las reglas: ${r.referencias.map(x => esc(x.text)).join(' · ')}</p>`;
  }

  MSDB.interpMS = { interpretar, renderizar, PERDIDAS, IONES, coseno };
})(typeof window !== 'undefined' ? window : globalThis);
