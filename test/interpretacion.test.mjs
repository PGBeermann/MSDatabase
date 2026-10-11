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
for (const f of ['js/quimica.js', 'js/interp-ms.js', 'js/interp-ir.js', 'js/interp-rmn.js']) vm.runInContext(readFileSync(f, 'utf8'), ctxVM, { filename: f });
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

console.log(`\n${total - fallos}/${total} comprobaciones correctas`);
process.exit(fallos ? 1 : 0);
