// Pruebas de los módulos de interpretación (EM, IR, RMN) con RDKit.js en Node.
// Datos experimentales aproximados de referencia (SDBS/NIST/literatura) para compuestos docentes clásicos.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const initRDKit = require('@rdkit/rdkit');
const R = await initRDKit();

const ctxVM = { console, JSON, Math, Map, Set, Promise, __RDKit: R };
vm.createContext(ctxVM);
vm.runInContext(readFileSync('build/js/eims-engine.js', 'utf8') + ';globalThis.EIMS = EIMS;', ctxVM);
for (const f of ['js/quimica.js', 'js/interp-ms.js', 'js/interp-ir.js', 'js/interp-rmn.js', 'js/interp-conjunto.js']) vm.runInContext(readFileSync(f, 'utf8'), ctxVM, { filename: f });
const M = ctxVM.MSDB;

let fallos = 0, total = 0;
const ok = (cond, msg) => { total++; if (!cond) { fallos++; console.log('  ✗ ' + msg); } else console.log('  ✓ ' + msg); };
const banda = (nu, rel, ancho = 20) => ({ numero_onda: nu, intensidad_relativa: rel, clase: rel >= 66 ? 'f' : rel >= 33 ? 'm' : 'd', ancho, forma: ancho >= 150 ? 'muy ancha' : ancho >= 60 ? 'ancha' : ancho <= 25 ? 'aguda' : 'media' });
const asignadoA = (r, nu, texto) => { const b = r.bandas.find(x => x.numero_onda === nu); return b && b.asignaciones.some(a => (a.grupo + a.modo).includes(texto)); };
const env = (r, tipo) => r.entornos.find(e => e.tipo.includes(tipo));

// ------------------------------------------------------------------ ácido benzoico
console.log('Ácido benzoico');
let ctx = await M.quimica.prepararMolecula({ smiles: 'OC(=O)c1ccccc1' });
ok(new Set(ctx.clases).size === 7, 'simetría: 7 clases de átomos pesados (O–H, O=, C=O, ipso, orto, meta, para)');
let ms = M.interpMS.interpretar(ctx, { picos: [[122, 80], [105, 100], [77, 72], [51, 25], [50, 14], [123, 6]].map(([mz, i]) => ({ mz, intensidad_relativa: i })) });
const a105 = ms.asignaciones.find(a => a.mz === 105);
ok(a105 && a105.tipo === 'mecanismo' && /C7H5O/.test(a105.texto), 'EM: m/z 105 explicado con mecanismo (C₇H₅O⁺, benzoílo)');
ok(ms.asignaciones.find(a => a.mz === 77).tipo === 'mecanismo', 'EM: m/z 77 explicado con mecanismo (C₆H₅⁺)');
ok(ms.notas.some(n => /n\(C\) ≈ 6\.8/.test(n)), 'EM: estimación de n(C) a partir de M+1');
ok(ms.notas.some(n => /Regla del nitrógeno.*✓/.test(n)), 'EM: regla del nitrógeno');
let ir = M.interpIR.interpretar(ctx, { rango_cm1: [4000, 450], bandas: [banda(2950, 50, 420), banda(1688, 100), banda(1602, 30), banda(1454, 40), banda(1424, 45), banda(1292, 75), banda(935, 35, 70), banda(708, 80)] });
ok(ir.grupos.find(g => g.id === 'acido').confirmacion === 'confirmado', 'IR: ácido carboxílico confirmado');
ok(!ir.grupos.find(g => g.id === 'alcohol'), 'IR: el O–H del ácido no se informa como alcohol');
ok(asignadoA(ir, 1688, 'ν(C=O)'), 'IR: 1688 → ν(C=O)');
ok(asignadoA(ir, 2950, 'O–H'), 'IR: 2950 (muy ancha) → ν(O–H) del dímero');
ok(ir.sustitucion[0] && ir.sustitucion[0].clave === '1', 'IR: anillo monosustituido');
ok(!ir.bandas.find(b => b.numero_onda === 1688).asignaciones.some(x => /Sobretonos/.test(x.modo)), 'IR: la ν(C=O) intensa no se asigna a sobretonos aromáticos');
let h = M.interpRMN.interpretar(ctx, { nucleo: '1H', frecuencia: '600 MHz', disolvente: 'Water', ph: '7.00',
  picos: [[7.88, 100], [7.86, 91], [7.54, 46], [7.49, 65]].map(([ppm, intensidad]) => ({ ppm, intensidad })) });
