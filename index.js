"use strict";

const qrcode = require("qrcode-terminal");
const { log } = require("./logger");
const { loadState, saveState, clearState } = require("./state");

const {
  tempoMs,
  parseAutoIniciar,
  parseLeilaoEspec,
  parseManualIniciar,
  parseAutoSetDuracao,
  parseAutoGoto
} = require("./commands");


const {
  getProdutoById,
  atualizarEstoque,
  registrarVenda
} = require("./sheets");

// =====================================================
// CONFIG
// =====================================================
// Se quiser usar Pairing Code (ao invés de QR), coloque no PowerShell:
// $env:WA_PHONE="55119XXXXXXXX"
// e rode: node index.js
const WA_PHONE = process.env.WA_PHONE || ""; // ex: 5511999999999 (DDI+DDD+NUMERO, sem +)

// =====================================================
// UTIL
// =====================================================
const nomeProduto = (p) =>
  `${p.nome} (${p.numero}/${p.colecao}) ${p.qualidade}`;

function extrairTexto(m) {
  return (
    m.message?.conversation ||
    m.message?.extendedTextMessage?.text ||
    m.message?.imageMessage?.caption ||
    m.message?.videoMessage?.caption ||
    ""
  ).trim();
}

// Extrai lance padronizado: exige a letra L (ou l) antes do número.
// Aceita: "L20", "l20", "L 20", "l  20".
// Rejeita: números soltos e textos aleatórios para evitar lances acidentais.
function extrairLance(texto) {
  if (!texto) return null;
  const s = String(texto).trim();
  const match = s.match(/^l\s*(\d{1,9})\s*$/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return Number.isNaN(n) ? null : n;
}

function isGrupo(jid) {
  return typeof jid === "string" && jid.endsWith("@g.us");
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

const TEXTO_COMO_DAR_LANCE =
`📌 *Como dar lance (novo padrão)*\n\nPara evitar lances acidentais, os lances agora precisam começar com a letra *L*.\n\n✅ Exemplos válidos:\n• *L20*\n• *l20*\n• *L 20*\n• *l  20*\n\nApenas mensagens nesse formato serão consideradas lances.`;

async function enviarComoDarLance(sock, chatId) {
  await sock.sendMessage(chatId, { text: TEXTO_COMO_DAR_LANCE });
}

// =====================================================
// MARCAR TODOS (MENTION ALL)
// =====================================================
async function isAdmin(sock, chatId, senderId) {
  try {
    if (!isGrupo(chatId)) return false;
    const meta = await sock.groupMetadata(chatId);
    const ps = Array.isArray(meta?.participants) ? meta.participants : [];
    const me = ps.find(p => p?.id === senderId);
    if (!me) return false;
    return me.admin === "admin" || me.admin === "superadmin";
  } catch {
    return false;
  }
}

async function marcarTodosNoGrupo(sock, chatId, senderId, pushName) {
  if (!isGrupo(chatId)) {
    await sock.sendMessage(chatId, { text: "⚠️ Use !marcar dentro do grupo." });
    return { ok: false, motivo: "nao_grupo" };
  }

  const admin = await isAdmin(sock, chatId, senderId);
  if (!admin) {
    await sock.sendMessage(chatId, { text: "⛔ Apenas ADM pode usar !marcar." });
    return { ok: false, motivo: "nao_admin" };
  }

  let meta;
  try {
    meta = await sock.groupMetadata(chatId);
  } catch (e) {
    await sock.sendMessage(chatId, { text: "⚠️ Não consegui ler os membros do grupo agora. Tente novamente." });
    await log("warn", "MARCAR_FAIL_META", {
      chatId,
      usuario: pushName || "ADM",
      detalhes: { message: e?.message || String(e) }
    });
    return { ok: false, motivo: "meta_fail" };
  }

  const participantes = Array.isArray(meta?.participants) ? meta.participants : [];
  const ids = participantes.map(p => p?.id).filter(Boolean);

  if (!ids.length) {
    await sock.sendMessage(chatId, { text: "⚠️ Não encontrei participantes para marcar." });
    return { ok: false, motivo: "vazio" };
  }

  const CHUNK = 50;
  const total = ids.length;
  const baseTexto =
    "📣 *ATENÇÃO!* O leilão vai começar em instantes.\n" +
    "Preparem seus lances e fiquem de olho nas mensagens.";

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const tags = chunk.map(jid => `@${String(jid).split("@")[0]}`).join(" ");
    const texto = i === 0
      ? `${baseTexto}\n\n${tags}`
      : `📣 Continuação (${Math.min(i + CHUNK, total)}/${total})\n${tags}`;

    await sock.sendMessage(chatId, { text: texto, mentions: chunk });
    if (i + CHUNK < ids.length) await sleep(600);
  }

  await log("info", "MARCAR", {
    chatId,
    usuario: pushName || "ADM",
    detalhes: { totalMarcados: total }
  });

  return { ok: true, total };
}

// Mensagem de instrução sobre lances (novo padrão)
function textoInstrucaoLance() {
  return (
`📌 *Como dar lance (novo padrão)*\n\n` +
`Para evitar lances acidentais, os lances agora precisam começar com a letra *L*.\n\n` +
`✅ Exemplos válidos:\n` +
`• *L20*\n` +
`• *l20*\n` +
`• *L 20*\n` +
`• *l  20*\n\n` +
`Apenas mensagens nesse formato serão consideradas lances.`
  );
}

function clampMin(n, min) {
  return n < min ? min : n;
}

function formatMsToMin(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.max(0, Math.ceil(ms / 60000));
}

function statusTexto() {
  const parts = [];

  // Leilão atual
  if (st.ativo && st.produto) {
    const p = st.produto;
    const arremate = Number.isFinite(p.arremate) ? p.arremate : 0;
    const restante = st.pausado
      ? st.restanteMs
      : (Number.isFinite(st.inicioMs) && Number.isFinite(st.restanteMs)
          ? clampMin(st.restanteMs - (Date.now() - st.inicioMs), 0)
          : st.restanteMs);

    parts.push(
      `🎯 *Leilão atual:* ${st.pausado ? "PAUSADO" : "ATIVO"}`,
      `• Produto: ${nomeProduto(p)}`,
      `• Chat: ${st.chatId || "-"}`,
      `• Líder: ${st.vencedor || "Nenhum"}`,
      `• Lance atual: R$${st.maiorLance}`,
      `• Arremate: ${arremate ? `R$${arremate}` : "-"}`,
      `• Tempo restante (aprox.): ${formatMsToMin(restante)} min`
    );
  } else {
    parts.push("🎯 *Leilão atual:* INATIVO");
  }

  parts.push("");

  // Sequência automática
  if (st.sequenciaAtiva) {
    const total = Array.isArray(st.filaIds) ? st.filaIds.length : 0;
    const atual = Math.min(st.idx + 1, total || (st.idx + 1));
    const proximoId =
      Array.isArray(st.filaIds) && st.idx < st.filaIds.length
        ? st.filaIds[st.idx]
        : null;
    parts.push(
      `🤖 *Sequência automática:* ${st.sequenciaPausada ? "PAUSADA" : "ATIVA"}`,
      `• Progresso: ${atual}/${total || "?"}`,
      `• Duração por item: ${formatMsToMin(st.duracaoMs)} min`,
      `• Próximo ID: ${proximoId != null ? proximoId : "-"}`,
      `• Chat: ${st.autoChatId || st.ultimoChatId || "-"}`
    );
  } else {
    parts.push("🤖 *Sequência automática:* INATIVA");
  }

  return parts.join("\n").trim();
}

// =====================================================
// ESTADO GLOBAL (LEILÃO)
// =====================================================
const estadoInicial = () => ({
  // leilão atual
  ativo: false,
  pausado: false,
  produto: null,
  maiorLance: 0,
  vencedor: null,
  chatId: null,

  timer: null,
  warn2mTimer: null,
  warn10sTimer: null,
  inicioMs: null,
  restanteMs: null,
  finalizarPromise: null,

  // origem do leilão atual
  leilaoFromAuto: false,

  // automático
  sequenciaAtiva: false,
  sequenciaPausada: false,
  filaIds: [],
  idx: 0,
  duracaoMs: null,

  // suporte a retomada após reinício
  autoChatId: null,
  ultimoChatId: null
});

let st = { ...estadoInicial(), ...loadState() };
saveState(st);

let autoLoopRunning = false;


function persist() {
  // se não existe nada ativo, limpa o state.json pra não confundir retomada
  if (!st.ativo && !st.sequenciaAtiva) {
    clearState();
    return;
  }

  // Quando o leilão está em andamento (timer correndo), não podemos mexer no
  // estado em memória. Porém, para observabilidade e recuperação, salvamos um
  // snapshot que já considera o tempo restante aproximado e marca como pausado
  // no disco (somente no disco), evitando que o state.json fique enganoso.
  let toSave = st;
  if (st.ativo && !st.pausado && Number.isFinite(st.inicioMs) && Number.isFinite(st.restanteMs)) {
    const passou = Date.now() - st.inicioMs;
    const restante = clampMin(st.restanteMs - passou, 0);

    toSave = {
      ...st,
      restanteMs: restante,
      inicioMs: Date.now(),
      pausado: true,
      // referências de runtime não devem ir para o state.json
      timer: null,
      warn2mTimer: null,
      warn10sTimer: null,
      finalizarPromise: null
    };
  }

  saveState(toSave);
}


// =====================================================
// TIMER (LEILÃO ATUAL)
// =====================================================
function iniciarTimer(sock, chatId, finalizar) {
  st.inicioMs = Date.now();
  st.timer = setTimeout(finalizar, st.restanteMs);
  // avisos de tempo (2 min / 10s)
  try { agendarAvisosTempo(sock, chatId); } catch {}
}

function limparAvisosTempo() {
  if (st.warn2mTimer) clearTimeout(st.warn2mTimer);
  if (st.warn10sTimer) clearTimeout(st.warn10sTimer);
  st.warn2mTimer = null;
  st.warn10sTimer = null;
}

function agendarAvisosTempo(sock, chatId) {
  limparAvisosTempo();
  if (!st.ativo || st.pausado) return;

  const p = st.produto;
  const dur = Number(st.restanteMs);
  if (!Number.isFinite(dur) || dur <= 0) return;

  // aviso de 2 minutos
  if (dur > 2 * 60 * 1000) {
    st.warn2mTimer = setTimeout(async () => {
      if (!st.ativo || st.pausado || st.chatId !== chatId) return;
      await sock.sendMessage(chatId, {
        text:
`⏳ *Faltam 2 minutos!*\n\n📦 ${nomeProduto(p)}\n💰 Lance atual: *R$${st.maiorLance}*\n✅ Lance padronizado: *L<valor>* (ex: *L20*)`
      });
    }, dur - 2 * 60 * 1000);
  }

  // aviso de 10 segundos
  if (dur > 10 * 1000) {
    st.warn10sTimer = setTimeout(async () => {
      if (!st.ativo || st.pausado || st.chatId !== chatId) return;
      await sock.sendMessage(chatId, {
        text:
`⏰ *ÚLTIMOS 10 SEGUNDOS!*\n\n📦 ${nomeProduto(p)}\n💰 Lance atual: *R$${st.maiorLance}*\n✅ Lance padronizado: *L<valor>* (ex: *L20*)`
      });
    }, dur - 10 * 1000);
  }
}

function pausarLeilaoAtual() {
  if (!st.ativo || st.pausado) return false;
  clearTimeout(st.timer);
  limparAvisosTempo();
  const passou = Date.now() - st.inicioMs;
  st.restanteMs = clampMin(st.restanteMs - passou, 0);
  st.pausado = true;
  persist();
  return true;
}

function retomarLeilaoAtual(sock, chatId) {
  if (!st.ativo || !st.pausado) return false;
  st.pausado = false;
  iniciarTimer(sock, chatId, st.finalizarPromise);
  persist();
  return true;
}

function encerrarLeilaoAtualAgora() {
  if (!st.ativo) return;
  clearTimeout(st.timer);
  limparAvisosTempo();
  try { st.finalizarPromise?.(); } catch {}
}

function cancelarLeilaoAtual() {
  if (!st.ativo) {
    // garante que qualquer estado antigo não fique sujo em disco
    persist();
    return false;
  }

  clearTimeout(st.timer);
  limparAvisosTempo();
  try { st.finalizarPromise?.(); } catch {}

  st.ativo = false;
  st.pausado = false;
  st.produto = null;
  st.maiorLance = 0;
  st.vencedor = null;
  st.chatId = null;
  st.leilaoFromAuto = false;

  st.timer = null;
  st.warn2mTimer = null;
  st.warn10sTimer = null;
  st.inicioMs = null;
  st.restanteMs = null;
  st.finalizarPromise = null;

  persist();
  return true;
}

// =====================================================
// ADM CHECK
// =====================================================
async function isAdmin(sock, chatId, senderId) {
  try {
    if (!isGrupo(chatId)) return false;
    const meta = await sock.groupMetadata(chatId);
    const p = meta.participants || [];
    const me = p.find(x => x.id === senderId);
    if (!me) return false;
    return me.admin === "admin" || me.admin === "superadmin";
  } catch {
    return false;
  }
}

// =====================================================
// LEILÃO (1 ITEM)
// =====================================================
async function executarLeilao(sock, chatId, produto, duracaoMs, opts = {}) {
  if (st.ativo) {
    await sock.sendMessage(chatId, { text: "⚠️ Já existe um leilão em andamento." });
    return;
  }
  // Bloqueia apenas o leilão manual quando a sequência automática está ativa.
  if (st.sequenciaAtiva && !opts.fromAuto) {
    await sock.sendMessage(chatId, { text: "⚠️ Sequência automática ativa. Não é possível iniciar leilão manual agora." });
    return;
  }

  if (!produto) {
    await sock.sendMessage(chatId, { text: "⚠️ Produto não encontrado ou inativo." });
    return;
  }
  if (produto.estoque <= 0) {
    await sock.sendMessage(chatId, { text: "⚠️ estoque esgotado — produto será marcado como inativo." });

    // LOG
    await log("warn", "AUTO_SKIP", {
      chatId,
      produtoId: produto?.id ?? "",
      usuario: "BOT",
      detalhes: { motivo: "estoque<=0 (manual)", id: produto?.id }
    });

    return;
  }

  const arremate = Number.isFinite(produto.arremate) ? produto.arremate : 0;

  st.ativo = true;
  st.pausado = false;
  st.produto = produto;
  st.chatId = chatId;
  st.ultimoChatId = chatId;
  st.maiorLance = produto.precoinicial;
  st.vencedor = null;
  st.restanteMs = duracaoMs;
  st.leilaoFromAuto = !!opts.fromAuto;
  persist();
  

  // LOG
  await log("auction", "LEILAO_START", {
    chatId,
    produtoId: produto.id,
    usuario: "ADM",
    detalhes: {
      produto: nomeProduto(produto),
      estoque: produto.estoque,
      precoinicial: produto.precoinicial,
      arremate: arremate || 0,
      duracaoMs
    }
  });

  const sendIntro = (opts.sendIntro ?? !opts.fromAuto);
  if (sendIntro) {
    await enviarComoDarLance(sock, chatId);
  }

  await sock.sendMessage(chatId, {
    image: { url: produto.imagem },
    caption:
`🔥 *LEILÃO INICIADO!*

📦 ${nomeProduto(produto)}
📦 Estoque: *${produto.estoque}*
💰 Lance inicial: *R$${produto.precoinicial}*
🎯 Arremate: *${arremate ? `R$${arremate}` : "-"}*
⏳ Duração: *${Math.ceil(duracaoMs / 60000)} min*

Envie seu lance no formato: *L<valor>* (ex: *L20*).`
  });

  await new Promise(resolve => {
    st.finalizarPromise = resolve;
    iniciarTimer(sock, chatId, resolve);
  });

  // Se foi cancelado ou resetado, sai
  if (!st.ativo || !st.produto) return;

  st.ativo = false;
  clearTimeout(st.timer);

  const produtoFinal = st.produto;
  const vencedor = st.vencedor;
  const valorFinal = st.maiorLance;
  const foiArremate = arremate ? valorFinal >= arremate : false;

  // limpa estado do leilão atual
  st.pausado = false;
  st.produto = null;
  st.timer = null;
  st.warn2mTimer = null;
  st.warn10sTimer = null;
  st.inicioMs = null;
  st.restanteMs = null;
  st.finalizarPromise = null;
  st.chatId = null;
  st.leilaoFromAuto = false;

  // LOG
  await log("auction", "LEILAO_END", {
    chatId,
    produtoId: produtoFinal.id,
    usuario: vencedor || "",
    detalhes: {
      valorFinal,
      houveVencedor: Boolean(vencedor),
      foiArremate
    }
  });

  if (!vencedor) {
    await sock.sendMessage(chatId, { text: "⏳ *LEILÃO ENCERRADO*\nNenhum lance recebido." });
    return;
  }

  await sock.sendMessage(chatId, {
    text:
`🏁 *LEILÃO ENCERRADO!*

🏆 *Vencedor:* ${vencedor}
💰 *Valor final:* R$${valorFinal}${foiArremate ? "\n🎯 *ARREMATE!*" : ""}`
  });

  const agora = new Date();

  // LOG de venda
  await log("auction", foiArremate ? "ARREMATE" : "VENDA_REGISTRADA", {
    chatId,
    produtoId: produtoFinal.id,
    usuario: vencedor,
    detalhes: {
      produto: nomeProduto(produtoFinal),
      valorFinal,
      data: agora.toLocaleDateString("pt-BR"),
      hora: agora.toLocaleTimeString("pt-BR")
    }
  });

  await registrarVenda({
    nomeComprador: vencedor,
    data: agora.toLocaleDateString("pt-BR"),
    hora: agora.toLocaleTimeString("pt-BR"),
    produto: nomeProduto(produtoFinal),
    valorFinal,
    foiArremate
  });

  await atualizarEstoque(produtoFinal.id, produtoFinal.estoque - 1);
}


// =====================================================
// LOOP AUTOMÁTICO (permite retomar após reinício)
// =====================================================
async function runSequenciaLoop(sock, chatId) {
  if (autoLoopRunning) return;
  autoLoopRunning = true;

  try {
    // garante que temos um chat para avisos
    st.autoChatId = chatId || st.autoChatId || st.ultimoChatId || null;
    st.ultimoChatId = st.autoChatId || st.ultimoChatId;
    persist();

    while (st.sequenciaAtiva && st.idx < st.filaIds.length) {
      if (st.sequenciaPausada) {
        await sleep(800);
        continue;
      }

      // IMPORTANTE:
      // A contagem do automático deve avançar (idx++) APENAS quando um item realmente vai a leilão.
      // Se o item estiver inativo/sem estoque, removemos da fila e NÃO incrementamos o idx.
      const id = st.filaIds[st.idx];

      const produto = await getProdutoById(id);
      if (!produto) {
        // Remove item inválido da fila sem contar progresso.
        st.filaIds.splice(st.idx, 1);
        persist();

        await log("warn", "AUTO_SKIP", {
          chatId,
          produtoId: id,
          usuario: "BOT",
          detalhes: { motivo: "produto_inexistente_ou_inativo", id }
        });
        continue;
      }

      if (Number(produto.estoque) <= 0) {
        // Remove item sem estoque da fila sem contar progresso.
        st.filaIds.splice(st.idx, 1);
        persist();

        await sock.sendMessage(chatId, {
          text: `⚠️ Produto ${id} sem estoque. Pulando (não conta no progresso).`
        });

        await log("warn", "AUTO_SKIP", {
          chatId,
          produtoId: id,
          usuario: "BOT",
          detalhes: { motivo: "estoque<=0", id }
        });
        continue;
      }

      // Agora sim: este item será leiloado. Contamos progresso.
      st.idx++;
      persist();

      await executarLeilao(sock, chatId, produto, st.duracaoMs, { fromAuto: true });
    }

    const terminou = st.idx >= st.filaIds.length;

    st.sequenciaAtiva = false;
    st.sequenciaPausada = false;
    st.filaIds = [];
    st.idx = 0;
    st.duracaoMs = null;

    await log("auction", terminou ? "AUTO_END" : "AUTO_CANCEL", {
      chatId,
      usuario: "BOT",
      detalhes: { terminou }
    });

    await sock.sendMessage(chatId, { text: terminou ? "✅ Sequência automática finalizada." : "🛑 Sequência automática interrompida." });

    persist();
  } finally {
    autoLoopRunning = false;
  }
}

async function retomarSequenciaAutomatica(sock, chatId, usuario) {
  if (!st.sequenciaAtiva) return { ok: false, motivo: "nao_ativa" };
  if (autoLoopRunning) return { ok: false, motivo: "ja_rodando" };

  // Caso comum após reinício: o state.json pode indicar st.ativo=true,
  // mas o timer/promise não existe mais em memória. Isso bloqueia o loop
  // automático (executarLeilao recusa se st.ativo=true). Se detectarmos
  // esse "leilão fantasma", limpamos o estado do leilão atual para permitir
  // retomar a sequência com segurança.
  if (st.ativo && !st.timer && !st.finalizarPromise) {
    st.ativo = false;
    st.pausado = false;
    st.produto = null;
    st.chatId = null;
    st.maiorLance = null;
    st.vencedor = null;
    st.inicioMs = null;
    st.restanteMs = null;
    st.leilaoFromAuto = false;
    persist();
  }

  if (!Array.isArray(st.filaIds) || st.filaIds.length === 0) {
    st.sequenciaAtiva = false;
    st.sequenciaPausada = false;
    st.filaIds = [];
    st.idx = 0;
    st.duracaoMs = null;
    persist();
    return { ok: false, motivo: "state_invalido" };
  }

  if (!Number.isFinite(st.duracaoMs) || st.duracaoMs <= 0) {
    st.sequenciaAtiva = false;
    st.sequenciaPausada = false;
    st.filaIds = [];
    st.idx = 0;
    st.duracaoMs = null;
    persist();
    return { ok: false, motivo: "duracao_invalida" };
  }

  st.sequenciaPausada = false;
  st.autoChatId = chatId || st.autoChatId || null;
  st.ultimoChatId = st.autoChatId || st.ultimoChatId;
  persist();

  await log("auction", "AUTO_RESTART", {
    chatId: st.autoChatId || chatId,
    usuario: usuario || "ADM",
    detalhes: { idx: st.idx, total: st.filaIds.length, duracaoMs: st.duracaoMs }
  });

  await sock.sendMessage(st.autoChatId || chatId, {
    text: `🔁 Retomando sequência automática do ponto ${st.idx + 1}/${st.filaIds.length}.`
  });

  await runSequenciaLoop(sock, st.autoChatId || chatId);

  return { ok: true };
}

// =====================================================
// AUTOMÁTICO (SEQUÊNCIA)
// =====================================================
async function iniciarSequenciaAutomatica(sock, chatId, idIni, idFim, duracaoMs) {
  if (st.ativo) {
    await sock.sendMessage(chatId, { text: "⚠️ Já existe um leilão em andamento." });
    return;
  }
  if (st.sequenciaAtiva) {
    await sock.sendMessage(chatId, { text: "⚠️ A sequência automática já está ativa." });
    return;
  }

  // Monta a fila APENAS com itens que existem e possuem estoque (>0) no momento do start.
  // Isso garante que a "contagem" do automático (X/Y) reflita apenas itens elegíveis.
  const fila = [];
  for (let i = idIni; i <= idFim; i++) {
    const p = await getProdutoById(i);
    if (p && Number(p.estoque) > 0) fila.push(i);
  }

  if (fila.length === 0) {
    await sock.sendMessage(chatId, { text: "⚠️ Nenhum item com estoque disponível nesse intervalo. Sequência não iniciada." });
    await log("warn", "AUTO_START_EMPTY", {
      chatId,
      usuario: "ADM",
      detalhes: { idIni, idFim, duracaoMs }
    });
    return;
  }

  st.sequenciaAtiva = true;
  st.sequenciaPausada = false;
  st.filaIds = fila;
  st.idx = 0;
  st.duracaoMs = duracaoMs;
  st.autoChatId = chatId;
  st.ultimoChatId = chatId;
  persist();

  await log("auction", "AUTO_START", {
    chatId,
    usuario: "ADM",
    detalhes: { idIni, idFim, duracaoMs, total: fila.length }
  });

  await sock.sendMessage(chatId, {
    text: `🤖 Sequência automática iniciada: ${idIni} até ${idFim} (${Math.ceil(duracaoMs / 60000)} min cada).\n📦 Itens com estoque no momento do start: *${fila.length}*.`
  });

  // roda loop (e persiste progresso). Se já estiver rodando, ignora.
  runSequenciaLoop(sock, chatId).catch(async (e) => {
    console.error("❌ Erro no automático:", e);

    await log("error", "ERROR_AUTO", {
      chatId,
      usuario: "BOT",
      detalhes: { message: e?.message || String(e) }
    });

    st.sequenciaAtiva = false;
    st.sequenciaPausada = false;
    st.filaIds = [];
    st.idx = 0;
    st.duracaoMs = null;
    st.autoChatId = null;
    persist();

    await sock.sendMessage(chatId, { text: "❌ Erro no leilão automático. Sequência interrompida." });
  });
}

// =====================================================
// AUTOMÁTICO (SEQUÊNCIA) - ESPECÍFICO POR LISTA DE IDS
// =====================================================
// !leilao espec <id1> <id2> ... <tempo>
// Ex: !leilao espec 1 6 9 10 25 10m
async function iniciarSequenciaAutomaticaEspec(sock, chatId, ids, duracaoMs) {
  if (st.ativo) {
    await sock.sendMessage(chatId, { text: "⚠️ Já existe um leilão em andamento." });
    return;
  }
  if (st.sequenciaAtiva) {
    await sock.sendMessage(chatId, { text: "⚠️ A sequência automática já está ativa." });
    return;
  }

  const lista = Array.isArray(ids) ? ids : [];
  if (lista.length === 0) {
    await sock.sendMessage(chatId, { text: "⚠️ Informe ao menos 1 ID." });
    return;
  }

  // Monta a fila APENAS com itens que existem e possuem estoque (>0) no momento do start.
  // Mantém a ordem exata informada no comando.
  const fila = [];
  const ignorados = [];

  for (const id of lista) {
    const p = await getProdutoById(id);
    if (p && Number(p.estoque) > 0) {
      fila.push(id);
    } else {
      ignorados.push(id);
    }
  }

  if (fila.length === 0) {
    await sock.sendMessage(chatId, { text: "⚠️ Nenhum dos IDs informados tem estoque disponível no momento. Sequência não iniciada." });
    await log("warn", "AUTO_ESPEC_START_EMPTY", {
      chatId,
      usuario: "ADM",
      detalhes: { totalInformados: lista.length, ids: lista, ignorados, duracaoMs }
    });
    return;
  }

  st.sequenciaAtiva = true;
  st.sequenciaPausada = false;
  st.filaIds = fila;
  st.idx = 0;
  st.duracaoMs = duracaoMs;
  st.autoChatId = chatId;
  st.ultimoChatId = chatId;
  persist();

  await log("auction", "AUTO_ESPEC_START", {
    chatId,
    usuario: "ADM",
    detalhes: {
      ids: lista,
      totalElegiveis: fila.length,
      totalIgnorados: ignorados.length,
      ignorados,
      duracaoMs
    }
  });

  const tempoMin = Math.ceil(duracaoMs / 60000);
  let msg = `🤖 Sequência automática (espec) iniciada: *${fila.length}* item(ns) (${tempoMin} min cada).`;
  if (ignorados.length) {
    const preview = ignorados.slice(0, 12).join(", ");
    msg += `\n⚠️ Ignorados (inativo/sem estoque): ${preview}${ignorados.length > 12 ? "..." : ""}`;
  }
  await sock.sendMessage(chatId, { text: msg });

  runSequenciaLoop(sock, chatId).catch(async (e) => {
    console.error("❌ Erro no automático (espec):", e);

    await log("error", "ERROR_AUTO_ESPEC", {
      chatId,
      usuario: "BOT",
      detalhes: { message: e?.message || String(e) }
    });

    st.sequenciaAtiva = false;
    st.sequenciaPausada = false;
    st.filaIds = [];
    st.idx = 0;
    st.duracaoMs = null;
    st.autoChatId = null;
    persist();

    await sock.sendMessage(chatId, { text: "❌ Erro no leilão automático (espec). Sequência interrompida." });
  });
}

// =====================================================
// HANDLER DE MENSAGENS
// =====================================================
function registrarHandlers(sock) {
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const m = messages?.[0];
    if (!m?.message || m.key.fromMe) return;

    const chatId = m.key.remoteJid;
    const senderId = m.key.participant || m.key.remoteJid;
    const pushName = m.pushName || "Participante";
    const text = extrairTexto(m);

    if (!text) return;

    // -------------------------------------------------
    // Operacional: descobrir chatId / validar que o handler está ativo
    // -------------------------------------------------
    if (text === "!chatid") {
      await sock.sendMessage(chatId, {
        text: `🧾 *Chat ID (remoteJid)*
${chatId}

👤 *Sender*
${senderId}

📌 *É grupo?* ${isGrupo(chatId) ? "Sim" : "Não"}`
      });

      await log("info", "CMD_CHATID", {
        chatId,
        usuario: pushName,
        detalhes: { senderId, isGrupo: isGrupo(chatId) }
      });
      return;
    }

    // Log leve: registra apenas comandos (evita spam no Sheets)
    if (text.startsWith("!")) {
      await log("info", "CMD_RECEBIDO", {
        chatId,
        usuario: pushName,
        detalhes: { senderId, texto: text.slice(0, 120), isGrupo: isGrupo(chatId) }
      });
    }


    // =================================================
    // DURANTE LEILÃO (somente no chat do leilão)
    // =================================================
    if (st.ativo && chatId === st.chatId) {
      // -------------------------------------------------
      // Comandos globais que DEVEM funcionar mesmo durante leilão
      // -------------------------------------------------
      if (text === "!status" || text === "!leilao status") {
        await sock.sendMessage(chatId, { text: statusTexto() });
        return;
      }

      if (text === "!marcar") {
        await marcarTodosNoGrupo(sock, chatId, senderId, pushName);
        return;
      }

      if (text === "!help" || text === "!ajuda") {
        await sock.sendMessage(chatId, {
          text: `📌 *Comandos do Bot de Leilões*

🧾 Gerais
• !help / !ajuda
• !ping
• !marcar  _(ADM: marca todos para avisar do início do leilão)_

📊 Status
• !status
• !leilao status

🎯 Leilão Manual (ADM)
• !leilao iniciar <id> <tempo>
   Ex: !leilao iniciar 12 30m

⏸️ Controles do Leilão (ADM)
• !leilao pausar
• !leilao despausar
• !leilao cancelar
• !leilao pular  _(pula o item atual do automático)_

🤖 Sequência Automática (ADM)
• !leilao auto iniciar <id_inicial> a <id_final> <tempo>
   Ex: !leilao auto iniciar 1 a 30 15m
• !leilao espec <id1> <id2> ... <tempo>
   Ex: !leilao espec 1 6 9 10 25 10m
• !leilao auto setduracao <tempo>
   Ex: !leilao auto setduracao 10m
• !leilao auto goto <posicao>
   Ex: !leilao auto goto 12

🔁 Recuperação após reinício (ADM)
• !retomar
• !leilao retomar
• !leilao auto retomar

💡 Dicas de tempo
• 30s = 30 segundos
• 15m = 15 minutos
• 1h  = 1 hora`
        });
        return;
      }

      // Retomar após reinício também deve funcionar mesmo se o state veio com
      // um "leilão ativo" (leilão fantasma). Por isso tratamos aqui.
      if (text === "!retomar" || text === "!leilao retomar" || text === "!leilao auto retomar") {
        const admin = await isAdmin(sock, chatId, senderId);
        if (!admin) {
          await sock.sendMessage(chatId, { text: "⛔ Apenas ADM pode retomar." });
          return;
        }

        const res = await retomarSequenciaAutomatica(sock, chatId, pushName);
        if (!res.ok) {
          const msg = {
            nao_ativa: "⚠️ Não há sequência automática pendente para retomar.",
            ja_rodando: "⚠️ A sequência automática já está em execução.",
            state_invalido: "⚠️ Não foi possível retomar (state inválido).",
            duracao_invalida: "⚠️ Não foi possível retomar (duração inválida no state)."
          }[res.motivo] || "⚠️ Não foi possível retomar a sequência.";
          await sock.sendMessage(chatId, { text: msg });
        }
        return;
      }

      // -------------------------------------------------
      // CONTROLES DO AUTOMÁTICO (permitir mesmo durante leilão)
      // -------------------------------------------------
      // Observação: durante a sequência automática, comandos como
      // !leilao auto goto/setduracao devem funcionar
      // mesmo com um leilão ativo, pois afetam o PRÓXIMO item.
      //
      // Também tratamos !leilao cancelar como “cancelar a operação toda”
      // quando o leilão atual foi iniciado pelo automático.

      // setduracao
      const setDurDuring = parseAutoSetDuracao(text);
      if (setDurDuring) {
        const admin = await isAdmin(sock, chatId, senderId);
        if (!admin) {
          await sock.sendMessage(chatId, { text: "⛔ Apenas ADM pode ajustar a duração do automático." });
          return;
        }
        if (!st.sequenciaAtiva) {
          await sock.sendMessage(chatId, { text: "⚠️ Não há sequência automática ativa." });
          return;
        }
        if (!setDurDuring.duracaoMs) {
          await sock.sendMessage(chatId, { text: "⚠️ Tempo inválido. Use 30s, 10m, 1h, etc." });
          return;
        }

        const before = st.duracaoMs;
        st.duracaoMs = setDurDuring.duracaoMs;
        st.autoChatId = chatId;
        st.ultimoChatId = chatId;
        persist();

        await log("auction", "AUTO_SET_DURACAO", {
          chatId,
          usuario: pushName,
          detalhes: { before, after: st.duracaoMs, during: true }
        });

        await sock.sendMessage(chatId, {
          text:
`✅ *Duração do automático atualizada*

⏳ Antes: ${formatMsToMin(before)} min
⏳ Agora: ${formatMsToMin(st.duracaoMs)} min\n\n_(vale para os próximos itens)_`
        });
        return;
      }

      // goto
      const goDuring = parseAutoGoto(text);
      if (goDuring) {
        const admin = await isAdmin(sock, chatId, senderId);
        if (!admin) {
          await sock.sendMessage(chatId, { text: "⛔ Apenas ADM pode alterar a posição do automático." });
          return;
        }
        if (!st.sequenciaAtiva) {
          await sock.sendMessage(chatId, { text: "⚠️ Não há sequência automática ativa." });
          return;
        }

        const total = Array.isArray(st.filaIds) ? st.filaIds.length : 0;
        if (!total) {
          await sock.sendMessage(chatId, { text: "⚠️ State inválido (fila vazia)." });
          return;
        }

        const targetIdx = Math.min(Math.max(goDuring.pos - 1, 0), total);
        const before = st.idx;
        st.idx = targetIdx;
        st.autoChatId = chatId;
        st.ultimoChatId = chatId;
        persist();

        await log("warn", "AUTO_GOTO", {
          chatId,
          usuario: pushName,
          detalhes: { before, after: st.idx, total, pos: goDuring.pos, during: true }
        });

        const proximoId = st.idx < total ? st.filaIds[st.idx] : null;
        await sock.sendMessage(chatId, {
          text:
`🧭 *Posição do automático atualizada*

📌 Agora: ${Math.min(st.idx + 1, total)}/${total}
🆔 Próximo ID: ${proximoId != null ? proximoId : "-"}\n\n_(vale para o próximo item)_`
        });
        return;
      }

      

      // Pular IMEDIATAMENTE o item atual (somente em leilão automático)
      if (text.toLowerCase() === "!leilao pular") {
        const admin = await isAdmin(sock, chatId, senderId);
        if (!admin) {
          await sock.sendMessage(chatId, { text: "⛔ Apenas ADM pode pular o item atual." });
          return;
        }
        if (!st.sequenciaAtiva || !st.leilaoFromAuto) {
          await sock.sendMessage(chatId, { text: "⚠️ Este comando só funciona durante um leilão automático. Use *!leilao cancelar* para encerrar um leilão manual." });
          return;
        }

        await log("warn", "AUTO_SKIP_NOW", {
          chatId,
          produtoId: st.produto?.id ?? "",
          usuario: pushName,
          detalhes: { idxAtual: st.idx, total: Array.isArray(st.filaIds) ? st.filaIds.length : 0 }
        });

        // Cancela apenas o leilão atual e mantém a sequência ativa.
        cancelarLeilaoAtual();
        await sock.sendMessage(chatId, { text: "⏭️ *Item atual pulado.* Indo para o próximo item da sequência automática..." });
        return;
      }
      if (text === "!leilao cancelar") {
        const admin = await isAdmin(sock, chatId, senderId);
        if (!admin) {
          await sock.sendMessage(chatId, { text: "⛔ Apenas ADM pode cancelar o leilão." });
          return;
        }

        const wasAuto = !!st.sequenciaAtiva;

        await log("auction", "CANCEL", {
          chatId,
          produtoId: st.produto?.id ?? "",
          usuario: pushName,
          detalhes: { origem: "durante_leilao", sequenciaAtiva: !!st.sequenciaAtiva }
        });

        // Se o leilão atual faz parte de uma sequência automática, cancelar deve ENCERRAR a sequência
        // (não avançar para o próximo item).
        if (wasAuto) {
          st.sequenciaAtiva = false;
          st.sequenciaPausada = false;
          st.autoChatId = st.autoChatId || chatId;
          st.ultimoChatId = chatId;
          persist();
        }

        cancelarLeilaoAtual();
        await sock.sendMessage(chatId, { text: "🛑 *Operação cancelada. Nenhum vencedor será registrado.*" });
        if (wasAuto) await sock.sendMessage(chatId, { text: "🛑 Sequência automática encerrada." });
        return;
      }

      if (text === "!leilao pausar") {
        const admin = await isAdmin(sock, chatId, senderId);
        if (!admin) {
          await sock.sendMessage(chatId, { text: "⛔ Apenas ADM pode pausar o leilão." });
          return;
        }
        if (!pausarLeilaoAtual()) {
          await sock.sendMessage(chatId, { text: "⚠️ Não há leilão ativo para pausar." });
          return;
        }

        await log("auction", "LEILAO_PAUSE", {
          chatId,
          produtoId: st.produto?.id ?? "",
          usuario: pushName
        });

        await sock.sendMessage(chatId, { text: "⏸️ *Leilão pausado.*" });
        return;
      }

      if (text === "!leilao despausar") {
        const admin = await isAdmin(sock, chatId, senderId);
        if (!admin) {
          await sock.sendMessage(chatId, { text: "⛔ Apenas ADM pode despausar o leilão." });
          return;
        }
        if (!retomarLeilaoAtual(sock, chatId)) {
          await sock.sendMessage(chatId, { text: "⚠️ Leilão não está pausado." });
          return;
        }

        await log("auction", "LEILAO_RESUME", {
          chatId,
          produtoId: st.produto?.id ?? "",
          usuario: pushName
        });

        const p = st.produto;
        await sock.sendMessage(chatId, {
          image: { url: p.imagem },
          caption:
`▶️ *LEILÃO DESPAUSADO!*

📦 ${nomeProduto(p)}
👤 Líder: ${st.vencedor || "Nenhum"}
💰 Lance atual: R$${st.maiorLance}
🎯 Arremate: ${p.arremate ? `R$${p.arremate}` : "-"}
⏳ Tempo restante: ~${Math.ceil(st.restanteMs / 60000)} min`
        });
        return;
      }

      if (st.pausado) {
        await sock.sendMessage(chatId, { text: "⏸️ Leilão pausado. Aguarde despausar." });
        return;
      }

      const lance = extrairLance(text);
      if (lance !== null) {
        const p = st.produto;
        const arremate = Number.isFinite(p.arremate) ? p.arremate : 0;

        // regras de lance:
        // - se já existe vencedor => mínimo maior+1
        // - se não existe vencedor => aceita >= precoinicial (inclui igual)
        const minimo = st.vencedor ? (st.maiorLance + 1) : p.precoinicial;

        if (lance < minimo) {
          await log("warn", "LANCE_REJEITADO", {
            chatId,
            produtoId: p?.id ?? "",
            usuario: pushName,
            detalhes: { lance, minimo, atual: st.maiorLance }
          });

          await sock.sendMessage(chatId, {
            text:
`⚠️ *Lance inválido*

💰 Lance mínimo atual: *R$${minimo}*`
          });
          return;
        }

        st.maiorLance = lance;
        st.vencedor = pushName;
        persist();

        await log("auction", "LANCE_ACEITO", {
          chatId,
          produtoId: p?.id ?? "",
          usuario: pushName,
          detalhes: { lance }
        });

        await sock.sendMessage(chatId, {
          text:
`💥 *NOVO LÍDER!*
👤 ${st.vencedor}
💰 Lance atual: *R$${lance}*`
        });

        // ARREMATE => encerra na hora
        if (arremate && lance >= arremate) {
          await log("auction", "ARREMATE", {
            chatId,
            produtoId: p?.id ?? "",
            usuario: pushName,
            detalhes: { lance, arremate }
          });

          await sock.sendMessage(chatId, {
            text:
`🎯 *ARREMATE CONFIRMADO!*

👤 ${st.vencedor}
💰 *Valor do arremate:* R$${lance}`
          });
          encerrarLeilaoAtualAgora();
        }

        return;
      }

      return;
    }

    // =================================================
    // FORA DO LEILÃO
    // =================================================
    if (!text.startsWith("!")) return;

    if (text === "!ping") {
      await sock.sendMessage(chatId, { text: "pong" });
      return;
    }

    if (text === "!help") {
      await sock.sendMessage(chatId, {
        text:
`🤖 *Comandos do Bot de Leilões*

🔎 Gerais
• !help
• !ping
• !marcar  _(ADM: marca todos para avisar do início do leilão)_

📋 Status
• !status
• !leilao status

🎯 Leilão Manual (ADM)
• !leilao iniciar <id> <tempo>
   Ex: !leilao iniciar 12 30m

⏸️ Controles do Leilão (ADM)
• !leilao pausar
• !leilao despausar
• !leilao cancelar
• !leilao pular  _(pula o item atual do automático)_

🤖 Sequência Automática (ADM)
• !leilao auto iniciar <id_inicial> a <id_final> <tempo>
   Ex: !leilao auto iniciar 1 a 30 15m
• !leilao espec <id1> <id2> ... <tempo>
   Ex: !leilao espec 1 6 9 10 25 10m
• !leilao auto setduracao <tempo>
   Ex: !leilao auto setduracao 10m
• !leilao auto goto <posicao>
   Ex: !leilao auto goto 12

🔁 Recuperação após reinício (ADM)
• !retomar
• !leilao retomar
• !leilao auto retomar

💡 Dicas de tempo
• 30s = 30 segundos
• 15m = 15 minutos
• 1h  = 1 hora`
      });
      return;
    }

    if (text === "!status" || text === "!leilao status") {
      await sock.sendMessage(chatId, { text: statusTexto() });
      return;
    }

    if (text === "!marcar") {
      await marcarTodosNoGrupo(sock, chatId, senderId, pushName);
      return;
    }

    // comandos de leilão apenas em grupo
    if (!isGrupo(chatId)) {
      await sock.sendMessage(chatId, { text: "⚠️ Use comandos de leilão dentro do grupo." });
      return;
    }

    // retomar após reinício (sequência automática)
    if (text === "!retomar" || text === "!leilao retomar" || text === "!leilao auto retomar") {
      const admin = await isAdmin(sock, chatId, senderId);
      if (!admin) {
        await sock.sendMessage(chatId, { text: "⛔ Apenas ADM pode retomar." });
        return;
      }

      const res = await retomarSequenciaAutomatica(sock, chatId, pushName);
      if (!res.ok) {
        const msg = {
          nao_ativa: "⚠️ Não há sequência automática pendente para retomar.",
          ja_rodando: "⚠️ A sequência já está rodando.",
          state_invalido: "⚠️ Não foi possível retomar (state inválido).",
          duracao_invalida: "⚠️ Não foi possível retomar (duração inválida no state)."
        }[res.motivo] || "⚠️ Não foi possível retomar a sequência.";

        await sock.sendMessage(chatId, { text: msg });
      }
      return;
    }

    // cancelar fora do leilão: cancela sequência, ou impede
    if (text === "!leilao cancelar") {
      const admin = await isAdmin(sock, chatId, senderId);
      if (!admin) {
        await sock.sendMessage(chatId, { text: "⛔ Apenas ADM pode cancelar." });
        return;
      }

      if (st.ativo) {
        await sock.sendMessage(chatId, { text: "⚠️ Há um leilão ativo. Use !leilao cancelar no chat do leilão." });
        return;
      }

      if (!st.sequenciaAtiva) {
        await sock.sendMessage(chatId, { text: "⚠️ Não há leilão ativo nem sequência automática para cancelar." });
        return;
      }

      await log("auction", "CANCEL", {
        chatId,
        usuario: pushName,
        detalhes: { origem: "fora_leilao", tipo: "auto" }
      });

      st.sequenciaAtiva = false;
      st.sequenciaPausada = false;
      persist();
      await sock.sendMessage(chatId, { text: "🛑 Sequência automática cancelada." });
      return;
    }

    // (Deprecado) auto pausar/continuar
    // Esses comandos foram removidos do fluxo principal porque geravam confusão
    // com !leilao pausar / !leilao despausar. Mantemos aqui apenas para não quebrar
    // quem já estava acostumado.
    if (text === "!leilao auto pausar" || text === "!leilao auto continuar") {
      await sock.sendMessage(chatId, {
        text:
`ℹ️ *Comando descontinuado*

Use:
• !leilao pausar / !leilao despausar (pausa/retoma o leilão atual)
• !leilao cancelar (encerra a sequência automática)
• !leilao auto goto|pular|voltar (ajustes de fila)`
      });
      return;
    }

    // Ajustar duração (sem reiniciar a fila)
    const setDur = parseAutoSetDuracao(text);
    if (setDur) {
      const admin = await isAdmin(sock, chatId, senderId);
      if (!admin) {
        await sock.sendMessage(chatId, { text: "⛔ Apenas ADM pode ajustar a duração do automático." });
        return;
      }
      if (!st.sequenciaAtiva) {
        await sock.sendMessage(chatId, { text: "⚠️ Não há sequência automática ativa." });
        return;
      }

      if (!setDur.duracaoMs) {
        await sock.sendMessage(chatId, { text: "⚠️ Tempo inválido. Use 30s, 10m, 1h, etc." });
        return;
      }

      const before = st.duracaoMs;
      st.duracaoMs = setDur.duracaoMs;
      st.autoChatId = chatId;
      st.ultimoChatId = chatId;
      persist();

      await log("auction", "AUTO_SET_DURACAO", {
        chatId,
        usuario: pushName,
        detalhes: { before, after: st.duracaoMs }
      });

      await sock.sendMessage(chatId, {
        text:
`✅ *Duração atualizada*

⏳ Antes: ${formatMsToMin(before)} min
⏳ Agora: ${formatMsToMin(st.duracaoMs)} min`
      });
      return;
    }

    // Ir para posição específica na fila (1-based)
    const go = parseAutoGoto(text);
    if (go) {
      const admin = await isAdmin(sock, chatId, senderId);
      if (!admin) {
        await sock.sendMessage(chatId, { text: "⛔ Apenas ADM pode alterar a posição do automático." });
        return;
      }
      if (!st.sequenciaAtiva) {
        await sock.sendMessage(chatId, { text: "⚠️ Não há sequência automática ativa." });
        return;
      }

      const total = Array.isArray(st.filaIds) ? st.filaIds.length : 0;
      if (!total) {
        await sock.sendMessage(chatId, { text: "⚠️ State inválido (fila vazia)." });
        return;
      }

      const targetIdx = Math.min(Math.max(go.pos - 1, 0), total); // permitir total => fim
      const before = st.idx;
      st.idx = targetIdx;
      st.autoChatId = chatId;
      st.ultimoChatId = chatId;
      persist();

      await log("warn", "AUTO_GOTO", {
        chatId,
        usuario: pushName,
        detalhes: { before, after: st.idx, total, pos: go.pos }
      });

      const proximoId = st.idx < total ? st.filaIds[st.idx] : null;
      await sock.sendMessage(chatId, {
        text:
`🧭 *Posição atualizada*

📌 Agora: ${Math.min(st.idx + 1, total)}/${total}
🆔 Próximo ID: ${proximoId != null ? proximoId : "-"}`
      });
      return;
    }

    // iniciar automático (lista específica de IDs)
    const espec = parseLeilaoEspec(text);
    if (espec) {
      const admin = await isAdmin(sock, chatId, senderId);
      if (!admin) {
        await sock.sendMessage(chatId, { text: "⛔ Apenas ADM pode iniciar leilão automático (espec)." });
        return;
      }

      if (st.ativo) {
        await sock.sendMessage(chatId, { text: "⚠️ Já existe um leilão em andamento." });
        return;
      }
      if (st.sequenciaAtiva) {
        await sock.sendMessage(chatId, { text: "⚠️ A sequência automática já está ativa." });
        return;
      }

      if (!espec.duracaoMs) {
        await sock.sendMessage(chatId, { text: "⚠️ Tempo inválido. Use 30s, 10m, 1h, etc." });
        return;
      }

      st.ultimoChatId = chatId;
      persist();

      await log("auction", "AUTO_ESPEC_CMD_INICIAR", {
        chatId,
        usuario: pushName,
        detalhes: { ids: espec.ids, duracaoMs: espec.duracaoMs }
      });

      // Envia instruções de lance apenas ao iniciar a sequência (não a cada item)
      await enviarComoDarLance(sock, chatId);

      iniciarSequenciaAutomaticaEspec(sock, chatId, espec.ids, espec.duracaoMs).catch(async (e) => {
        console.error("❌ Erro no automático (espec):", e);

        await log("error", "ERROR_AUTO_ESPEC", {
          chatId,
          usuario: "BOT",
          detalhes: { message: e?.message || String(e) }
        });

        st.sequenciaAtiva = false;
        st.sequenciaPausada = false;
        await sock.sendMessage(chatId, { text: "❌ Erro no leilão automático (espec). Sequência interrompida." });
      });

      return;
    }

    // iniciar automático
    const auto = parseAutoIniciar(text);
    if (auto) {
      const admin = await isAdmin(sock, chatId, senderId);
      if (!admin) {
        await sock.sendMessage(chatId, { text: "⛔ Apenas ADM pode iniciar leilão automático." });
        return;
      }

      if (st.ativo) {
        await sock.sendMessage(chatId, { text: "⚠️ Já existe um leilão em andamento." });
        return;
      }
      if (st.sequenciaAtiva) {
        await sock.sendMessage(chatId, { text: "⚠️ A sequência automática já está ativa." });
        return;
      }

      const idIni = auto.idIni;
      const idFim = auto.idFim;
      const dur = auto.duracaoMs;

      if (!dur) {
        await sock.sendMessage(chatId, { text: "⚠️ Tempo inválido. Use 30s, 10m, 1h, etc." });
        return;
      }
      if (idFim < idIni) {
        await sock.sendMessage(chatId, { text: "⚠️ Intervalo inválido (final menor que inicial)." });
        return;
      }

      st.ultimoChatId = chatId;
      persist();

      await log("auction", "AUTO_CMD_INICIAR", {
        chatId,
        usuario: pushName,
        detalhes: { idIni, idFim, duracaoMs: dur }
      });

      // Envia instruções de lance apenas ao iniciar a sequência (não a cada item)
      await enviarComoDarLance(sock, chatId);

      iniciarSequenciaAutomatica(sock, chatId, idIni, idFim, dur).catch(async (e) => {
        console.error("❌ Erro no automático:", e);

        await log("error", "ERROR_AUTO", {
          chatId,
          usuario: "BOT",
          detalhes: { message: e?.message || String(e) }
        });

        st.sequenciaAtiva = false;
        st.sequenciaPausada = false;
        await sock.sendMessage(chatId, { text: "❌ Erro no leilão automático. Sequência interrompida." });
      });

      return;
    }

    // iniciar manual
    const manual = parseManualIniciar(text);
    if (manual) {
      const admin = await isAdmin(sock, chatId, senderId);
      if (!admin) {
        await sock.sendMessage(chatId, { text: "⛔ Apenas ADM pode iniciar leilão." });
        return;
      }

      if (st.ativo) {
        await sock.sendMessage(chatId, { text: "⚠️ Já existe um leilão em andamento." });
        return;
      }
      if (st.sequenciaAtiva) {
        await sock.sendMessage(chatId, { text: "⚠️ Sequência automática ativa. Não é possível iniciar leilão manual." });
        return;
      }

      const id = manual.id;
      const dur = manual.duracaoMs;

      if (!dur) {
        await sock.sendMessage(chatId, { text: "⚠️ Tempo inválido. Use 30m, 10m, 1h, etc." });
        return;
      }

      const produto = await getProdutoById(id);
      if (!produto) {
        await sock.sendMessage(chatId, { text: "⚠️ Produto não encontrado ou inativo." });

        await log("warn", "MANUAL_PRODUTO_NAO_ENCONTRADO", {
          chatId,
          produtoId: id,
          usuario: pushName
        });

        return;
      }
      if (produto.estoque <= 0) {
        await sock.sendMessage(chatId, { text: "⚠️ estoque esgotado — não vou iniciar o leilão." });

        await log("warn", "MANUAL_ESTOQUE_ESGOTADO", {
          chatId,
          produtoId: id,
          usuario: pushName,
          detalhes: { estoque: produto.estoque }
        });

        return;
      }

      st.ultimoChatId = chatId;
      persist();

      await log("auction", "MANUAL_CMD_INICIAR", {
        chatId,
        produtoId: id,
        usuario: pushName,
        detalhes: { duracaoMs: dur }
      });

      executarLeilao(sock, chatId, produto, dur).catch(async (e) => {
        console.error("❌ Erro no leilão manual:", e);

        await log("error", "ERROR_MANUAL", {
          chatId,
          produtoId: id,
          usuario: "BOT",
          detalhes: { message: e?.message || String(e) }
        });

        cancelarLeilaoAtual();
        await sock.sendMessage(chatId, { text: "❌ Ocorreu um erro e o leilão foi interrompido." });
      });

      return;
    }

    if (text.startsWith("!leilao")) {
      await sock.sendMessage(chatId, { text: "⚠️ Comando inválido. Use !help para ver os comandos." });
    }
  });
}

