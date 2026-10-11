// Construye los recursos del navegador en ./build:
//   build/js/eims-engine.js  ← motor de masas empaquetado (window.EIMS)
//   build/rdkit/             ← RDKit.js (MinimalLib WASM)
//   build/jsme/              ← editor JSME
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';

rmSync('build', { recursive: true, force: true });
mkdirSync('build/js', { recursive: true });

await build({
  entryPoints: ['src-js/eims-entry.js'],
  bundle: true,
  format: 'iife',
  globalName: 'EIMS',
  platform: 'browser',
  target: ['es2019'],
  minify: true,
  legalComments: 'inline',
  banner: { js: '/* Motor EI-MS de PGBeermann/masas (MIT) — ver vendor/eims-engine/VENDOR.md */' },
  outfile: 'build/js/eims-engine.js',
});

const rd = 'node_modules/@rdkit/rdkit/dist';
mkdirSync('build/rdkit', { recursive: true });
for (const f of ['RDKit_minimal.js', 'RDKit_minimal.wasm']) cpSync(`${rd}/${f}`, `build/rdkit/${f}`);

const js = 'node_modules/jsme-editor';
if (existsSync(js)) cpSync(js, 'build/jsme', { recursive: true, filter: s => !/package\.json$|\.md$/.test(s) });

console.log('build/ listo');
