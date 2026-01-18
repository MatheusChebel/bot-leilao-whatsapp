const { google } = require("googleapis");
const path = require("path");

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(__dirname, "credentials.json"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

const SPREADSHEET_ID = "1I8qCk2ZKLVOx0aV45DlFzqz2hCVFEXjib4Tn8Pp_ShM";
const RANGE = "Página1!A2:K";

// --------------------------------------
// Carregar produtos
// --------------------------------------
async function carregarProdutos() {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: RANGE
  });

  const rows = response.data.values || [];

  return rows.map(row => ({
    id: Number(row[0]),
    nome: row[1],
    numero: row[2],
    colecao: row[3],
    qualidade: row[4],
    estoque: Number(row[5]),
    preco: Number(row[6]),
    precoinicial: Number(row[7]),
    imagem: row[8],
    ativo: row[9] === "TRUE",
    arremate: Number(String(row[10]).replace(",", "."))
  }));
}

// --------------------------------------
async function getProdutoById(id) {
  const produtos = await carregarProdutos();
  return produtos.find(p => p.id === id && p.ativo);
}

// --------------------------------------
async function atualizarEstoque(id, novoValor) {
  const produtos = await carregarProdutos();
  const index = produtos.findIndex(p => p.id === id);
  if (index === -1) return false;

  const linha = index + 2;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Página1!F${linha}`,
    valueInputOption: "USER_ENTERED",
    resource: { values: [[novoValor]] }
  });

  if (novoValor === 0) await atualizarAtivo(id, false);
  return true;
}

// --------------------------------------
async function atualizarAtivo(id, ativo) {
  const produtos = await carregarProdutos();
  const index = produtos.findIndex(p => p.id === id);
  if (index === -1) return false;

  const linha = index + 2;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Página1!J${linha}`,
    valueInputOption: "USER_ENTERED",
    resource: { values: [[ativo ? "TRUE" : "FALSE"]] }
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
    venda.foiArremate ? "SIM" : "NÃO"
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "VendasLog!A2:G",
    valueInputOption: "USER_ENTERED",
    resource: { values: [linha] }
  });

  return true;
}

module.exports = {
  carregarProdutos,
  getProdutoById,
  atualizarEstoque,
  atualizarAtivo,
  registrarVenda
};