// =====================================================
// CONEXÃO + RECONEXÃO
// =====================================================
async function conectarComReconexao() {
  await log("info", "BOT_START", { detalhes: { node: process.version } });

  const baileys = await import("@whiskeysockets/baileys");
  const makeWASocket = baileys.default;

  const {
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    Browsers,
    DisconnectReason
  } = baileys;

  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log("🔧 WA Web version usada:", version, "isLatest:", isLatest);

  const sock = makeWASocket({
    auth: state,
    version,
    browser: Browsers.appropriate("Desktop"),
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", saveCreds);

  // handlers
  registrarHandlers(sock);

  // connection update
  sock.ev.on("connection.update", async (update) => {
    const { qr, connection, lastDisconnect } = update;

    if (qr) {
      console.log("📌 QR gerado (escaneie no WhatsApp)...");
      qrcode.generate(qr, { small: true });

      await log("info", "WA_QR_GERADO", {
        detalhes: { modo: WA_PHONE ? "pairing/qr" : "qr" }
      });
    }

    if (connection) {
      console.log("📶 connection:", connection);
      await log("info", "WA_CONN_STATUS", { detalhes: { connection } });
    }

    const err = lastDisconnect?.error;
    if (err) {
      const statusCode =
        err?.output?.statusCode ||
        err?.data?.statusCode ||
        err?.statusCode;

      const reason =
        err?.output?.payload?.message ||
        err?.message ||
        "unknown";

      console.log("❌ lastDisconnect:", { statusCode, reason });

      await log("warn", "WA_DISCONNECT", {
        detalhes: { statusCode, reason }
      });
    }

    // Aviso de retomada (após reinício)
    if (connection === "open") {
      try {
        const targets = new Set();
        if (st.ativo && st.chatId) targets.add(st.chatId);
        if (st.sequenciaAtiva && (st.autoChatId || st.ultimoChatId)) targets.add(st.autoChatId || st.ultimoChatId);

        for (const jid of targets) {
          const msgParts = [];
          if (st.sequenciaAtiva) {
            const total = Array.isArray(st.filaIds) ? st.filaIds.length : 0;
            msgParts.push(`⚠️ Detectei *sequência automática pendente* após reinício. Use *!retomar* (ADM) para continuar do ponto ${st.idx + 1}/${total || "?"}.`);
          }
          if (st.ativo) {
            msgParts.push("⚠️ Detectei *um leilão marcado como ativo* antes do reinício. Por segurança, um ADM pode usar *!leilao cancelar* para limpar o estado e iniciar novamente.");
          }
          if (msgParts.length) {
            await sock.sendMessage(jid, { text: msgParts.join("\n\n") });
          }
        }

        await log("info", "BOOT_STATE_CHECK", {
          detalhes: {
            ativo: st.ativo,
            sequenciaAtiva: st.sequenciaAtiva,
            chatLeilao: st.chatId || null,
            chatAuto: st.autoChatId || st.ultimoChatId || null,
            idx: st.idx,
            total: Array.isArray(st.filaIds) ? st.filaIds.length : 0
          }
        });
      } catch {
        // silêncio para não travar o bot
      }
    }

    // reconexão automática
    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const reasonCode = lastDisconnect?.error?.output?.payload?.statusCode;

      // 515 (stream errored) => normalmente requer restart
      if (statusCode === 515 || reasonCode === 515) {
        console.log("🔁 Stream errored (515). Reiniciando conexão em 2s...");
        await sleep(2000);
        conectarComReconexao().catch(console.error);
        return;
      }

      const boomStatus = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut =
        lastDisconnect?.error?.output?.payload?.statusCode === DisconnectReason?.loggedOut ||
        boomStatus === 401;

      if (isLoggedOut) {
        console.log("⚠️ Sessão desconectada (logged out). Apague auth_info e rode novamente.");

        await log("error", "WA_LOGGED_OUT", {
          detalhes: { boomStatus }
        });

        return;
      }

      console.log("🔁 Conexão fechou. Tentando reconectar em 3s...");
      await sleep(3000);
      conectarComReconexao().catch(console.error);
    }

    // Pairing code (opcional)
    if (WA_PHONE && connection === "open") {
      // nada a fazer
    }
  });

  // Pairing code: se WA_PHONE estiver setado e ainda não houver credenciais válidas,
  // pede código (pode ser melhor que QR em alguns ambientes).
  if (WA_PHONE && !state.creds.registered) {
    try {
      const code = await sock.requestPairingCode(WA_PHONE);
      console.log("📲 Pairing Code:", code);
      console.log("Abra WhatsApp > Dispositivos conectados > Conectar dispositivo > 'Conectar com número' e digite o código.");

      await log("info", "WA_PAIRING_CODE_GERADO", {
        detalhes: { phone: WA_PHONE }
      });
    } catch (e) {
      console.error("❌ Falha ao solicitar pairing code:", e);

      await log("error", "WA_PAIRING_CODE_ERRO", {
        detalhes: { message: e?.message || String(e) }
      });
    }
  }

  console.log("✅ Bot iniciado. Se não estiver logado, o QR (ou pairing code) deve aparecer.");
}

conectarComReconexao().catch(async (err) => {
  console.error("❌ Erro fatal ao iniciar o bot:", err);
  try {
    await log("error", "FATAL", { detalhes: { message: err?.message || String(err) } });
  } catch {}
});
