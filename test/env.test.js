"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

function withEnv(env, fn) {
  const backup = { ...process.env };
  try {
    Object.assign(process.env, env);
    return fn();
  } finally {
    process.env = backup;
  }
}

(function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bot-leilao-env-"));
  const cred = path.join(tmp, "credentials.json");
  fs.writeFileSync(cred, "{}", "utf8");

  // Caso válido (QR)
  withEnv({
    NODE_ENV: "test",
    SHEET_ID: "1I8qCk2ZKLVOx0aV45DlFzqz2hCVFEXjib4Tn8Pp_ShM",
    GOOGLE_APPLICATION_CREDENTIALS: cred,
    ALLOWED_GROUPS: "120363404995928532@g.us,120363000000000000@g.us",
    WA_LOGIN_MODE: "qr",
    WA_PHONE: "" // ignorado
  }, () => {
    delete require.cache[require.resolve("../config")];
    const { loadConfig, validateConfig } = require("../config");
    const cfg = loadConfig();
    const res = validateConfig(cfg);
    assert.equal(res.ok, true);
    assert.equal(cfg.allowedGroups.length, 2);
    assert.equal(cfg.waLoginMode, "qr");
  });

  // Pairing sem WA_PHONE deve falhar
  withEnv({
    NODE_ENV: "test",
    SHEET_ID: "1I8qCk2ZKLVOx0aV45DlFzqz2hCVFEXjib4Tn8Pp_ShM",
    GOOGLE_APPLICATION_CREDENTIALS: cred,
    WA_LOGIN_MODE: "pairing",
    WA_PHONE: ""
  }, () => {
    delete require.cache[require.resolve("../config")];
    const { loadConfig, validateConfig } = require("../config");
    const cfg = loadConfig();
    const res = validateConfig(cfg);
    assert.equal(res.ok, false);
    assert(res.errors.some(e => e.includes("WA_PHONE")));
  });

  console.log("OK: env.test");
})();
