// Exemplo de configuração PM2 para múltiplos clientes.
// Recomendação: 1 cliente = 1 pasta (com .env + auth_info + state.json próprios)
//
// Estrutura sugerida:
// /opt/bot-leilao/clienteA
// /opt/bot-leilao/clienteB
//
// Dentro de cada pasta:
// - index.js, sheets.js, etc (mesmo código)
// - .env (SHEET_ID, ALLOWED_GROUPS, GOOGLE_APPLICATION_CREDENTIALS, ...)
// - auth_info/ (sessão WhatsApp desse cliente)
// - state.json (persistência)

module.exports = {
  apps: [
    {
      name: "bot-leilao-clienteA",
      script: "index.js",
      cwd: "/opt/bot-leilao/clienteA",
      time: true,
      autorestart: true,
      max_restarts: 20,
      env: {
        NODE_ENV: "production"
      }
    },
    {
      name: "bot-leilao-clienteB",
      script: "index.js",
      cwd: "/opt/bot-leilao/clienteB",
      time: true,
      autorestart: true,
      max_restarts: 20,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
