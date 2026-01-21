"use strict";

// Runner simples para testes sem framework.
// Executa cada teste e encerra com status !=0 se algum falhar.

const path = require("path");

const tests = [
  "./step5.test.js",
  "./env.test.js",
  "./state.test.js",
  "./sheets.test.js"
];

let failed = 0;
for (const t of tests) {
  const full = path.join(__dirname, t);
  try {
    require(full);
  } catch (e) {
    failed += 1;
    console.error(`\n[FAIL] ${t}:`, e?.stack || e);
  }
}

if (failed) {
  console.error(`\n${failed} teste(s) falharam.`);
  process.exit(1);
}

console.log(`\nOK: ${tests.length} arquivo(s) de teste passaram.`);
