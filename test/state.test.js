"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

function resetModuleCache() {
  for (const k of Object.keys(require.cache)) {
    if (k.endsWith("/state.js") || k.endsWith("/config.js")) {
      delete require.cache[k];
    }
  }
}

(function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bot-leilao-state-"));
  const statePath = path.join(tmp, "state.json");

  const backup = { ...process.env };
  try {
    process.env.NODE_ENV = "test";
    process.env.STATE_PATH = statePath;

    resetModuleCache();
    const state = require("../state");

    // Se não existe, deve retornar default
    let st = state.loadState();
    assert.equal(st.ativo, false);
    assert.equal(Array.isArray(st.filaIds), true);

    // Salvar cria arquivo
    st.ativo = true;
    st.maiorLance = 123;
    state.saveState(st);
    assert.equal(fs.existsSync(statePath), true);

    // Carregar volta com os valores
    resetModuleCache();
    const state2 = require("../state");
    const st2 = state2.loadState();
    assert.equal(st2.ativo, true);
    assert.equal(st2.maiorLance, 123);

    // Corromper e garantir fallback
    fs.writeFileSync(statePath, "{corrupt", "utf8");
    resetModuleCache();
    const state3 = require("../state");
    const st3 = state3.loadState();
    assert.equal(st3.ativo, false);

    // Arquivo corrompido deve ter sido movido
    const files = fs.readdirSync(tmp);
    assert(files.some(f => f.startsWith("state.json.corrupt.")));

    console.log("OK: state.test");
  } finally {
    process.env = backup;
  }
})();
