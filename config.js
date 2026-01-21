"use strict";

const fs = require("fs");
const path = require("path");

// Carrega .env (se existir)
try { require("dotenv").config(); } catch {}

function toBool(v, fallback = false) {
  if (v === undefined || v === null || v === "") return fallback;
  const s = String(v).trim().toLowerCase();
  if (["1","true","yes","y","on"].includes(s)) return true;
  if (["0","false","no","n","off"].includes(s)) return false;
  return fallback;
}

function splitList(v) {
  return String(v || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function resolvePathMaybe(pth, baseDir) {
  const raw = String(pth || "").trim();
  if (!raw) return null;
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(baseDir || process.cwd(), raw);
}

function looksLikeSheetId(s) {
  const v = String(s || "").trim();
  if (v.length < 20) return false;
  return /^[a-zA-Z0-9-_]+$/.test(v);
}

function loadConfig() {
  const cwd = process.cwd();
  const nodeEnv = (process.env.NODE_ENV || "development").trim();

  // Strict por padrão em produção; pode ser desativado via ENV_STRICT=false
  const strict = (process.env.ENV_STRICT !== undefined)
    ? toBool(process.env.ENV_STRICT, nodeEnv === "production")
    : (nodeEnv === "production");

  const sheetIdRaw = (process.env.SHEET_ID || process.env.SPREADSHEET_ID || process.env.GOOGLE_SHEET_ID || "").trim();
  const legacySheetId = (process.env.LEGACY_SHEET_ID || "").trim();
  const sheetId = sheetIdRaw || legacySheetId || null;

  const credentialsRaw = (process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
  const credentialsPath = resolvePathMaybe(credentialsRaw || "./credentials.json", cwd);

  const produtosRange = (process.env.PRODUTOS_RANGE || "Página1!A2:K").trim();
  const vendasRange = (process.env.VENDASLOG_RANGE || "VendasLog!A2:H").trim();
  const eventosRange = (process.env.EVENTOSLOG_RANGE || "EventosLog!A2:H").trim();

  const allowedGroupsRaw = (process.env.ALLOWED_GROUPS || process.env.ALLOWED_GROUP || "").trim();
  const allowedGroups = allowedGroupsRaw ? splitList(allowedGroupsRaw) : [];

  const waLoginMode = (process.env.WA_LOGIN_MODE || (process.env.WA_PHONE ? "pairing" : "qr"))
    .trim()
    .toLowerCase();
  const waPhone = (process.env.WA_PHONE || "").trim();

  const statePath = resolvePathMaybe((process.env.STATE_PATH || "./state.json").trim(), cwd);
  const authDir = resolvePathMaybe((process.env.AUTH_DIR || "./auth_info").trim(), cwd);

  const dryRun = toBool(process.env.DRY_RUN, false);

  return {
    nodeEnv,
    strict,
    sheetId,
    sheetIdSource: sheetIdRaw ? "SHEET_ID" : (legacySheetId ? "LEGACY_SHEET_ID" : null),
    credentialsPath,
    produtosRange,
    vendasRange,
    eventosRange,
    allowedGroups,
    waLoginMode,
    waPhone,
    statePath,
    authDir,
    dryRun
  };
}

function validateConfig(cfg) {
  const errors = [];
  const warns = [];

  if (!cfg.sheetId) {
    errors.push("SHEET_ID não definido. Defina SHEET_ID com o ID da planilha do cliente.");
  } else if (!looksLikeSheetId(cfg.sheetId)) {
    warns.push("SHEET_ID parece fora do padrão (verifique se você colou o ID correto da planilha).");
  }

  if (!cfg.credentialsPath || !fs.existsSync(cfg.credentialsPath)) {
    errors.push(`Credenciais Google não encontradas em: ${cfg.credentialsPath || "(vazio)"}`);
    errors.push("Defina GOOGLE_APPLICATION_CREDENTIALS com caminho válido ou coloque credentials.json na raiz do projeto.");
  }

  if (cfg.allowedGroups.length) {
    const bad = cfg.allowedGroups.filter(g => !String(g).endsWith("@g.us"));
    if (bad.length) {
      errors.push(`ALLOWED_GROUPS inválido. Use JIDs terminando em @g.us. Problemas: ${bad.join(", ")}`);
    }
  }


// Recomendação/compatibilidade de template:
// Fase 2: logs com coluna de ID na coluna A (A2:H).
// Em produção (strict), exigimos A2:H para evitar desalinhamento no append.
const vendasOk = /^VendasLog!A\d+:H$/i.test(cfg.vendasRange) || /^VendasLog!A\d+:/i.test(cfg.vendasRange);
const eventosOk = /^EventosLog!A\d+:H$/i.test(cfg.eventosRange) || /^EventosLog!A\d+:/i.test(cfg.eventosRange);

if (cfg.strict) {
  if (!vendasOk) errors.push("VENDASLOG_RANGE deve começar na coluna A (ex: VendasLog!A2:H).");
  if (!eventosOk) errors.push("EVENTOSLOG_RANGE deve começar na coluna A (ex: EventosLog!A2:H).");
} else {
  if (!vendasOk) warns.push("Sugestão: use VENDASLOG_RANGE=VendasLog!A2:H (coluna A reservada para vendaId).");
  if (!eventosOk) warns.push("Sugestão: use EVENTOSLOG_RANGE=EventosLog!A2:H (coluna A reservada para eventId).");
}

  if (!(["qr", "pairing"].includes(cfg.waLoginMode))) {
    errors.push("WA_LOGIN_MODE deve ser 'qr' ou 'pairing'.");
  }
  if (cfg.waLoginMode === "pairing" && !cfg.waPhone) {
    errors.push("WA_LOGIN_MODE=pairing exige WA_PHONE (ex: 5511999999999).");
  }

  if (!cfg.authDir) errors.push("AUTH_DIR inválido.");
  if (!cfg.statePath) errors.push("STATE_PATH inválido.");

  return { ok: errors.length === 0, errors, warns };
}

function maskConfigForLog(cfg) {
  const phoneMasked = cfg.waPhone
    ? (cfg.waPhone.length <= 4 ? "****" : `${cfg.waPhone.slice(0, 2)}****${cfg.waPhone.slice(-2)}`)
    : "";

  return {
    nodeEnv: cfg.nodeEnv,
    strict: cfg.strict,
    sheetIdSource: cfg.sheetIdSource,
    sheetId: cfg.sheetId ? `${String(cfg.sheetId).slice(0, 6)}...` : null,
    credentialsPath: cfg.credentialsPath ? path.basename(cfg.credentialsPath) : null,
    produtosRange: cfg.produtosRange,
    vendasRange: cfg.vendasRange,
    eventosRange: cfg.eventosRange,
    allowedGroupsCount: cfg.allowedGroups.length,
    waLoginMode: cfg.waLoginMode,
    waPhone: phoneMasked,
    statePath: cfg.statePath ? path.basename(cfg.statePath) : null,
    authDir: cfg.authDir ? path.basename(cfg.authDir) : null,
    dryRun: cfg.dryRun
  };
}

module.exports = {
  loadConfig,
  validateConfig,
  maskConfigForLog,
  toBool,
  splitList,
  resolvePathMaybe
};
