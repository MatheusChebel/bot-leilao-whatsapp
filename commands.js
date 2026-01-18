"use strict";

// =====================================================
// Parser de comandos (puro) - usado pelo index.js e por testes
// =====================================================

function tempoMs(t) {
  if (!t || typeof t !== "string") return null;
  const s = t.trim().toLowerCase();
  const n = parseInt(s, 10);
  if (Number.isNaN(n) || n <= 0) return null;

  if (s.endsWith("s")) return n * 1000;
  if (s.endsWith("m")) return n * 60_000;
  if (s.endsWith("h")) return n * 3_600_000;
  return null;
}

// !leilao auto iniciar <idIni> a|ate|até|- <idFim> <tempo>
function parseAutoIniciar(text) {
  const m = String(text).match(
    /^!leilao\s+auto\s+iniciar\s+(\d+)\s*(?:a|ate|até|-)\s*(\d+)\s+(\S+)$/i
  );
  if (!m) return null;
  const idIni = parseInt(m[1], 10);
  const idFim = parseInt(m[2], 10);
  const duracaoMs = tempoMs(m[3]);
  return { idIni, idFim, duracaoMs, rawTempo: m[3] };
}

// !leilao iniciar <id> <tempo>
function parseManualIniciar(text) {
  const m = String(text).match(/^!leilao\s+iniciar\s+(\d+)\s+(\S+)$/i);
  if (!m) return null;
  const id = parseInt(m[1], 10);
  const duracaoMs = tempoMs(m[2]);
  return { id, duracaoMs, rawTempo: m[2] };
}

// !leilao auto setduracao <tempo>
function parseAutoSetDuracao(text) {
  const m = String(text).match(/^!leilao\s+auto\s+setduracao\s+(\S+)$/i);
  if (!m) return null;
  const duracaoMs = tempoMs(m[1]);
  return { duracaoMs, rawTempo: m[1] };
}

// !leilao auto goto <n>
// n = posição 1-based na fila
function parseAutoGoto(text) {
  const m = String(text).match(/^!leilao\s+auto\s+goto\s+(\d+)$/i);
  if (!m) return null;
  const pos = parseInt(m[1], 10);
  return { pos };
}

module.exports = {
  tempoMs,
  parseAutoIniciar,
  parseManualIniciar,
  parseAutoSetDuracao,
  parseAutoGoto
};
