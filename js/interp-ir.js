/* MSDatabase — interpretación del espectro IR.
 * Los grupos funcionales presentes se reconocen en la estructura (SMARTS con RDKit.js) y, para cada uno,
 * se buscan sus bandas diagnósticas en el espectro experimental. Las bandas observadas no asignadas
 * a un grupo reciben una asignación por región. Intervalos de número de onda (cm⁻¹) tomados de:
 *  - Silverstein, R. M.; Webster, F. X.; Kiemle, D. J.; Bryce, D. L. Spectrometric Identification of
 *    Organic Compounds, 8.ª ed.; Wiley, 2014, cap. 2.
 *  - Pavia, D. L.; Lampman, G. M.; Kriz, G. S.; Vyvyan, J. R. Introduction to Spectroscopy, 5.ª ed.;
 *    Cengage, 2015, cap. 2.
 *  - Socrates, G. Infrared and Raman Characteristic Group Frequencies, 3.ª ed.; Wiley, 2001.
 * Intensidad: f = fuerte, m = media, d = débil, v = variable.
 */
(function (G) {
  'use strict';
  const MSDB = G.MSDB = G.MSDB || {};
  const Q = () => MSDB.quimica;

  // Cada banda: [modo vibracional, min, max, intensidad, forma, nota, diagnóstica, n.º de bandas esperadas (1 por defecto)]
  const GRUPOS = [
    { id: 'acido', nombre: 'Ácido carboxílico', smarts: '[CX3](=O)[OX2H1]', bandas: [
      ['ν(O–H) del dímero con puente de H', 2500, 3300, 'f', 'muy ancha', 'Banda muy ancha que se superpone a las ν(C–H); diagnóstica de COOH.', true],
      ['ν(C=O)', 1680, 1725, 'f', '', 'Dímero: 1700–1725 (alifático), 1680–1700 (conjugado/arílico).', true],
      ['ν(C–O) acoplada con δ(O–H)', 1210, 1320, 'f', '', '', false],
      ['γ(O–H) fuera del plano', 875, 960, 'm', 'ancha', '', false]] },
    { id: 'anhidrido', nombre: 'Anhídrido de ácido', smarts: '[CX3](=O)[OX2][CX3](=O)', bandas: [
      ['νas(C=O)', 1800, 1850, 'f', '', 'Dos bandas C=O separadas ≈ 60 cm⁻¹.', true],
      ['νs(C=O)', 1740, 1790, 'f', '', '', true],
      ['ν(C–O–C)', 1000, 1300, 'f', '', '', false]] },
    { id: 'haluro_acilo', nombre: 'Haluro de acilo', smarts: '[CX3](=O)[Cl,Br]', bandas: [
      ['ν(C=O)', 1770, 1815, 'f', '', 'Frecuencia alta por el efecto inductivo del halógeno.', true]] },
    { id: 'ester', nombre: 'Éster', smarts: '[#6][CX3](=O)[OX2H0][#6;!$([CX3]=O)]', bandas: [
      ['ν(C=O)', 1715, 1750, 'f', '', '1735–1750 alifático; 1715–1730 conjugado o benzoato.', true],
      ['νas(C–C(=O)–O)', 1160, 1300, 'f', '', '«Regla de los tres picos»: C=O y dos C–O intensas.', true],
      ['ν(O–C–C)', 1000, 1150, 'f', '', '', false]] },
    { id: 'amida', nombre: 'Amida', smarts: '[NX3][CX3]=[OX1]', bandas: [
      ['ν(C=O) (amida I)', 1630, 1690, 'f', '', 'Más baja que en cetonas por la resonancia N–C=O.', true],
      ['ν(N–H)', 3100, 3500, 'm', '', 'Primarias: dos bandas (≈3350 y 3180); secundarias: una (≈3300); terciarias: ninguna.', false],
      ['δ(N–H) (amida II)', 1510, 1650, 'm', '', 'Primarias 1620–1650; secundarias 1510–1570.', false]] },
    { id: 'aldehido', nombre: 'Aldehído', smarts: '[CX3H1](=O)[#6]', bandas: [
      ['ν(C=O)', 1685, 1740, 'f', '', '1720–1740 alifático; 1685–1710 aromático o conjugado.', true],
      ['ν(C–H) aldehídico (doblete de Fermi)', 2695, 2850, 'm', '', 'Dos bandas ≈2720 y ≈2820 cm⁻¹ (resonancia de Fermi con 2δ(C–H)).', true, 2]] },
    { id: 'cetona', nombre: 'Cetona', smarts: '[#6][CX3](=O)[#6]', bandas: [
      ['ν(C=O)', 1680, 1725, 'f', '', '1705–1725 alifática; 1680–1700 arílica o α,β-insaturada; ciclopentanona ≈1750.', true],
      ['ν(C–C(=O)–C)', 1100, 1300, 'm', '', '', false]] },
    { id: 'nitrilo', nombre: 'Nitrilo', smarts: '[NX1]#[CX2]', bandas: [
      ['ν(C≡N)', 2210, 2260, 'm', 'aguda', '2240–2260 alifático; 2210–2230 conjugado.', true]] },
    { id: 'alquino_t', nombre: 'Alquino terminal', smarts: '[CX2H1]#[CX2]', bandas: [
      ['ν(≡C–H)', 3260, 3330, 'f', 'aguda', 'Banda aguda e intensa; distinta de O–H y N–H, que son más anchas.', true],
      ['ν(C≡C)', 2100, 2140, 'd', '', '', true],
      ['δ(≡C–H)', 610, 700, 'f', '', '', false]] },
    { id: 'alquino_i', nombre: 'Alquino interno', smarts: '[CX2H0]#[CX2H0]', bandas: [
      ['ν(C≡C)', 2190, 2260, 'd', '', 'Débil o ausente si el alquino es simétrico (sin cambio de momento dipolar).', true]] },
    { id: 'fenol', nombre: 'Fenol', smarts: '[OX2H]c', bandas: [
      ['ν(O–H) con puente de H', 3200, 3550, 'f', 'ancha', '', true],
      ['ν(C–O)', 1180, 1260, 'f', '', 'Más alta que en alcoholes por el carácter parcial de doble enlace C(ar)–O.', true],
      ['δ(O–H) en el plano', 1310, 1410, 'm', '', '', false]] },
    { id: 'alcohol', nombre: 'Alcohol', smarts: '[OX2H][CX4]', bandas: [
      ['ν(O–H) con puente de H', 3200, 3550, 'f', 'ancha', 'En disolución diluida aparece además ν(O–H) libre, aguda, a 3580–3650.', true],
      ['ν(C–O)', 1000, 1260, 'f', '', '1° ≈1050; 2° ≈1100; 3° ≈1150 cm⁻¹.', true],
      ['δ(O–H) en el plano', 1330, 1420, 'm', '', '', false]] },
    { id: 'amina1', nombre: 'Amina primaria', smarts: '[NX3;H2;!$(N[CX3]=[O,S,N]);!$(N=*)][#6]', bandas: [
      ['νas y νs(N–H)', 3300, 3500, 'm', '', 'Dos bandas (asimétrica y simétrica) separadas ≈ 70–100 cm⁻¹.', true, 2],
      ['δ(NH₂) tijereteo', 1580, 1650, 'm', '', '', true],
      ['ν(C–N)', 1020, 1340, 'm', '', '1020–1250 alifáticas; 1250–1335 aromáticas.', false],
      ['γ(N–H) aleteo', 665, 910, 'm', 'ancha', '', false]] },
    { id: 'amina2', nombre: 'Amina secundaria', smarts: '[NX3;H1;!$(N[CX3]=[O,S,N]);!$(N=*)]([#6])[#6]', bandas: [
      ['ν(N–H)', 3310, 3350, 'd', '', 'Una sola banda, débil.', true],
      ['ν(C–N)', 1020, 1340, 'm', '', '', false]] },
    { id: 'amina3', nombre: 'Amina terciaria', smarts: '[NX3;H0;!$(N[CX3]=[O,S,N]);!$(N=*);!$([N+]);!a]([#6])([#6])[#6]', bandas: [
      ['ν(C–N)', 1020, 1250, 'm', '', 'Sin bandas N–H.', false]] },
    { id: 'nitro', nombre: 'Nitro', smarts: '[$([NX3](=O)=O),$([NX3+](=O)[O-])]', bandas: [
      ['νas(NO₂)', 1500, 1570, 'f', '', '', true],
      ['νs(NO₂)', 1300, 1370, 'f', '', '', true]] },
    { id: 'eter_arilo', nombre: 'Éter arílico', smarts: '[OX2H0](c)[#6;!$([CX3]=O)]', bandas: [
      ['νas(C(ar)–O–C)', 1200, 1275, 'f', '', '', true],
      ['νs(C–O–C)', 1020, 1075, 'm', '', '', false]] },
    { id: 'eter', nombre: 'Éter alifático', smarts: '[OX2H0]([CX4])[CX4]', bandas: [
      ['νas(C–O–C)', 1070, 1150, 'f', '', 'Banda intensa; los éteres no muestran O–H ni C=O.', true]] },
    { id: 'tiol', nombre: 'Tiol', smarts: '[SX2H]', bandas: [
      ['ν(S–H)', 2550, 2600, 'd', 'aguda', 'Débil pero muy característica (región libre de otras bandas).', true]] },
    { id: 'alqueno', nombre: 'Alqueno (C=C no aromático)', smarts: '[CX3]=[CX3]', bandas: [
      ['ν(=C–H)', 3010, 3100, 'm', '', 'Por encima de 3000 cm⁻¹, a diferencia de las C–H sp³.', false],
      ['ν(C=C)', 1620, 1680, 'v', '', 'Débil si el alqueno es casi simétrico; ≈1600–1640 si está conjugado.', true],
      ['γ(=C–H) fuera del plano', 650, 1000, 'f', '', 'Vinilo 910 y 990; trans ≈965; 1,1-disustituido ≈890; cis ≈690.', false]] },
    { id: 'vinilo', nombre: 'Grupo vinilo (–CH=CH₂)', smarts: '[CX3H1]=[CX3H2]', bandas: [
      ['γ(=C–H) trans del vinilo', 985, 995, 'f', '', '', true],
      ['γ(=CH₂) aleteo del vinilo', 905, 915, 'f', '', 'Par 990/910 cm⁻¹ diagnóstico de monosustitución del alqueno.', true]] },
    { id: 'alqueno11', nombre: 'Alqueno 1,1-disustituido (>C=CH₂)', smarts: '[CX3H0]([#6])([#6])=[CX3H2]', bandas: [
      ['γ(=CH₂) aleteo', 885, 895, 'f', '', '', true]] },
    { id: 'aromatico', nombre: 'Anillo aromático', smarts: 'a1aaaaa1', bandas: [
      ['ν(C–H) aromático', 3000, 3100, 'd', '', '', true],
      ['ν(C=C) del anillo', 1585, 1610, 'm', '', 'Junto con 1450–1500 forman el par característico de los arenos.', true],
      ['ν(C=C) del anillo', 1450, 1510, 'm', '', '', true],
      ['Sobretonos y combinaciones', 1660, 2000, 'd', '', 'Su patrón depende de la sustitución del anillo.', false],
      ['γ(C–H) fuera del plano', 675, 900, 'f', '', 'Depende del patrón de sustitución (ver abajo).', true]] },
    { id: 'alquilo', nombre: 'C–H alifáticos (sp³)', smarts: '[CX4;!H0]', bandas: [
      ['ν(C–H) sp³', 2850, 2970, 'f', '', 'Siempre por debajo de 3000 cm⁻¹.', true],
      ['δ(CH₂) tijereteo / δas(CH₃)', 1440, 1470, 'm', '', '', false],
      ['δs(CH₃) «paraguas»', 1370, 1385, 'm', '', 'Desdoblada (≈1385 y 1370) en grupos isopropilo y terc-butilo.', false]] },
    { id: 'cf', nombre: 'Enlace C–F', smarts: '[#6]F', bandas: [['ν(C–F)', 1000, 1400, 'f', '', '', true]] },
    { id: 'ccl', nombre: 'Enlace C–Cl', smarts: '[#6]Cl', bandas: [['ν(C–Cl)', 550, 850, 'f', '', 'Los C–Cl aromáticos absorben además a 1030–1100.', true]] },
    { id: 'cbr', nombre: 'Enlace C–Br', smarts: '[#6]Br', bandas: [['ν(C–Br)', 515, 690, 'f', '', '', true]] },
    { id: 'ci', nombre: 'Enlace C–I', smarts: '[#6]I', bandas: [['ν(C–I)', 485, 600, 'f', '', '', true]] }
  ];
  // Grupos que, de estar presentes, hacen redundante a otro (p. ej., el O–H del ácido no es un alcohol)
  const EXCLUYE = { acido: ['alcohol'], anhidrido: ['ester'], fenol: [], eter_arilo: ['eter'] };

  // Patrón de sustitución del benceno: γ(C–H) fuera del plano (Silverstein 2014, tabla 2.6; Pavia 2015, fig. 2.39)
  const SUSTITUCION = {
    '1': { nombre: 'monosustituido', bandas: [[730, 770, 'f'], [690, 710, 'f']] },
    '1,2': { nombre: 'orto-disustituido (1,2)', bandas: [[735, 770, 'f']] },
    '1,3': { nombre: 'meta-disustituido (1,3)', bandas: [[750, 810, 'f'], [680, 725, 'm'], [860, 900, 'm']] },
    '1,4': { nombre: 'para-disustituido (1,4)', bandas: [[800, 860, 'f']] },
    '1,2,3': { nombre: '1,2,3-trisustituido', bandas: [[760, 780, 'f'], [705, 745, 'm']] },
    '1,2,4': { nombre: '1,2,4-trisustituido', bandas: [[800, 825, 'f'], [870, 885, 'm']] },
    '1,3,5': { nombre: '1,3,5-trisustituido', bandas: [[810, 865, 'f'], [675, 730, 'm']] }
  };

  // Asignación genérica por regiones (para bandas no asignadas a un grupo de la estructura)
  const REGIONES = [
    [3550, 3200, 'ν(O–H) o ν(N–H) con puente de H'], [3330, 3260, 'ν(≡C–H) o ν(N–H)'],
    [3100, 3000, 'ν(=C–H) aromático o vinílico'], [3000, 2840, 'ν(C–H) sp³'], [2830, 2695, 'ν(C–H) aldehídico'],
    [2600, 2550, 'ν(S–H)'], [2400, 2280, 'CO₂ atmosférico (artefacto de compensación)'], [2260, 2100, 'ν(C≡N) o ν(C≡C)'],
    [2000, 1660, 'sobretonos aromáticos'], [1850, 1650, 'ν(C=O)'], [1680, 1600, 'ν(C=C), ν(C=N) o δ(N–H)'],
    [1600, 1450, 'ν(C=C) aromático'], [1470, 1350, 'δ(C–H) alifático'], [1350, 1000, 'ν(C–O), ν(C–N) o ν(C–F) (región de huella dactilar)'],
    [1000, 650, 'γ(C–H) fuera del plano (=C–H, Ar–H) o ν(C–Cl) (huella dactilar)'], [650, 400, 'ν(C–Br), ν(C–I), deformaciones del esqueleto']
  ];

  /** Posiciones relativas de los sustituyentes en cada anillo bencénico (carbociclo aromático de 6). */
  function patronesBenceno(g) {
    const out = [];
    for (const anillo of g.rings) {
      if (anillo.length !== 6 || !anillo.every(i => g.atoms[i].aromatic && g.atoms[i].el === 'C')) continue;
      const set = new Set(anillo);
      const pos = [];
      anillo.forEach((ai, k) => { if (g.atoms[ai].nbrs.some(n => !set.has(n.atom))) pos.push(k); });
      if (!pos.length || pos.length > 3) { out.push({ anillo, clave: null, n: pos.length }); continue; }
      // Numeración que minimiza los localizadores (rotaciones y sentido)
      let mejor = null;
      for (const ini of pos) for (const dir of [1, -1]) {
        const loc = pos.map(p => ((p - ini) * dir + 12) % 6 + 1).sort((a, b) => a - b).join(',');
        if (!mejor || loc < mejor) mejor = loc;
      }
      // Anillos fusionados: los átomos de fusión cuentan como sustituidos
      out.push({ anillo, clave: mejor, n: pos.length, fusionado: anillo.some(ai => g.atoms[ai].rings.length > 1) });
    }
    return out;
  }

  function interpretar(ctx, espIR) {
    const bandas = (espIR.bandas || []).map(b => Object.assign({}, b, { asignaciones: [] }));
    const xmax = espIR.rango_cm1 ? espIR.rango_cm1[0] : 4000, xmin = espIR.rango_cm1 ? espIR.rango_cm1[1] : 400;
    const TOL = 12;
    const buscar = (min, max) => bandas.filter(b => b.numero_onda >= min - TOL && b.numero_onda <= max + TOL)
      .sort((a, b) => b.intensidad_relativa - a.intensidad_relativa);

    // --- grupos presentes en la estructura
    let presentes = [];
    if (ctx) {
      for (const gr of GRUPOS) {
        const m = Q().coincidencias(ctx.R, ctx.mol, gr.smarts);
        if (m.length) presentes.push({ gr, n: m.length, atomos: [...new Set(m.flat())] });
      }
      const ids = new Set(presentes.map(p => p.gr.id));
      presentes = presentes.filter(p => !Object.entries(EXCLUYE).some(([k, v]) => ids.has(k) && v.includes(p.gr.id)));
    }

    const grupos = presentes.map(({ gr, n, atomos }) => {
      const filas = gr.bandas.map(([modo, min, max, int, forma, nota, diag, nb]) => {
        if (max < xmin || min > xmax) return { modo, min, max, int, forma, nota, diag, estado: 'fuera' };
        let c = buscar(min, max);
        // Una vibración débil (sobretonos, ν(C≡C)…) no se asigna a una banda intensa ya explicada por otro grupo
        if (int === 'd') c = c.filter(b => b.intensidad_relativa < 50 && !b.asignaciones.length);
        const tomadas = c.slice(0, nb || 1);
        tomadas.forEach(b => b.asignaciones.push({ grupo: gr.nombre, modo }));
        const b = tomadas[0];
        return { modo, min, max, int, forma, nota, diag, estado: b ? 'observada' : 'ausente', banda: b || null, bandasObs: tomadas };
      });
      const diag = filas.filter(f => f.diag && f.estado !== 'fuera');
      const ok = diag.filter(f => f.estado === 'observada').length;
      return { id: gr.id, nombre: gr.nombre, n, atomos, filas,
        confirmacion: diag.length ? (ok === diag.length ? 'confirmado' : ok ? 'parcial' : 'no confirmado') : 'sin bandas en el intervalo' };
    });

    // --- patrón de sustitución de los anillos bencénicos
    const sustitucion = ctx ? patronesBenceno(ctx.g).filter(p => p.clave && !p.fusionado).map(p => {
      const s = SUSTITUCION[p.clave];
      if (!s) return { clave: p.clave, nombre: `${p.n} sustituyentes (${p.clave})`, filas: [] };
      return { clave: p.clave, nombre: s.nombre, filas: s.bandas.map(([min, max, int]) => {
        const b = buscar(min, max)[0];
        if (b) b.asignaciones.push({ grupo: 'Benceno ' + s.nombre, modo: 'γ(C–H) fuera del plano' });
        return { min, max, int, estado: b ? 'observada' : 'ausente', banda: b || null };
      }) };
    }) : [];

    // --- bandas sin grupo: asignación por región
    bandas.forEach(b => {
      if (!b.asignaciones.length) {
        const reg = REGIONES.filter(([hi, lo]) => b.numero_onda <= hi + 5 && b.numero_onda >= lo - 5).map(r => r[2]);
        b.region = reg.length ? reg.join(' / ') : 'sin asignación';
      }
    });

    // --- bandas ausentes notables (descartan grupos)
    const ausencias = [];
    const hay = (min, max, minRel) => bandas.some(b => b.numero_onda >= min && b.numero_onda <= max && b.intensidad_relativa >= minRel);
    if (xmin < 1650 && !hay(1650, 1850, 25)) ausencias.push('Sin banda intensa en 1650–1850 cm⁻¹: se descartan C=O (cetonas, aldehídos, ácidos, ésteres, amidas, anhídridos).');
    if (xmax > 3200 && !hay(3200, 3650, 15) && !hay(2500, 3300, 30)) ausencias.push('Sin absorción en 3200–3650 cm⁻¹: no hay O–H ni N–H.');
    if (xmax > 2100 && !hay(2100, 2260, 10)) ausencias.push('Sin bandas en 2100–2260 cm⁻¹: no hay C≡N ni C≡C con dipolo apreciable.');

    return { grupos, sustitucion, bandas, ausencias, rango: [xmax, xmin], conEstructura: !!ctx };
  }

  // ---------------------------------------------------------------- presentación
  function renderizar(r) {
    const { esc } = Q();
    const INT = { f: 'fuerte', m: 'media', d: 'débil', v: 'variable' };
    const est = { observada: '✓ observada', ausente: '✗ no observada', fuera: 'fuera del intervalo medido' };
    const tablaBandas = `<div class="tabla-wrap"><table><thead><tr><th>ν̃ (cm⁻¹)</th><th>Int. rel.</th><th class="izq">Forma</th><th class="izq">Asignación</th></tr></thead><tbody>${
      r.bandas.map(b => `<tr><td>${b.numero_onda.toFixed(0)}</td><td>${b.intensidad_relativa.toFixed(0)} (${INT[b.clase] || b.clase})</td>
        <td class="izq">${esc(b.forma || '')}${b.ancho ? ` (${b.ancho} cm⁻¹)` : ''}</td>
        <td class="izq">${b.asignaciones.length ? b.asignaciones.map(a => `<b>${esc(a.modo)}</b> — ${esc(a.grupo)}`).join('<br>') : `<span class="muted">${esc(b.region)}</span>`}</td></tr>`).join('')
    }</tbody></table></div>`;

    const tablaGrupos = r.grupos.map(gq => `
      <details class="grupo" ${gq.confirmacion !== 'confirmado' ? '' : 'open'}><summary><b>${esc(gq.nombre)}</b>${gq.n > 1 ? ` (×${gq.n})` : ''}
        <span class="badge ${gq.confirmacion === 'confirmado' ? 'ok' : gq.confirmacion === 'parcial' ? 'warn' : 'bad'}">${esc(gq.confirmacion)}</span></summary>
        <div class="tabla-wrap"><table><thead><tr><th class="izq">Vibración</th><th>Intervalo (cm⁻¹)</th><th class="izq">Esperada</th><th class="izq">Experimental</th></tr></thead><tbody>${
          gq.filas.map(f => `<tr class="${f.estado === 'ausente' && f.diag ? 'falta' : ''}"><td class="izq">${esc(f.modo)}${f.diag ? ' <span class="muted small">(diagnóstica)</span>' : ''}${f.nota ? `<br><span class="muted small">${esc(f.nota)}</span>` : ''}</td>
            <td>${f.min}–${f.max}</td><td class="izq">${INT[f.int]}${f.forma ? ', ' + esc(f.forma) : ''}</td>
            <td class="izq">${f.banda ? `${est.observada}: ${f.bandasObs.map(b => `${b.numero_onda.toFixed(0)} cm⁻¹ (${b.forma || ''})`).join(' y ')}` : est[f.estado]}</td></tr>`).join('')
        }</tbody></table></div></details>`).join('');

    const sust = r.sustitucion.map(s => `<li>Anillo bencénico ${esc(s.nombre)}: ${s.filas.map(f => `${f.min}–${f.max} cm⁻¹ → ${f.banda ? f.banda.numero_onda.toFixed(0) + ' ✓' : '✗'}`).join('; ') || 'sin bandas tabuladas'}</li>`).join('');

    return `<h3>Interpretación del espectro IR</h3>
      ${r.conEstructura ? '' : '<p class="nota">Sin estructura: solo asignación por regiones.</p>'}
      ${r.ausencias.length || sust ? `<ul class="interp-notas">${r.ausencias.map(a => `<li>${esc(a)}</li>`).join('')}${sust}</ul>` : ''}
      <h4 class="sub-h">Bandas observadas y su asignación</h4>${tablaBandas}
      ${r.grupos.length ? `<h4 class="sub-h">Grupos funcionales de la estructura y sus bandas diagnósticas</h4>${tablaGrupos}` : ''}
      <p class="nota">Bandas detectadas automáticamente (≈ ±5 cm⁻¹; la forma se estima por la anchura a media altura). Intervalos de correlación:
        Silverstein et al., <i>Spectrometric Identification of Organic Compounds</i>, 8.ª ed., Wiley, 2014; Pavia et al., <i>Introduction to Spectroscopy</i>, 5.ª ed., Cengage, 2015;
        Socrates, <i>Infrared and Raman Characteristic Group Frequencies</i>, 3.ª ed., Wiley, 2001. La región < 1500 cm⁻¹ (huella dactilar) contiene acoplamientos que hacen las asignaciones menos unívocas.</p>`;
  }

  MSDB.interpIR = { interpretar, renderizar, GRUPOS, SUSTITUCION, patronesBenceno };
})(typeof window !== 'undefined' ? window : globalThis);