ok(h.observados.length === 3, '¹H: 4 líneas → 3 multipletes (20 Hz a 600 MHz)');
ok(env(h, 'COOH').enD2O, '¹H: COOH intercambiado en agua');
ok(h.notas.some(n => /carboxilato/.test(n)), '¹H: advertencia de carboxilato a pH 7');
const orto = h.entornos.find(e => e.nH === 2 && e.d > 7.9);
ok(orto && orto.obs && Math.abs(orto.obs.d - 7.87) < 0.02, '¹H: H orto (2H) asignados a 7,87');
let c = M.interpRMN.interpretar(ctx, { nucleo: '13C', disolvente: 'Chloroform-D1 (CDCl3)',
  picos: [[172.4, 'S'], [133.8, 'D'], [130.2, 'D'], [129.3, 'S'], [128.5, 'D'], [77.16, null]].map(([ppm, m]) => ({ ppm, intensidad: 1, multiplicidad: m })) });
const ipso = c.entornos.find(e => e.tipo === 'C aromático cuaternario');
ok(ipso.obs && Math.abs(ipso.obs.d - 129.3) < 0.01, '¹³C: C ipso → 129,3 (desempate por DEPT)');
ok(c.entornos.find(e => /C=O/.test(e.tipo)).obs.d === 172.4, '¹³C: C=O → 172,4');
ok(c.observados.find(o => o.d === 77.16).disolvente, '¹³C: 77,16 reconocido como CDCl₃');
M.quimica.liberar(ctx);

// ------------------------------------------------------------------ acetofenona
console.log('Acetofenona');
ctx = await M.quimica.prepararMolecula({ smiles: 'CC(=O)c1ccccc1' });
ir = M.interpIR.interpretar(ctx, { rango_cm1: [4000, 450], bandas: [banda(3062, 12), banda(1686, 100), banda(1598, 40), banda(1449, 45), banda(1360, 55), banda(1266, 85), banda(760, 70), banda(690, 75)] });
ok(ir.grupos.find(g => g.id === 'cetona').confirmacion !== 'no confirmado', 'IR: cetona con ν(C=O) 1686');
ok(ir.ausencias.some(a => /O–H ni N–H/.test(a)), 'IR: ausencia de O–H/N–H señalada');
h = M.interpRMN.interpretar(ctx, { nucleo: '1H', frecuencia: '400 MHz', disolvente: 'CDCl3',
  picos: [[7.97, 50], [7.95, 52], [7.57, 30], [7.55, 31], [7.47, 45], [7.45, 46], [2.61, 100], [7.26, 8]].map(([ppm, intensidad]) => ({ ppm, intensidad })) });
const ch3 = h.entornos.find(e => e.nH === 3);
ok(ch3.obs && Math.abs(ch3.obs.d - 2.61) < 0.01 && ch3.mult === 's', '¹H: CH₃–C(=O)Ar → 2,61 (s)');
ok(h.observados.some(o => o.disolvente && /CHCl₃/.test(o.disolvente)), '¹H: 7,26 reconocido como CHCl₃ residual');
const mCH3 = h.observados.find(o => Math.abs(o.d - 2.61) < 0.01);
ok(Math.abs(mCH3.hInt - 3) < 0.6, `¹H: integral de CH₃ ≈ 3 H (${mCH3.hInt.toFixed(2)})`);
c = M.interpRMN.interpretar(ctx, { nucleo: '13C', disolvente: 'CDCl3', picos: [198.1, 137.1, 133.0, 128.5, 128.2, 26.5].map(ppm => ({ ppm, intensidad: 1 })) });
ok(c.entornos.every(e => e.obs), '¹³C: los 6 entornos asignados');
M.quimica.liberar(ctx);

// ------------------------------------------------------------------ acetato de etilo
console.log('Acetato de etilo');
ctx = await M.quimica.prepararMolecula({ smiles: 'CCOC(C)=O' });
h = M.interpRMN.interpretar(ctx, { nucleo: '1H', frecuencia: '90 MHz', disolvente: 'CDCl3',
  picos: [4.16, 4.14, 4.10, 4.08, 2.04, 1.29, 1.26, 1.24].map(ppm => ({ ppm, intensidad: ppm === 2.04 ? 100 : 30 })) });
