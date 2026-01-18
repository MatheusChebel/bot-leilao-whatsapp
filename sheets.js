"use strict";

const { google } = require("googleapis");
const path = require("path");

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(__dirname, "credentials.json"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

// Você pode no futuro trocar para process.env.SHEET_ID, mas mantive como você já usa:
const SPREADSHEET_ID = "1I8qCk2ZKLVOx0aV45DlFzqz2hCVFEXjib4Tn8Pp_ShM";
const RANGE = "Página1!A2:K";

function toNumber(v, fallback = 0) {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim().replace(",", ".");
  if (s === "") return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

// --------------------------------------
// Carregar produtos
// --------------------------------------
async function carregarProdutos() {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: RANGE,
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

// --------------------------------------
async function getProdutoById(id) {
  const produtos = await carregarProdutos();
  const idNum = Number(id);
  return produtos.find((p) => Number(p.id) === idNum);
}

// --------------------------------------
async function atualizarEstoque(id, novoValor) {
  const produtos = await carregarProdutos();
  const idNum = Number(id);

  const index = produtos.findIndex((p) => Number(p.id) === idNum);
  if (index === -1) return false;

  const linha = index + 2;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Página1!F${linha}`,
    valueInputOption: "USER_ENTERED",
    resource: { values: [[novoValor]] },
  });

  if (Number(novoValor) === 0) await atualizarAtivo(idNum, false);
  return true;
}

// --------------------------------------
async function atualizarAtivo(id, ativo) {
  const produtos = await carregarProdutos();
  const idNum = Number(id);

  const index = produtos.findIndex((p) => Number(p.id) === idNum);
  if (index === -1) return false;

  const linha = index + 2;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Página1!J${linha}`,
    valueInputOption: "USER_ENTERED",
    resource: { values: [[ativo ? "TRUE" : "FALSE"]] },
  });

  return true;
}

// --------------------------------------
// Registrar venda
// --------------------------------------
async function registrarVenda(venda) {
  const linha = [
    venda.nomeComprador,
    venda.data,
    venda.hora,
    venda.produto,
    venda.valorFinal,
    "PENDENTE",
    venda.foiArremate ? "SIM" : "NÃO",
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "VendasLog!A2:G",
    valueInputOption: "USER_ENTERED",
    resource: { values: [linha] },
  });

  return true;
}

// --------------------------------------
// Registrar evento (Observabilidade)
// --------------------------------------
async function registrarEvento(e) {
  // se não vier data/hora, calcula aqui (pt-BR)
  const now = new Date();
  const data = e.data || now.toLocaleDateString("pt-BR");
  const hora = e.hora || now.toLocaleTimeString("pt-BR");

  let detalhes = "";
  if (e.detalhes !== undefined && e.detalhes !== null) {
    if (typeof e.detalhes === "string") detalhes = e.detalhes;
    else {
      try { detalhes = JSON.stringify(e.detalhes); } catch { detalhes = String(e.detalhes); }
    }
  }

  const values = [[
    data,
    hora,
    e.evento || "",
    e.chatId || "",
    String(e.produtoId ?? ""),
    e.usuario || "",
    detalhes
  ]];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "EventosLog!A2:G",
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
};
