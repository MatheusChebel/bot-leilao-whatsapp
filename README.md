# Bot de Leilões WhatsApp (Zeraora TCG)

Bot para realizar leilões automáticos em grupos do WhatsApp, com catálogo e logs em **Google Sheets**.

## Visão geral

- Leilão manual e sequência automática
- Persistência local (`state.json`) para retomar progresso
- Observabilidade em planilha (`EventosLog`) e registro de vendas (`VendasLog`)
- Filtro por grupo permitido via `ALLOWED_GROUPS`

## Pré-requisitos

- Node.js 20+
- Conta de **Service Account** do Google com acesso de editor na planilha do cliente
- VPS (opcional) se for rodar 24/7 (ex.: DigitalOcean)

## Instalação (local)

```bash
npm ci
cp .env.example .env
# edite .env
node index.js
```

## Configuração (.env)

Veja `.env.example`.

**Obrigatórios:**
- `SHEET_ID`
- `GOOGLE_APPLICATION_CREDENTIALS` (ou `./credentials.json` na raiz)

**Recomendados (produção):**
- `ALLOWED_GROUPS` com o JID do grupo (termina em `@g.us`)
- `WA_LOGIN_MODE=qr` (padrão)

## Credenciais Google Sheets

1. Crie/baixe o `credentials.json` (Service Account).
2. Aponte o caminho no `.env`:
   - `GOOGLE_APPLICATION_CREDENTIALS=/caminho/absoluto/credentials.json` (recomendado em VPS)
   - ou `./credentials.json` (local)
3. Compartilhe a planilha com o e-mail `client_email` da Service Account como **Editor**.

## Comandos principais

- `!help` / `!ajuda`
- `!ping`
- `!status` / `!leilao status`
- `!diag` *(ADM: mostra chatId e infos úteis)*
- `!config` *(ADM: resumo do .env carregado)*

### Leilão manual (ADM)
- `!leilao iniciar <id> <tempo>`

### Sequência automática (ADM)
- `!leilao auto iniciar <idIni> a <idFim> <tempo>`
- `!leilao espec <id1> <id2> ... <tempo>`
- `!leilao auto setduracao <tempo>`
- `!leilao auto goto <posição>`

## Deploy em VPS (PM2)

Veja `docs/DEPLOY_VPS.md`.

## Multi-cliente (recomendação)

No início, para reduzir risco operacional:

- **1 cliente = 1 pasta + 1 instância do PM2**
- Cada pasta tem `.env`, `auth_info/` e `state.json` próprios.

Exemplo:
- `/opt/bot-leilao/clienteA`
- `/opt/bot-leilao/clienteB`

Use `ecosystem.config.js` como referência.

## Testes

```bash
npm test
npm run check
```
