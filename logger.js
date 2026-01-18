"use strict";

const { registrarEvento } = require("./sheets");

/**
 * Logger com:
 * - console sempre
 * - fila em memória
 * - flush em lote (batch)
 * - retry com backoff
 * - proteção para não travar o bot
 *
 * Eventos esperados (exemplos):
 * LEILAO_START, LEILAO_END, ARREMATE, LANCE_REJEITADO, AUTO_SKIP, AUTO_PAUSE, AUTO_RESUME, CANCEL,
 * WA_CONN_OPEN, WA_CONN_CLOSE, ERROR, FATAL etc.
 */

// =========================
// CONFIG DO LOGGER
// =========================
const CFG = {
  // quantos eventos mandar por lote (batch)
  batchSize: 10,

  // intervalo de flush automático (ms)
  flushIntervalMs: 2500,

  // tamanho máximo da fila em memória
  maxQueueSize: 500,

  // tentativas máximas por evento antes de desistir
  maxRetries: 5,

  // backoff inicial (ms) e máximo (ms)
  backoffBaseMs: 800,
  backoffMaxMs: 30_000,

  // limite de caracteres do campo Detalhes (pra não estourar célula/Sheets)
  maxDetalhesChars: 2500
};

// =========================
// FILA + CONTROLE
// =========================
let queue = [];
let flushing = false;
let timer = null;

// =========================
// UTIL
// =========================
const LEVELS = {
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
  auction: "AUCTION"
};

function nowPayload() {
  const now = new Date();
  return {
    data: now.toLocaleDateString("pt-BR"),
    hora: now.toLocaleTimeString("pt-BR")
  };
}

function safeStringify(obj) {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

function truncate(str, max) {
  if (!str) return "";
  const s = String(str);
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

function buildRow(level, event, data) {
  const t = nowPayload();
  const detalhes =
    data?.detalhes !== undefined
      ? truncate(safeStringify(data.detalhes), CFG.maxDetalhesChars)
      : (data?.detalhesRaw ? truncate(String(data.detalhesRaw), CFG.maxDetalhesChars) : "");

  return {
    // colunas do EventosLog
    data: t.data,
    hora: t.hora,
    evento: event,
    chatId: data?.chatId || "",
    produtoId: data?.produtoId ?? "",
    usuario: data?.usuario || "",
    detalhes,

    // metadados internos do logger
    __level: level,
    __tries: 0,
    __nextTryAt: 0
  };
}

function consolePrint(row) {
  const lvl = LEVELS[row.__level] || "INFO";
  const base = `[${lvl}] ${row.data} ${row.hora} ${row.evento}`;
  // Mantém console limpo, mas informativo
  console.log(base, {
    chatId: row.chatId,
    produtoId: row.produtoId,
    usuario: row.usuario,
    detalhes: row.detalhes
  });
}

function dropIfQueueTooBig() {
  if (queue.length <= CFG.maxQueueSize) return;

  const overflow = queue.length - CFG.maxQueueSize;
  // descarta os mais antigos
  queue.splice(0, overflow);

  // log no console (não tenta mandar pro sheets, pois é evento de overflow)
  console.warn(
    `[WARN] Logger queue overflow: descartados ${overflow} eventos antigos (maxQueueSize=${CFG.maxQueueSize}).`
  );
}

// =========================
// FLUSH EM LOTE
// =========================
function backoffMs(tries) {
  // tries: 1..N
  const exp = Math.min(CFG.backoffMaxMs, CFG.backoffBaseMs * Math.pow(2, tries - 1));
  // pequeno jitter p/ evitar thundering herd
  const jitter = Math.floor(Math.random() * 250);
  return exp + jitter;
}

/**
 * Tenta enviar um evento.
 * RegistrarEvento hoje grava 1 linha por chamada.
 * Para batch real, seria ideal uma registrarEventos(values) no sheets.js.
 * Como você pediu "logger melhorado" sem mexer demais, a gente faz batch lógico:
 * dispara N chamadas, mas controladas e com retry.
 */
async function sendOne(row) {
  // converte para payload do sheets.js
  const payload = {
    data: row.data,
    hora: row.hora,
    evento: row.evento,
    chatId: row.chatId,
    produtoId: row.produtoId,
    usuario: row.usuario,
    detalhes: row.detalhes
  };

  await registrarEvento(payload);
}

async function flush() {
  if (flushing) return;
  if (queue.length === 0) return;

  flushing = true;

  try {
    const now = Date.now();

    // pega até batchSize itens que já podem ser tentados agora
    const batch = [];
    const remaining = [];

    for (const row of queue) {
      if (batch.length < CFG.batchSize && row.__nextTryAt <= now) {
        batch.push(row);
      } else {
        remaining.push(row);
      }
    }

    // se nada pronto para tentar agora, só mantém fila
    if (batch.length === 0) {
      queue = remaining;
      return;
    }

    // remove os batch da fila imediatamente (os restantes já ficaram em remaining)
    queue = remaining;

    // envia sequencialmente para reduzir chance de rate limit
    // (se quiser mais velocidade, dá pra fazer Promise.all com limite de concorrência)
    for (const row of batch) {
      try {
        await sendOne(row);
      } catch (e) {
        row.__tries += 1;

        const msg = e?.message || String(e);
        console.error(
          `[ERROR] Falha ao registrar evento no Sheets (try ${row.__tries}/${CFG.maxRetries}):`,
          row.evento,
          msg
        );

        if (row.__tries < CFG.maxRetries) {
          row.__nextTryAt = Date.now() + backoffMs(row.__tries);
          queue.push(row); // re-enfileira
        } else {
          console.error(
            `[ERROR] Desistindo do evento (maxRetries atingido):`,
            row.evento,
            {
              chatId: row.chatId,
              produtoId: row.produtoId,
              usuario: row.usuario
            }
          );
        }
      }
    }

    dropIfQueueTooBig();
  } finally {
    flushing = false;
  }
}

// =========================
// API PUBLICA
// =========================
/**
 * Log principal:
 * - imprime no console imediatamente
 * - coloca na fila pro Sheets
 */
function log(level, event, data = {}) {
  const lvl = (LEVELS[level] ? level : "info");

  const row = buildRow(lvl, event, data);
  consolePrint(row);

  queue.push(row);
  dropIfQueueTooBig();

  // dispara um flush "leve" sem bloquear o caller
  // (mas não cria flush concorrente, pois flush() se protege)
  flush().catch(() => {});
}

/**
 * Força envio do que estiver pendente.
 * Útil antes de fechar processo.
 */
async function flushNow() {
  await flush();
}

/**
 * Inicia flush automático em intervalos.
 */
function start() {
  if (timer) return;
  timer = setInterval(() => {
    flush().catch(() => {});
  }, CFG.flushIntervalMs);
  // não segurar o processo aberto só por causa do timer
  if (timer.unref) timer.unref();
}

/**
 * Para o flush automático.
 */
function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

// inicia automaticamente
start();

module.exports = {
  log,
  flushNow,
  start,
  stop
};
