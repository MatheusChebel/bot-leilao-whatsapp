"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  parseAutoIniciar,
  parseAutoSetDuracao,
  parseAutoGoto,
  parseManualIniciar
} = require("../commands");

function testParsers() {
  // auto iniciar: aceita a/ate/até/-
  assert.deepStrictEqual(parseAutoIniciar("!leilao auto iniciar 1 a 30 15m"), {
    idIni: 1,
    idFim: 30,
    duracaoMs: 15 * 60_000,
    rawTempo: "15m"
  });
  assert.deepStrictEqual(parseAutoIniciar("!leilao auto iniciar 1 ate 30 15m"), {
    idIni: 1,
    idFim: 30,
    duracaoMs: 15 * 60_000,
    rawTempo: "15m"
  });
  assert.deepStrictEqual(parseAutoIniciar("!leilao auto iniciar 1 até 30 15m"), {
    idIni: 1,
    idFim: 30,
    duracaoMs: 15 * 60_000,
    rawTempo: "15m"
  });
  assert.deepStrictEqual(parseAutoIniciar("!leilao auto iniciar 1-30 15m"), {
    idIni: 1,
    idFim: 30,
    duracaoMs: 15 * 60_000,
    rawTempo: "15m"
  });

  // setduracao
  assert.deepStrictEqual(parseAutoSetDuracao("!leilao auto setduracao 10m"), {
    duracaoMs: 10 * 60_000,
    rawTempo: "10m"
  });

  // goto
  assert.deepStrictEqual(parseAutoGoto("!leilao auto goto 12"), { pos: 12 });

  // manual
  assert.deepStrictEqual(parseManualIniciar("!leilao iniciar 7 30s"), {
    id: 7,
    duracaoMs: 30 * 1000,
    rawTempo: "30s"
  });
}

function testIndexWiring() {
  const indexPath = path.join(__dirname, "..", "index.js");
  const src = fs.readFileSync(indexPath, "utf8");

  // Garante que o auto chama executarLeilao com fromAuto=true
  assert(
    src.includes("executarLeilao(sock, chatId, produto, st.duracaoMs, { fromAuto: true })"),
    "runSequenciaLoop deve chamar executarLeilao com { fromAuto: true }"
  );

  // Garante que o bloqueio de manual respeita opts.fromAuto
  assert(
    src.includes("if (st.sequenciaAtiva && !opts.fromAuto)"),
    "executarLeilao deve permitir execução quando opts.fromAuto=true"
  );

  // Garante que help tem os comandos do passo 5
  assert(src.includes("!leilao auto setduracao"), "help deve listar auto setduracao");
  assert(src.includes("!leilao auto goto"), "help deve listar auto goto");
}

(function main() {
  testParsers();
  testIndexWiring();
  console.log("OK: testes do passo 5 passaram.");
})();
