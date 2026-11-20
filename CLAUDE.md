# LojaSalgados — PDV desktop

Sistema de vendas para uma loja pequena de salgados (fritos/assados) e produtos orientais (lámens, bebidas, doces).
Substitui o caderno onde anotam pedidos e vendas. Público: atendente no balcão, pouco familiarizado com sistemas — telas simples, botões grandes, textos em português.

## Stack
- Electron (processo principal em `electron/`, CommonJS `.cjs`) + React 19 + Vite (tela em `src/`).
- Banco: SQLite via **sql.js** (WebAssembly, sem módulo nativo). Fica em memória e é gravado em
  `%APPDATA%/<app>/loja.db` a cada transação (`db.tx`), via arquivo temporário + rename.
- Uma única instância do app (`requestSingleInstanceLock`) para não sobrescrever o banco.

## Arquitetura
- `electron/db.cjs`: abrir/migrar/gravar, helpers `all/get/run/tx`. Migrações em `MIGRACOES` (array, controlado por `PRAGMA user_version`) — **nunca editar uma migração existente, só adicionar no fim**.
- `electron/servicos.cjs`: todas as regras de negócio (produtos, estoque, caixa, clientes/fiado, vendas, relatórios). Erros para o usuário usam `erro(msg)` (`amigavel = true`).
- `electron/main.cjs`: expõe cada função de `servicos` como `"modulo.metodo"` num único canal IPC `api`, retorna `{ ok, dados | erro }`.
- `src/util.js`: `api('modulo.metodo', args)` no React.

## Regras importantes
- **Dinheiro sempre em centavos (inteiro)**, no banco e na API. Conversão só na tela (`paraCentavos`, `moeda`).
- Preços da venda vêm do banco, nunca do renderer.
- Venda exige caixa aberto. Venda com produto sem estoque é permitida (estoque fica negativo e aparece para ajuste).
- Cancelamento só para vendas do caixa aberto; devolve estoque pelos `movimentos_estoque` da venda e estorna o fiado.
- Saldo do fiado = compras − pagamentos − estornos (negativo = crédito do cliente).
- Pagamentos ficam em `venda_pagamentos` (uma linha por forma). `vendas.forma_pagamento` = a forma ou `'misto'`.
  Relatórios e caixa somam por `venda_pagamentos`, nunca por `vendas.forma_pagamento`. `valor_recebido`/`troco` referem-se só à parte em dinheiro.
- Configurações em `config` (chave/valor). Senha do gerente: scrypt + sal (`senha_hash`, `senha_sal`), nunca sai do backend.
  Exigida (`exigirSenha`) em: cancelar venda, fechar caixa, salvar configurações. Sem senha cadastrada, libera.
  Na tela, use `useSenha()` (devolve `''` se não há senha, `null` se o usuário desistiu).
- Impressão: `electron/impressao.cjs` só gera HTML (testável); `main.cjs` imprime numa janela oculta. Com impressora
  configurada imprime direto (silencioso); sem ela, abre a janela de impressão do Windows. Erro de impressão nunca desfaz a venda.
- Não usar `window.prompt/confirm/alert` (não funcionam bem no Electron) — usar `Modal`.

## Design system ("Âmbar" — identidade própria, não copiar concorrentes)
- Tokens no topo de `src/estilo.css`: verde-petróleo (`--petroleo-*`, menu e botões principais) + âmbar (`--ambar-*`, destaque/item ativo/preços), neutros levemente quentes.
- Use os tokens de papel (`--primaria`, `--destaque`, `--lateral`, `--raio`…) nos componentes; nunca cor fixa.
- Fontes embutidas via `@fontsource` (Manrope títulos 700/800, Inter texto 400–700) — o app roda offline.
- Ícones: `lucide-react` com `className="icone"`. Sem emojis na interface.
- Cantos: 12px (cards/painéis), 8px (botões/campos), 16px (modais).

## Comandos
- `npm run dev` — Vite + Electron com recarga.
- `npm run teste` — testa as regras de negócio com banco em memória (sem Electron).
- `npm start` — build + abre como produção.
- `npm run dist` — gera instalador Windows em `release/`.