ok(env(h, 'CH₂').mult === 'q' && env(h, 'CH₂').obs, '¹H: OCH₂ cuarteto asignado');
ok(h.entornos.filter(e => e.nH === 3).map(e => e.mult).sort().join() === 's,t', '¹H: CH₃ acetilo (s) y CH₃ etilo (t)');
ir = M.interpIR.interpretar(ctx, { rango_cm1: [4000, 450], bandas: [banda(2984, 40), banda(1742, 100), banda(1374, 50), banda(1241, 95), banda(1047, 70)] });
ok(ir.grupos.find(g => g.id === 'ester').confirmacion === 'confirmado', 'IR: éster confirmado (1742 y 1241)');
M.quimica.liberar(ctx);

// ------------------------------------------------------------------ etanol y 1-bromobutano
console.log('Etanol / 1-bromobutano');
ctx = await M.quimica.prepararMolecula({ smiles: 'CCO' });
ir = M.interpIR.interpretar(ctx, { rango_cm1: [4000, 450], bandas: [banda(3340, 90, 250), banda(2975, 60), banda(1380, 30), banda(1088, 70), banda(1050, 85), banda(880, 40)] });
ok(ir.grupos.find(g => g.id === 'alcohol').confirmacion === 'confirmado', 'IR: alcohol confirmado (3340 ancha, 1050)');
M.quimica.liberar(ctx);
ctx = await M.quimica.prepararMolecula({ smiles: 'CCCCBr' });
ms = M.interpMS.interpretar(ctx, { picos: [[57, 100], [41, 55], [29, 40], [136, 8], [138, 8], [27, 35]].map(([mz, i]) => ({ mz, intensidad_relativa: i })) });
ok(ms.asignaciones.find(a => a.mz === 57).tipo === 'mecanismo', 'EM: m/z 57 (C₄H₉⁺, −Br•) con mecanismo');
ok(ms.notas.some(n => /M\+2\/M esperado ≈ 97/.test(n)), 'EM: patrón isotópico de Br (M+2 ≈ 97 %)');
c = M.interpRMN.interpretar(ctx, { nucleo: '13C', disolvente: 'CDCl3', picos: [34.8, 33.4, 21.4, 13.2].map(ppm => ({ ppm, intensidad: 1 })) });
ok(c.entornos.filter(e => e.obs).length === 4, '¹³C: 4 carbonos asignados');
M.quimica.liberar(ctx);

// ------------------------------------------------------------------ IR: más familias (bandas de referencia, SDBS/NIST aprox.)
console.log('IR por familias');
const casosIR = [
  ['benzaldehído', 'O=Cc1ccccc1', [[3063, 15], [2820, 25], [2738, 22], [1703, 100], [1597, 45], [1456, 35], [1203, 50], [827, 30], [746, 60], [688, 70]], 'aldehido', [[2738, 'Fermi'], [1703, 'ν(C=O)']]],
  ['benzonitrilo', 'N#Cc1ccccc1', [[3065, 12], [2229, 70], [1599, 30], [1491, 45], [1447, 45], [758, 80], [688, 75]], 'nitrilo', [[2229, 'C≡N']]],
  ['fenilacetileno', 'C#Cc1ccccc1', [[3291, 80, 15], [3058, 15], [2110, 18], [1489, 45], [1443, 40], [756, 85], [691, 80], [650, 60]], 'alquino_t', [[3291, '≡C–H'], [2110, 'C≡C']]],
  ['anilina', 'Nc1ccccc1', [[3433, 55, 40], [3356, 60, 40], [1619, 80], [1601, 70], [1500, 85], [1277, 60], [753, 70], [692, 80]], 'amina1', [[1277, 'C–N'], [3433, 'N–H'], [3356, 'N–H']]],
  ['nitrobenceno', 'O=[N+]([O-])c1ccccc1', [[3080, 10], [1523, 100], [1347, 95], [852, 50], [702, 60]], 'nitro', [[1523, 'NO₂'], [1347, 'NO₂']]],
  ['acetanilida', 'CC(=O)Nc1ccccc1', [[3294, 55, 50], [3060, 20], [1664, 100], [1599, 70], [1557, 65], [1324, 50], [754, 60], [694, 55]], 'amida', [[1664, 'amida I']]],
  ['fenol', 'Oc1ccccc1', [[3350, 80, 250], [3040, 20], [1597, 60], [1499, 70], [1230, 85], [810, 40], [752, 75], [690, 70]], 'fenol', [[1230, 'C–O']]],
  ['anisol', 'COc1ccccc1', [[3003, 20], [2955, 25], [2835, 25], [1600, 60], [1497, 80], [1247, 100], [1040, 60], [754, 70], [691, 60]], 'eter_arilo', [[1247, 'C(ar)–O–C']]],
  ['estireno', 'C=Cc1ccccc1', [[3082, 20], [3027, 25], [1630, 40], [1601, 35], [1495, 45], [990, 50], [908, 70], [776, 70], [698, 80]], 'alqueno', [[1630, 'C=C'], [908, 'vinilo'], [990, 'vinilo']]],
];
for (const [n, smi, bs, grupo, asig] of casosIR) {
  ctx = await M.quimica.prepararMolecula({ smiles: smi });
  ir = M.interpIR.interpretar(ctx, { rango_cm1: [4000, 450], bandas: bs.map(([nu, rel, an]) => banda(nu, rel, an || 20)) });
  const gq = ir.grupos.find(x => x.id === grupo);
  ok(gq && gq.confirmacion === 'confirmado', `IR ${n}: ${gq ? gq.nombre : grupo} → ${gq ? gq.confirmacion : 'no detectado'}`);
  for (const [nu, txt] of asig) ok(asignadoA(ir, nu, txt), `IR ${n}: ${nu} cm⁻¹ → ${txt}`);
  M.quimica.liberar(ctx);
}

