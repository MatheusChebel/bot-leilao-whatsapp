# 🃏 Bot de Leilão para WhatsApp

Bot que automatiza leilões de cartas Pokémon TCG e itens colecionáveis em grupos de WhatsApp. Foi criado para o grupo de vendas de um amigo (projeto BOT-TCG-ZERAORA) e substitui o leilão manual por um processo automático, organizado e auditável.

## ✨ Funcionalidades

- **Leilão manual:** um produto por vez, com duração definida no comando
- **Sequência automática:** leiloa uma faixa de produtos (ex.: do 1 ao 30) ou uma lista escolhida, um após o outro
- **Controle em tempo real:** pausar, despausar, cancelar, pular item e mudar a duração no meio da sequência
- **Catálogo no Google Sheets:** os produtos vêm de uma planilha, e vendas e eventos são registrados em abas de log
- **Permissões:** só administradores controlam os leilões; o bot pode ficar restrito a grupos autorizados
- **Recuperação após reinício:** o estado fica salvo em disco e o leilão pode ser retomado de onde parou
- **Diagnóstico:** comandos de status, ping, diagnóstico e resumo de configuração
- **Multi-cliente:** cada cliente roda em uma pasta própria, com sua planilha, sessão do WhatsApp e estado

## 💬 Comandos principais

| Comando | O que faz |
|---|---|
| `!leilao iniciar <id> <tempo>` | Leiloa um produto (ex.: `!leilao iniciar 12 30m`) |
| `!leilao auto iniciar <id_ini> a <id_fim> <tempo>` | Leiloa uma faixa de produtos em sequência |
| `!leilao espec <id1> <id2> ... <tempo>` | Leiloa uma lista específica de produtos |
| `!leilao pausar` / `despausar` / `cancelar` / `pular` | Controla o leilão em andamento |
| `!leilao auto setduracao <tempo>` | Muda a duração dos próximos itens |
| `!leilao auto goto <posicao>` | Pula para uma posição da sequência |
| `!retomar` | Retoma o leilão depois de um reinício |
| `!status` / `!marcar` / `!help` | Status, aviso ao grupo e lista de comandos |

Tempos aceitos: `30s`, `15m`, `1h`. A lista completa aparece com `!help` no grupo.

## 🛠️ Tecnologias

| Camada | Stack |
|---|---|
| Runtime | Node.js 20 |
| WhatsApp | [Baileys](https://github.com/WhiskeySockets/Baileys) (login por QR Code ou código de pareamento) |
| Dados | Google Sheets API (`googleapis`, conta de serviço) |
| Configuração | dotenv (`.env`) |
| Deploy | VPS Ubuntu + PM2 |
| Qualidade | Testes automatizados (`npm test`) e logs estruturados |

## 🚀 Como rodar

```bash
git clone https://github.com/MatheusChebel/bot-leilao-whatsapp.git
cd bot-leilao-whatsapp
npm ci
cp .env.example .env   # preencha SHEET_ID, credenciais e grupos permitidos
npm start              # escaneie o QR Code com o WhatsApp do bot
```

O guia de produção com PM2 está em [`docs/DEPLOY_VPS.md`](docs/DEPLOY_VPS.md).

## 🤖 Desenvolvimento com IA

O projeto foi desenvolvido com apoio de LLMs (Claude e ChatGPT). Eu defini o problema e as regras do leilão, conduzi a IA com prompts, testei cada funcionalidade no grupo real, depurei os erros e cuidei da integração com o WhatsApp, o Google Sheets e o servidor. A IA acelerou a escrita do código; a lógica, os testes e as decisões ficaram comigo.

## 👤 Autor

Matheus Chebel · [LinkedIn](https://www.linkedin.com/in/matheus-chebel) · [GitHub](https://github.com/MatheusChebel)
