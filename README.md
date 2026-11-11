# 🃏 Bot de Leilão para WhatsApp

Bot que automatiza leilões de cartas Pokémon TCG e itens colecionáveis em grupos de WhatsApp. Criado para o grupo de vendas de um amigo (projeto BOT-TCG-ZERAORA), substituindo o leilão manual por um processo automático, organizado e seguro.

## Funcionalidades

- Leilões únicos ou programados, com vários itens rodando ao mesmo tempo
- Agenda diária de leilões
- Catálogo de produtos lido de uma planilha usada como base de dados
- Controle de lances, vencedor e estoque
- Comandos no chat com permissões: só administradores iniciam e gerenciam leilões
- Tratamento de erros e regras de segurança para pagamento e controle de produto

## Como funciona

1. O bot roda em um servidor ligado a um número do WhatsApp Business.
2. Esse número é adicionado ao grupo de vendas.
3. O administrador manda um comando com o produto, e o bot busca os dados na planilha.
4. O bot abre o leilão, recebe os lances no grupo e anuncia o vencedor ao final.

## Tecnologias

- JavaScript [+ Node.js e a biblioteca de WhatsApp usada, ex.: whatsapp-web.js / Baileys]
- Planilha Excel como base de dados
- Servidor [nome/serviço de hospedagem]

## Desenvolvimento com IA

Este projeto foi desenvolvido com apoio de LLMs (Claude e ChatGPT). Eu defini o problema e as regras do leilão, conduzi a IA com prompts, testei cada funcionalidade no grupo real, depurei os erros e fiz as integrações. A IA acelerou a escrita do código, e a lógica, os testes e as decisões ficaram comigo.

## Autor

Matheus Chebel — [LinkedIn](https://www.linkedin.com/in/matheus-chebel)
