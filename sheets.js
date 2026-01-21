"use strict";

const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const { google } = require("googleapis");
const { loadConfig } = require("./config");

let _client = null;
let _cfg = null;

function getConfig() {
  if (_cfg) return _cfg;
  _cfg = loadConfig();
  return _cfg;
}

function getSheetsClient() {
  if (_client) return _client;
  const cfg = getConfig();

  const keyFile = cfg.credentialsPath;
  if (!keyFile || !fs.existsSync(keyFile)) {
    const err = new Error(`Credenciais Google não encontradas: ${keyFile || "(vazio)"}`);
    err.code = "NO_GOOGLE_CREDENTIALS";
    throw err;
  }

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  _client = google.sheets({ version: "v4", auth });
  return _client;
}

function getSheetId() {
  const cfg = getConfig();
  if (!cfg.sheetId) {
    // Mantém compatibilidade com setups antigos: se não houver SHEET_ID,
    // o bot ainda pode funcionar se o usuário hardcodar / ou definir LEGACY_SHEET_ID.
    // Porém, em produção, recomenda-se sempre configurar SHEET_ID.
    throw new Error("SHEET_ID não definido no .env. Defina SHEET_ID com o ID da planilha.");
  }
  return cfg.sheetId;
}


function makeId(prefix) {
  // Ex: EVT_kz2m3f_9f3a1c2b
  const ts = Date.now().toString(36);
  const rnd = crypto.randomBytes(4).toString("hex");
  return `${prefix}_${ts}_${rnd}`;
}

function toNumber(v, fallback = 0) {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim().replace(",", ".");
  if (s === "") return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

function produtosSheetName() {
  const cfg = getConfig();
  const r = String(cfg.produtosRange || '').trim();
  const bang = r.indexOf('!');
  if (bang > 0) return r.slice(0, bang);
  // fallback
  return 'Página1';
}

// --------------------------------------
// Produtos
// --------------------------------------
async function carregarProdutos() {
  const cfg = getConfig();
  const sheets = getSheetsClient();
  const spreadsheetId = getSheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: cfg.produtosRange,
  });

  const rows = response.data.values || [];

  return rows.map((row) => ({
    id: toNumber(row[0], 0),
    nome: row[1],
    numero: row[2],
    colecao: row[3],
    qualidade: row[4],
    estoque: toNumber(row[5], 0),
    preco: toNumber(row[6], 0),
    precoinicial: toNumber(row[7], 0),
    imagem: row[8],
    ativo: String(row[9]).trim().toUpperCase() === "TRUE",
    arremate: toNumber(row[10], 0),
  }));
}

async function getProdutoById(id) {
  const produtos = await carregarProdutos();
  const idNum = Number(id);
  return produtos.find((p) => Number(p.id) === idNum);
}

async function atualizarEstoque(id, novoValor) {
  const cfg = getConfig();
  const sheets = getSheetsClient();
  const spreadsheetId = getSheetId();

  const produtos = await carregarProdutos();
  const idNum = Number(id);

  const index = produtos.findIndex((p) => Number(p.id) === idNum);
  if (index === -1) return false;

  const linha = index + 2;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${produtosSheetName()}!F${linha}`,
    valueInputOption: "USER_ENTERED",
    resource: { values: [[novoValor]] },
  });

  if (Number(novoValor) === 0) await atualizarAtivo(idNum, false);
  return true;
}

async function atualizarAtivo(id, ativo) {
  const sheets = getSheetsClient();
  const spreadsheetId = getSheetId();

  const produtos = await carregarProdutos();
  const idNum = Number(id);

  const index = produtos.findIndex((p) => Number(p.id) === idNum);
  if (index === -1) return false;

  const linha = index + 2;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${produtosSheetName()}!J${linha}`,
    valueInputOption: "USER_ENTERED",
    resource: { values: [[ativo ? "TRUE" : "FALSE"]] },
  });

  return true;
}

// --------------------------------------
// Vendas
// --------------------------------------
async function registrarVenda(venda) {
  const cfg = getConfig();
  const sheets = getSheetsClient();
  const spreadsheetId = getSheetId();

  const vendaId = venda.vendaId || makeId("VEN");
  venda.vendaId = vendaId;

  const linha = [
    vendaId,
    venda.nomeComprador,
    venda.data,
    venda.hora,
    venda.produto,
    venda.valorFinal,
    "PENDENTE",
    venda.foiArremate ? "SIM" : "NÃO",
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: cfg.vendasRange,
    valueInputOption: "USER_ENTERED",
    resource: { values: [linha] },
  });

  return true;
}

// --------------------------------------
// Eventos (Observabilidade)
// --------------------------------------
function normalizeDetalhes(d) {
  if (d === undefined || d === null) return "";
  if (typeof d === "string") return d;
  try { return JSON.stringify(d); } catch { return String(d); }
}


function buildEventoRow(e) {
  const now = new Date();
  const data = e.data || now.toLocaleDateString("pt-BR");
  const hora = e.hora || now.toLocaleTimeString("pt-BR");

  const eventId = e.eventId || makeId("EVT");

  return [
    eventId,
    data,
    hora,
    e.evento || "",
    e.chatId || "",
    String(e.produtoId ?? ""),
    e.usuario || "",
    normalizeDetalhes(e.detalhes),
  ];
}


async function registrarEvento(e) {
  return registrarEventosBatch([e]);
}

async function registrarEventosBatch(eventos) {
  const cfg = getConfig();
  const sheets = getSheetsClient();
  const spreadsheetId = getSheetId();

  const values = (Array.isArray(eventos) ? eventos : []).map(buildEventoRow);
  if (values.length === 0) return true;

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: cfg.eventosRange,
    valueInputOption: "USER_ENTERED",
    resource: { values },
  });

  return true;
}

module.exports = {
  carregarProdutos,
  getProdutoById,
  atualizarEstoque,
  atualizarAtivo,
  registrarVenda,
  registrarEvento,
  registrarEventosBatch,

  // testes
  _test: {
    buildEventoRow,
    normalizeDetalhes
  }
};
