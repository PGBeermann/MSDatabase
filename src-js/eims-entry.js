'use strict';
// Punto de entrada del paquete para el navegador: expone el motor de masas como window.EIMS.
const { predict } = require('../vendor/eims-engine/ms/engine');
const { MolGraph } = require('../vendor/eims-engine/chem/molgraph');
const elements = require('../vendor/eims-engine/chem/elements');
const REFS = require('../vendor/eims-engine/ms/references');

module.exports = { predict, MolGraph, elements, REFS, version: 'masas 577c848 (v1.3.1)' };
