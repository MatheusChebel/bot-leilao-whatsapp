"use strict";

const qrcode = require("qrcode-terminal");

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

// Extrai primeiro inteiro do texto: "30", "R$30", "lance 30", "30 reais"
function extrairNumero(texto) {
  if (!texto) return null;
  const match = String(texto).match(/(\d{1,9})/);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return Number.isNaN(n) ? null : n;
}

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

function isGrupo(jid) {
  return typeof jid === "string" && jid.endsWith("@g.us");
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function clampMin(n, min) {
  return n < min ? min : n;
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
  inicioMs: null,
  restanteMs: null,
  finalizarPromise: null,

  // automático
  sequenciaAtiva: false,
  sequenciaPausada: false,
  filaIds: [],
  idx: 0,
  duracaoMs: null
});

let st = estadoInicial();

// =====================================================
// TIMER (LEILÃO ATUAL)
// =====================================================
function iniciarTimer(finalizar) {
  st.inicioMs = Date.now();
  st.timer = setTimeout(finalizar, st.restanteMs);
}

function pausarLeilaoAtual() {
  if (!st.ativo || st.pausado) return false;
  clearTimeout(st.timer);
  const passou = Date.now() - st.inicioMs;
  st.restanteMs = clampMin(st.restanteMs - passou, 0);
  st.pausado = true;
  return true;
}

function retomarLeilaoAtual() {
  if (!st.ativo || !st.pausado) return false;
  st.pausado = false;
  iniciarTimer(st.finalizarPromise);
  return true;
}

function encerrarLeilaoAtualAgora() {
  if (!st.ativo) return;
  clearTimeout(st.timer);
  try { st.finalizarPromise?.(); } catch {}
}

