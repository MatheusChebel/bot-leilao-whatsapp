"use strict";

const { registrarEventosBatch } = require("./sheets");

/**
 * Logger com:
 * - console imediato
 * - fila em memória
 * - flush em lote (batch) no Google Sheets (EventosLog)
 * - retry com backoff
 * - proteção para não travar o bot
 */

const CFG = {
  batchSize: 10,
  flushIntervalMs: 2500,
  maxQueueSize: 500,
  maxRetries: 5,
  backoffBaseMs: 800,
  backoffMaxMs: 30_000,
  maxDetalhesChars: 2500
};

let queue = [];
let flushing = false;
let timer = null;

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
    data: t.data,
    hora: t.hora,
    evento: event,
    chatId: data?.chatId || "",
    produtoId: data?.produtoId ?? "",
    usuario: data?.usuario || "",
    detalhes,

    __level: level,
    __tries: 0,
    __nextTryAt: 0
  };
}

function consolePrint(row) {
  const lvl = LEVELS[row.__level] || "INFO";
  const base = `[${lvl}] ${row.data} ${row.hora} ${row.evento}`;
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
  queue.splice(0, overflow);
  console.warn(
    `[WARN] Logger queue overflow: descartados ${overflow} eventos antigos (maxQueueSize=${CFG.maxQueueSize}).`
  );
}

function backoffMs(tries) {
  const exp = Math.min(CFG.backoffMaxMs, CFG.backoffBaseMs * Math.pow(2, tries - 1));
  const jitter = Math.floor(Math.random() * 250);
  return exp + jitter;
}

function rowToEventoPayload(row) {
  return {
    data: row.data,
    hora: row.hora,
    evento: row.evento,
    chatId: row.chatId,
    produtoId: row.produtoId,
    usuario: row.usuario,
    detalhes: row.detalhes
  };
}

async function flush() {
  if (flushing) return;
  if (queue.length === 0) return;

  flushing = true;

  try {
    const now = Date.now();

    const batch = [];
    const remaining = [];

    for (const row of queue) {
      if (batch.length < CFG.batchSize && row.__nextTryAt <= now) batch.push(row);
      else remaining.push(row);
    }

    if (batch.length === 0) {
      queue = remaining;
      return;
    }

    queue = remaining;

    try {
      const eventos = batch.map(rowToEventoPayload);
      await registrarEventosBatch(eventos);
    } catch (e) {
      const msg = e?.message || String(e);
      console.error(`[ERROR] Falha ao registrar batch no Sheets:`, msg);

      // Re-enfileira com backoff por item
      for (const row of batch) {
        row.__tries += 1;
        if (row.__tries < CFG.maxRetries) {
          row.__nextTryAt = Date.now() + backoffMs(row.__tries);
          queue.push(row);
        } else {
          console.error(`[ERROR] Desistindo do evento (maxRetries atingido):`, row.evento, {
            chatId: row.chatId,
            produtoId: row.produtoId,
            usuario: row.usuario
          });
        }
      }
    }

    dropIfQueueTooBig();
  } finally {
    flushing = false;
  }
}

function log(level, event, data = {}) {
  const lvl = (LEVELS[level] ? level : "info");
  const row = buildRow(lvl, event, data);
  consolePrint(row);

  queue.push(row);
  dropIfQueueTooBig();

  // dispara um flush leve
  flush().catch(() => {});
}

async function flushNow() {
  await flush();
}

function start() {
  if (timer) return;
  timer = setInterval(() => {
    flush().catch(() => {});
  }, CFG.flushIntervalMs);
  if (timer.unref) timer.unref();
}

function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

// Flush em encerramento (PM2 / Ctrl+C)
process.on("SIGINT", async () => {
  try { await flushNow(); } catch {}
  process.exit(0);
});
process.on("SIGTERM", async () => {
  try { await flushNow(); } catch {}
  process.exit(0);
});

start();

module.exports = {
  log,
  flushNow,
  start,
  stop
};
