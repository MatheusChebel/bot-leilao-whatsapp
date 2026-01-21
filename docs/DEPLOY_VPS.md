# Deploy em VPS (Ubuntu + PM2)

Este guia assume um Droplet/Debian/Ubuntu e acesso via SSH.

## 1) Dependências

```bash
apt update -y
apt install -y git curl
```

### Node.js 20 (via NVM)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm alias default 20
node -v
```

## 2) Clonar o projeto

```bash
cd /root
git clone <SEU_REPO_GITHUB> bot-leilao
cd bot-leilao
npm ci
```

## 3) Configurar .env

```bash
cp .env.example .env
nano .env
```

Preencha:
- `SHEET_ID`
- `GOOGLE_APPLICATION_CREDENTIALS` (recomendado: caminho absoluto)
- `ALLOWED_GROUPS` (opcional, mas recomendado)
- `WA_LOGIN_MODE` (qr/pairing)

## 4) Credenciais Google

1. Faça upload do `credentials.json` para a VPS.
2. Dê permissão restrita:

```bash
chmod 600 /caminho/credentials.json
```

3. Compartilhe a planilha com `client_email` (Editor).

## 5) Primeiro login no WhatsApp

Remova auth antigo e rode manualmente para logar:

```bash
cd /root/bot-leilao
rm -rf auth_info
node index.js
```

- Se `WA_LOGIN_MODE=qr`: escaneie o QR no terminal.
- Se `WA_LOGIN_MODE=pairing`: use o código em *Dispositivos conectados* → *Conectar com número*.

Depois pare com `CTRL+C`.

## 6) Rodar com PM2

```bash
npm i -g pm2
pm2 start index.js --name bot-leilao --time
pm2 logs bot-leilao --lines 200
pm2 save
pm2 startup systemd -u root --hp /root
```

Execute o comando que o `pm2 startup` imprimir.

## 7) Atualizar código na VPS

```bash
cd /root/bot-leilao
git pull
npm ci
pm2 restart bot-leilao
pm2 logs bot-leilao --lines 200
```

## Troubleshooting

- Se pedir login de novo: apague `auth_info/` e refaça o login.
- Se o bot não responde no grupo: verifique `ALLOWED_GROUPS` e use `!diag` (ADM).
