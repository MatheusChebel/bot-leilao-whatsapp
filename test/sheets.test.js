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
  assert.equal(row.length, 8);

  // [0]=eventId, [1]=data, [2]=hora
  assert.equal(typeof row[0], "string");
  assert(row[0].startsWith("EVT_"));

  assert.equal(row[3], "TESTE");
  assert.equal(row[4], "1203@g.us");
  assert.equal(row[5], "10");
  assert.equal(row[6], "Matheus");
  assert(row[7].includes("ok"));

  assert.equal(sheets._test.normalizeDetalhes("abc"), "abc");
  assert.equal(sheets._test.normalizeDetalhes(null), "");

  console.log("OK: sheets.test");
})();
