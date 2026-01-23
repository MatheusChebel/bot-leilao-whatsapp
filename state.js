"use strict";

const fs = require("fs");
const path = require("path");
const { loadConfig } = require("./config");

const cfg = loadConfig();
const STATE_PATH = cfg.statePath || path.join(__dirname, "state.json");
const STATE_TMP = `${STATE_PATH}.tmp`;

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
  duracaoMs: null,

  // suporte a retomada
  autoChatId: null,
  ultimoChatId: null,
  leilaoFromAuto: false,

  // controle do item atual no automático (não avançar idx antes de concluir)
  autoCurrentId: null,
  autoCurrentIdx: null,
  autoCurrentVendaId: null,
  autoCurrentStartedAt: null,

  // venda pendente (garante registro no Sheets mesmo após queda)
  pendingVenda: null
});

function sanitizeProduto(p) {
  if (!p) return null;
  return {
    id: p.id,
    nome: p.nome,
    numero: p.numero,
    colecao: p.colecao,
    qualidade: p.qualidade,
    estoque: p.estoque,
    preco: p.preco,
    precoinicial: p.precoinicial,
    imagem: p.imagem,
    ativo: p.ativo,
    arremate: p.arremate
  };
}

function sanitizeState(st) {
  return {
    ativo: Boolean(st.ativo),
    pausado: Boolean(st.pausado),
    produto: sanitizeProduto(st.produto),
    maiorLance: Number(st.maiorLance) || 0,
    vencedor: st.vencedor || null,
    chatId: st.chatId || null,
    inicioMs: st.inicioMs || null,
    restanteMs: (st.restanteMs == null ? null : Number(st.restanteMs)),
    sequenciaAtiva: Boolean(st.sequenciaAtiva),
    sequenciaPausada: Boolean(st.sequenciaPausada),
    filaIds: Array.isArray(st.filaIds) ? st.filaIds.map(Number).filter(Number.isFinite) : [],
    idx: Number.isFinite(st.idx) ? st.idx : 0,
    duracaoMs: (st.duracaoMs == null ? null : Number(st.duracaoMs)),
    autoChatId: st.autoChatId || null,
    ultimoChatId: st.ultimoChatId || null,
    leilaoFromAuto: Boolean(st.leilaoFromAuto),

    // automático (item em andamento)
    autoCurrentId: (st.autoCurrentId == null ? null : Number(st.autoCurrentId)),
    autoCurrentIdx: (st.autoCurrentIdx == null ? null : Number(st.autoCurrentIdx)),
    autoCurrentVendaId: st.autoCurrentVendaId || null,
    autoCurrentStartedAt: st.autoCurrentStartedAt || null,

    // venda pendente (para flush após queda)
    pendingVenda: (st.pendingVenda && typeof st.pendingVenda === "object") ? st.pendingVenda : null
  };
}

function ensureDirForFile(filePath) {
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // noop
  }
}

function loadState() {
  const base = DEFAULT_STATE();
  try {
    if (!fs.existsSync(STATE_PATH)) return base;
    const raw = fs.readFileSync(STATE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    // merge + sanitize (garante tipos e defaults)
    return sanitizeState({ ...base, ...parsed });
  } catch {
    // se corromper, preserva o arquivo para diagnóstico e volta ao default
    try {
      if (fs.existsSync(STATE_PATH)) {
        const bak = `${STATE_PATH}.corrupt.${Date.now()}`;
        fs.renameSync(STATE_PATH, bak);
      }
    } catch {}
    return base;
  }
}

function saveState(st) {
  try {
    ensureDirForFile(STATE_PATH);
    const payload = sanitizeState(st);
    const json = JSON.stringify(payload, null, 2);

    // Escrita atômica: escreve tmp e renomeia
    fs.writeFileSync(STATE_TMP, json, "utf-8");
    fs.renameSync(STATE_TMP, STATE_PATH);
  } catch {
    // não travar o bot por falha de disco
    try { if (fs.existsSync(STATE_TMP)) fs.unlinkSync(STATE_TMP); } catch {}
  }
}

function clearStateFile() {
  try {
    if (fs.existsSync(STATE_PATH)) fs.unlinkSync(STATE_PATH);
  } catch {}
}

// Compatibilidade: versões anteriores esperam clearState().
function clearState() {
  clearStateFile();
}

module.exports = {
  loadState,
  saveState,
  clearStateFile,
  clearState,
  DEFAULT_STATE,

  // expõe caminhos para debug/testes
  __STATE_PATH: STATE_PATH
};
