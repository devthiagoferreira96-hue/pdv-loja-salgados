# 🥟 PDV Loja de Salgados — sistema de vendas desktop

Ponto de venda para uma loja pequena de salgados (fritos e assados) e produtos orientais. Substitui o caderno de pedidos e vendas, com telas simples e botões grandes para quem atende no balcão. Funciona **offline**, com o banco no próprio computador.

> Projeto de portfólio. A loja configurada é fictícia.

## Stack

| Camada | Tecnologia |
|---|---|
| App desktop | **Electron** (processo principal em CommonJS) |
| Interface | **React 19** + **Vite** |
| Banco | **SQLite** via sql.js (WebAssembly, sem módulo nativo), salvo a cada transação com arquivo temporário + rename |
| Instalador | electron-builder (Windows) |

## Funcionalidades

- **Vender**: carrinho, várias formas de pagamento na mesma venda (dinheiro, Pix, cartão, fiado), troco e cupom impresso.
- **Produtos e estoque**: cadastro, entradas, ajustes e alerta de estoque baixo; venda sem estoque é permitida e aparece para ajuste.
- **Caixa**: abertura, sangria, suprimento e fechamento com conferência.
- **Fiado**: clientes, compras, pagamentos e saldo (negativo = crédito do cliente).
- **Relatórios e backup**: planilha Excel de vendas e backup do banco.
- **Senha do gerente** (scrypt + sal) para cancelar venda, fechar caixa e mudar configurações.
- Impressão direta na impressora configurada, ou pela janela do Windows; erro de impressão nunca desfaz a venda.

## Decisões técnicas

- **Dinheiro sempre em centavos (inteiro)**, no banco e na API; a conversão é só na tela.
- **O preço da venda vem do banco**, nunca da interface.
- Todas as regras ficam em `electron/servicos.cjs`, expostas à interface por um único canal IPC (`"modulo.metodo"` → `{ ok, dados | erro }`).
- Migrações versionadas por `PRAGMA user_version`; uma única instância do app para não sobrescrever o banco.
- Design system próprio ("Âmbar"), com tokens em CSS, fontes embutidas e ícones lucide.

## Como rodar

```bash
npm install
npm run dev      # Vite + Electron com recarga
npm run teste    # testa as regras de negócio com banco em memória
npm run dist     # gera o instalador Windows em release/
```