function cancelarLeilaoAtual() {
  if (!st.ativo) return false;

  clearTimeout(st.timer);
  try { st.finalizarPromise?.(); } catch {}

  st.ativo = false;
  st.pausado = false;
  st.produto = null;
  st.maiorLance = 0;
  st.vencedor = null;
  st.chatId = null;

  st.timer = null;
  st.inicioMs = null;
  st.restanteMs = null;
  st.finalizarPromise = null;

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
async function executarLeilao(sock, chatId, produto, duracaoMs) {
  if (st.ativo) {
    await sock.sendMessage(chatId, { text: "⚠️ Já existe um leilão em andamento." });
    return;
  }
  if (st.sequenciaAtiva) {
    await sock.sendMessage(chatId, { text: "⚠️ Sequência automática ativa. Não é possível iniciar leilão manual agora." });
    return;
  }

  if (!produto) {
    await sock.sendMessage(chatId, { text: "⚠️ Produto não encontrado ou inativo." });
    return;
  }
  if (produto.estoque <= 0) {
    await sock.sendMessage(chatId, { text: "⚠️ estoque esgotado — produto será marcado como inativo." });
    return;
  }

  const arremate = Number.isFinite(produto.arremate) ? produto.arremate : 0;

  st.ativo = true;
  st.pausado = false;
  st.produto = produto;
  st.chatId = chatId;
  st.maiorLance = produto.precoinicial;
  st.vencedor = null;
  st.restanteMs = duracaoMs;

  await sock.sendMessage(chatId, {
    image: { url: produto.imagem },
    caption:
`🔥 *LEILÃO INICIADO!*

📦 ${nomeProduto(produto)}
📦 Estoque: *${produto.estoque}*
💰 Lance inicial: *R$${produto.precoinicial}*
🎯 Arremate: *${arremate ? `R$${arremate}` : "-"}*
⏳ Duração: *${Math.ceil(duracaoMs / 60000)} min*

Envie um lance (ex: 30 / "lance 30" / "R$30").`
  });

  await new Promise(resolve => {
    st.finalizarPromise = resolve;
    iniciarTimer(resolve);
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
  st.inicioMs = null;
  st.restanteMs = null;
  st.finalizarPromise = null;
  st.chatId = null;

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

  const fila = [];
  for (let i = idIni; i <= idFim; i++) fila.push(i);

  st.sequenciaAtiva = true;
  st.sequenciaPausada = false;
  st.filaIds = fila;
  st.idx = 0;
  st.duracaoMs = duracaoMs;

  await sock.sendMessage(chatId, {
    text: `🤖 Sequência automática iniciada: ${idIni} até ${idFim} (${Math.ceil(duracaoMs / 60000)} min cada).`
  });

  while (st.sequenciaAtiva && st.idx < st.filaIds.length) {
    if (st.sequenciaPausada) {
      await sleep(800);
      continue;
    }

    const id = st.filaIds[st.idx];
    st.idx++;

    const produto = await getProdutoById(id);
    if (!produto) continue;

    if (produto.estoque <= 0) {
      await sock.sendMessage(chatId, { text: `⚠️ Produto ${id} com estoque esgotado. Pulando.` });
      continue;
    }

    await executarLeilao(sock, chatId, produto, duracaoMs);
  }

  const terminou = st.idx >= st.filaIds.length;

  st.sequenciaAtiva = false;
  st.sequenciaPausada = false;
  st.filaIds = [];
  st.idx = 0;
  st.duracaoMs = null;

  await sock.sendMessage(chatId, { text: terminou ? "✅ Sequência automática finalizada." : "🛑 Sequência automática interrompida." });
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

    // =================================================
    // DURANTE LEILÃO (somente no chat do leilão)
    // =================================================
    if (st.ativo && chatId === st.chatId) {
      if (text === "!leilao cancelar") {
        const admin = await isAdmin(sock, chatId, senderId);
        if (!admin) {
          await sock.sendMessage(chatId, { text: "⛔ Apenas ADM pode cancelar o leilão." });
          return;
        }

        cancelarLeilaoAtual();
        await sock.sendMessage(chatId, { text: "🛑 *Operação cancelada. Nenhum vencedor será registrado.*" });
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
        await sock.sendMessage(chatId, { text: "⏸️ *Leilão pausado.*" });
        return;
      }

      if (text === "!leilao despausar") {
        const admin = await isAdmin(sock, chatId, senderId);
        if (!admin) {
          await sock.sendMessage(chatId, { text: "⛔ Apenas ADM pode despausar o leilão." });
          return;
        }
        if (!retomarLeilaoAtual()) {
          await sock.sendMessage(chatId, { text: "⚠️ Leilão não está pausado." });
          return;
        }

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

      const lance = extrairNumero(text);
      if (lance !== null) {
        const p = st.produto;
        const arremate = Number.isFinite(p.arremate) ? p.arremate : 0;

        // regras de lance:
        // - se já existe vencedor => mínimo maior+1
        // - se não existe vencedor => aceita >= precoinicial (inclui igual)
        const minimo = st.vencedor ? (st.maiorLance + 1) : p.precoinicial;

        if (lance < minimo) {
          await sock.sendMessage(chatId, {
            text:
`⚠️ *Lance inválido*

💰 Lance mínimo atual: *R$${minimo}*`
          });
          return;
        }

        st.maiorLance = lance;
        st.vencedor = pushName;

        await sock.sendMessage(chatId, {
          text:
`💥 *NOVO LÍDER!*
👤 ${st.vencedor}
💰 Lance atual: *R$${lance}*`
        });

        // ARREMATE => encerra na hora
        if (arremate && lance >= arremate) {
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
`🤖 *Comandos do Bot*

• !help
• !ping

🎯 Leilão Manual
• !leilao iniciar <id> <tempo>

🤖 Leilão Automático
• !leilao auto iniciar <id_inicial> a <id_final> <tempo>
• !leilao auto pausar
• !leilao auto continuar

🛑 Cancelar
• !leilao cancelar`
      });
      return;
    }

    // comandos de leilão apenas em grupo
    if (!isGrupo(chatId)) {
      await sock.sendMessage(chatId, { text: "⚠️ Use comandos de leilão dentro do grupo." });
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

      st.sequenciaAtiva = false;
      st.sequenciaPausada = false;
      await sock.sendMessage(chatId, { text: "🛑 Sequência automática cancelada." });
      return;
    }

    if (text === "!leilao auto pausar") {
      const admin = await isAdmin(sock, chatId, senderId);
      if (!admin) {
        await sock.sendMessage(chatId, { text: "⛔ Apenas ADM pode pausar o automático." });
        return;
      }
      if (!st.sequenciaAtiva) {
        await sock.sendMessage(chatId, { text: "⚠️ Não há sequência automática ativa." });
        return;
      }
      st.sequenciaPausada = true;
      await sock.sendMessage(chatId, { text: "⏸️ Sequência automática pausada." });
      return;
    }

    if (text === "!leilao auto continuar") {
      const admin = await isAdmin(sock, chatId, senderId);
      if (!admin) {
        await sock.sendMessage(chatId, { text: "⛔ Apenas ADM pode continuar o automático." });
        return;
      }
      if (!st.sequenciaAtiva) {
        await sock.sendMessage(chatId, { text: "⚠️ Não há sequência automática ativa." });
        return;
      }
      st.sequenciaPausada = false;
      await sock.sendMessage(chatId, { text: "▶️ Sequência automática retomada." });
      return;
    }

    // iniciar automático
    const auto = text.match(/^!leilao\s+auto\s+iniciar\s+(\d+)\s+(a|até)\s+(\d+)\s+(\S+)$/i);
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

      const idIni = parseInt(auto[1], 10);
      const idFim = parseInt(auto[3], 10);
      const dur = tempoMs(auto[4]);

      if (!dur) {
        await sock.sendMessage(chatId, { text: "⚠️ Tempo inválido. Use 30m, 10m, 1h, etc." });
        return;
      }
      if (idFim < idIni) {
        await sock.sendMessage(chatId, { text: "⚠️ Intervalo inválido (final menor que inicial)." });
        return;
      }

      iniciarSequenciaAutomatica(sock, chatId, idIni, idFim, dur).catch(async (e) => {
        console.error("❌ Erro no automático:", e);
        st.sequenciaAtiva = false;
        st.sequenciaPausada = false;
        await sock.sendMessage(chatId, { text: "❌ Erro no leilão automático. Sequência interrompida." });
      });

      return;
    }

    // iniciar manual
    const manual = text.match(/^!leilao\s+iniciar\s+(\d+)\s+(\S+)$/i);
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

      const id = parseInt(manual[1], 10);
      const dur = tempoMs(manual[2]);

      if (!dur) {
        await sock.sendMessage(chatId, { text: "⚠️ Tempo inválido. Use 30m, 10m, 1h, etc." });
        return;
      }

      const produto = await getProdutoById(id);
      if (!produto) {
        await sock.sendMessage(chatId, { text: "⚠️ Produto não encontrado ou inativo." });
        return;
      }
      if (produto.estoque <= 0) {
        await sock.sendMessage(chatId, { text: "⚠️ estoque esgotado — não vou iniciar o leilão." });
        return;
      }

      executarLeilao(sock, chatId, produto, dur).catch(async (e) => {
        console.error("❌ Erro no leilão manual:", e);
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
    }

    if (connection) console.log("📶 connection:", connection);

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
    }

    // reconexão automática
    if (connection === "close") {
      // Decide se deve reconectar
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const reasonCode = lastDisconnect?.error?.output?.payload?.statusCode;

      // 515 (stream errored) => normalmente requer restart
      if (statusCode === 515 || reasonCode === 515) {
        console.log("🔁 Stream errored (515). Reiniciando conexão em 2s...");
        await sleep(2000);
        conectarComReconexao().catch(console.error);
        return;
      }

      // Se foi logout de verdade, precisa limpar auth_info e logar de novo
      const boomStatus = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut =
        lastDisconnect?.error?.output?.payload?.statusCode === DisconnectReason?.loggedOut ||
        boomStatus === 401;

      if (isLoggedOut) {
        console.log("⚠️ Sessão desconectada (logged out). Apague auth_info e rode novamente.");
        return;
      }

      console.log("🔁 Conexão fechou. Tentando reconectar em 3s...");
      await sleep(3000);
      conectarComReconexao().catch(console.error);
    }

    // Pairing code (opcional)
    // Se você definir WA_PHONE, o Baileys pode solicitar código ao invés de QR dependendo do fluxo.
    // Só chamamos requestPairingCode quando há phone e ainda não está registrado.
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
    } catch (e) {
      console.error("❌ Falha ao solicitar pairing code:", e);
    }
  }

  console.log("✅ Bot iniciado. Se não estiver logado, o QR (ou pairing code) deve aparecer.");
}

conectarComReconexao().catch((err) => {
  console.error("❌ Erro fatal ao iniciar o bot:", err);
});