// ------------------------------------------------------------------ RMN: exactitud de los δ estimados
// Referencia: δ experimentales en CDCl3 (SDBS; Pretsch 2009; Silverstein 2014). Se compara cada señal con el
// entorno estimado más cercano y se exige un error absoluto medio acotado.
console.log('Exactitud de δ estimados');
const REF_RMN = [
 ['etanol','CCO',[[3.69,2],[1.22,3]],[58.3,18.4]],
 ['dietil éter','CCOCC',[[3.48,4],[1.21,6]],[65.9,15.4]],
 ['1-propanol','CCCO',[[3.58,2],[1.57,2],[0.94,3]],[64.2,25.9,10.2]],
 ['2-propanol','CC(C)O',[[4.02,1],[1.20,6]],[64.0,25.3]],
 ['2-butanona','CCC(C)=O',[[2.44,2],[2.14,3],[1.06,3]],[209.3,36.9,29.4,7.9]],
 ['propanal','CCC=O',[[9.79,1],[2.46,2],[1.13,3]],[203.0,37.3,6.0]],
 ['acetato de etilo','CCOC(C)=O',[[4.12,2],[2.05,3],[1.26,3]],[171.1,60.5,21.0,14.2]],
 ['ácido butanoico','CCCC(=O)O',[[2.35,2],[1.68,2],[0.98,3]],[180.6,36.2,18.5,13.7]],
 ['trietilamina','CCN(CC)CC',[[2.53,6],[1.03,9]],[46.5,11.8]],
 ['1-clorobutano','CCCCCl',[[3.53,2],[1.76,2],[1.45,2],[0.94,3]],[44.7,34.8,20.2,13.4]],
 ['acetonitrilo','CC#N',[[1.98,3]],[116.9,1.8]],
 ['tolueno','Cc1ccccc1',[[7.24,2],[7.17,2],[7.16,1],[2.36,3]],[137.9,129.1,128.3,125.4,21.5]],
 ['anisol','COc1ccccc1',[[7.29,2],[6.94,1],[6.90,2],[3.80,3]],[159.9,129.5,120.7,114.0,54.8]],
 ['anilina','Nc1ccccc1',[[7.16,2],[6.77,1],[6.70,2]],[146.4,129.3,118.6,115.1]],
 ['nitrobenceno','O=[N+]([O-])c1ccccc1',[[8.23,2],[7.71,1],[7.56,2]],[148.3,134.7,129.4,123.5]],
 ['benzaldehído','O=Cc1ccccc1',[[10.02,1],[7.88,2],[7.63,1],[7.53,2]],[192.3,136.4,134.4,129.7,129.0]],
 ['benzoato de metilo','COC(=O)c1ccccc1',[[8.04,2],[7.55,1],[7.43,2],[3.91,3]],[167.1,132.9,130.2,129.6,128.4,52.1]],
 ['estireno','C=Cc1ccccc1',[[6.72,1],[5.75,1],[5.24,1]],[137.6,136.9,113.8]],
 ['fenilacetileno','C#Cc1ccccc1',[[3.07,1]],[83.7,77.2]],
 ['clorobenceno','Clc1ccccc1',[[7.33,2],[7.28,2],[7.22,1]],[134.3,129.7,128.6,126.4]],
 ['neopentano','CC(C)(C)C',[[0.94,12]],[31.5,27.9]],
 ['isobutano','CC(C)C',[[0.89,9],[1.74,1]],[25.0,24.3]],
 ['terc-butanol','CC(C)(C)O',[[1.28,9]],[69.1,31.3]],
 ['n-hexano','CCCCCC',[[1.29,8],[0.89,6]],[31.9,22.9,14.1]],
 ['ciclohexanona','O=C1CCCCC1',[[2.33,4],[1.86,4],[1.72,2]],[212.0,42.0,27.1,25.1]],
];
const errH = [], errC = [];
for (const [, smi, H, C] of REF_RMN) {
  ctx = await M.quimica.prepararMolecula({ smiles: smi });
  for (const [nuc, lista, arr] of [['1H', H.map(x => x[0]), errH], ['13C', C, errC]]) {
    const ents = M.interpRMN.entornos(ctx, nuc, null).filter(e => !e.inter);
    for (const d of lista) arr.push(Math.min(...ents.map(e => Math.abs(e.d - d))));
  }
  M.quimica.liberar(ctx);
}
const mae = a => a.reduce((x, y) => x + y, 0) / a.length;
ok(mae(errH) < 0.12, `¹H: error absoluto medio ${mae(errH).toFixed(2)} ppm (n = ${errH.length}, máx ${Math.max(...errH).toFixed(2)})`);
ok(mae(errC) < 1.5, `¹³C: error absoluto medio ${mae(errC).toFixed(2)} ppm (n = ${errC.length}, máx ${Math.max(...errC).toFixed(1)})`);

