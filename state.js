"use strict";

const fs = require("fs");
const path = require("path");

const STATE_PATH = path.join(__dirname, "state.json");

const DEFAULT_STATE = () => ({
  // leilão atual
  ativo: false,
  pausado: false,
  produto: null,
  maiorLance: 0,
  vencedor: null,
  chatId: null,

  // timer (não persistimos timer nem funções)
  inicioMs: null,
  restanteMs: null,

  // automático
  sequenciaAtiva: false,
  sequenciaPausada: false,
  filaIds: [],
  idx: 0,
  duracaoMs: null
});

function sanitizeState(st) {
  // só grava campos serializáveis
  return {
    ativo: Boolean(st.ativo),
    pausado: Boolean(st.pausado),
    produto: st.produto ? {
      id: st.produto.id,
      nome: st.produto.nome,
      numero: st.produto.numero,
      colecao: st.produto.colecao,
      qualidade: st.produto.qualidade,
      estoque: st.produto.estoque,
      preco: st.produto.preco,
      precoinicial: st.produto.precoinicial,
      imagem: st.produto.imagem,
      ativo: st.produto.ativo,
      arremate: st.produto.arremate
    } : null,
    maiorLance: Number(st.maiorLance) || 0,
    vencedor: st.vencedor || null,
    chatId: st.chatId || null,
    inicioMs: st.inicioMs || null,
    restanteMs: (st.restanteMs == null ? null : Number(st.restanteMs)),
    sequenciaAtiva: Boolean(st.sequenciaAtiva),
    sequenciaPausada: Boolean(st.sequenciaPausada),
    filaIds: Array.isArray(st.filaIds) ? st.filaIds.map(Number).filter(n => Number.isFinite(n)) : [],
    idx: Number.isFinite(st.idx) ? st.idx : 0,
    duracaoMs: (st.duracaoMs == null ? null : Number(st.duracaoMs))
  };
}

function loadState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return DEFAULT_STATE();
    const raw = fs.readFileSync(STATE_PATH, "utf-8");
    const parsed = JSON.parse(raw);

    // merge defensivo
    const base = DEFAULT_STATE();
    return { ...base, ...parsed };
  } catch {
    // se corromper, volta ao default
    return DEFAULT_STATE();
  }
}

function saveState(st) {
  try {
    const payload = sanitizeState(st);
    fs.writeFileSync(STATE_PATH, JSON.stringify(payload, null, 2), "utf-8");
  } catch {
    // não travar o bot por falha de disco
  }
}

function clearStateFile() {
  try {
    if (fs.existsSync(STATE_PATH)) fs.unlinkSync(STATE_PATH);
  } catch {}
}

// Compatibilidade: versões anteriores e o index.js esperam clearState().
function clearState() {
  clearStateFile();
}

module.exports = {
  loadState,
  saveState,
  clearStateFile,
  clearState,
  DEFAULT_STATE
};
