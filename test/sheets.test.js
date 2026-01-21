"use strict";

const assert = require("assert");

(function main() {
  const sheets = require("../sheets");
  const row = sheets._test.buildEventoRow({
    evento: "TESTE",
    chatId: "1203@g.us",
    produtoId: 10,
    usuario: "Matheus",
    detalhes: { ok: true }
  });

  assert.equal(Array.isArray(row), true);
  assert.equal(row.length, 7);
  assert.equal(row[2], "TESTE");
  assert.equal(row[3], "1203@g.us");
  assert.equal(row[4], "10");
  assert.equal(row[5], "Matheus");
  assert(row[6].includes("ok"));

  assert.equal(sheets._test.normalizeDetalhes("abc"), "abc");
  assert.equal(sheets._test.normalizeDetalhes(null), "");

  console.log("OK: sheets.test");
})();