// ------------------------------------------------------------------ análisis conjunto
console.log('Análisis conjunto (ácido benzoico)');
ctx = await M.quimica.prepararMolecula({ smiles: 'OC(=O)c1ccccc1' });
const datosAB = {
  espectros: [{ picos: [[122, 80], [105, 100], [77, 72], [51, 25]].map(([mz, i]) => ({ mz, intensidad_relativa: i })) }],
  ir: [{ rango_cm1: [4000, 450], bandas: [banda(2950, 50, 420), banda(1688, 100), banda(1292, 75), banda(935, 35, 70), banda(708, 80)] }],
  rmn: { '1H': [{ nucleo: '1H', frecuencia: '400 MHz', disolvente: 'CDCl3', picos: [[12.9, 10], [8.13, 60], [8.11, 62], [7.63, 30], [7.49, 50], [7.47, 52]].map(([ppm, intensidad]) => ({ ppm, intensidad })) }],
         '13C': [{ nucleo: '13C', disolvente: 'CDCl3', picos: [172.6, 133.9, 130.3, 129.4, 128.5].map(ppm => ({ ppm, intensidad: 1 })) }] } };
const cj = M.interpConjunto.analizar(ctx, datosAB);
ok(cj.idh.total === 5 && /1 anillo.*3 π aromáticos.*1 C=O/.test(cj.idh.texto), `IDH 5 = ${cj.idh.texto}`);
const fAc = cj.grupos.find(x => /Ácido/.test(x.nombre));
ok(fAc && fAc.ir.length && fAc.c13.some(t => t.startsWith('172.6')) && fAc.h1.some(t => t.startsWith('12.9')), `ácido: IR ${fAc.ir.join('; ')} | ¹³C ${fAc.c13.join('; ')} | ¹H ${fAc.h1.join('; ')}`);
ok(cj.conclusiones.some(c => /M⁺• en m\/z 122/.test(c)), 'conclusión: M⁺• confirma la masa molecular');
ok(cj.conclusiones.some(c => /5 señales para 5 carbonos/.test(c)), 'conclusión: 5 señales de ¹³C para 5 entornos');
M.quimica.liberar(ctx);

console.log(`\n${total - fallos}/${total} comprobaciones correctas`);
process.exit(fallos ? 1 : 0);
