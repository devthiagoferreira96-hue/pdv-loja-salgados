// Camada de banco de dados: SQLite via sql.js (WebAssembly, sem módulo nativo).
// O banco fica em memória e é gravado no arquivo após cada transação.
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

// Cada item é uma migração. Nunca altere uma migração já publicada: adicione outra no fim.
const MIGRACOES = [
  `
  CREATE TABLE categorias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL UNIQUE,
    ordem INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO categorias (nome, ordem) VALUES
    ('Salgados fritos', 1),
    ('Salgados assados', 2),
    ('Miojos e lámens', 3),
    ('Bebidas', 4),
    ('Doces', 5),
    ('Outros orientais', 6);

  CREATE TABLE produtos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    categoria_id INTEGER REFERENCES categorias(id),
    preco INTEGER NOT NULL DEFAULT 0,          -- centavos
    custo INTEGER NOT NULL DEFAULT 0,          -- centavos
    codigo_barras TEXT,
    controla_estoque INTEGER NOT NULL DEFAULT 1,
    estoque INTEGER NOT NULL DEFAULT 0,
    estoque_minimo INTEGER NOT NULL DEFAULT 0,
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL,
    atualizado_em TEXT
  );
  CREATE UNIQUE INDEX ux_produtos_codigo ON produtos(codigo_barras)
    WHERE codigo_barras IS NOT NULL AND codigo_barras <> '';

  CREATE TABLE clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    telefone TEXT,
    observacao TEXT,
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL
  );

  CREATE TABLE caixas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL CHECK (status IN ('aberto', 'fechado')),
    valor_inicial INTEGER NOT NULL DEFAULT 0,
    valor_esperado INTEGER,
    valor_contado INTEGER,
    observacao TEXT,
    aberto_em TEXT NOT NULL,
    fechado_em TEXT
  );

  CREATE TABLE caixa_movimentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caixa_id INTEGER NOT NULL REFERENCES caixas(id),
    tipo TEXT NOT NULL CHECK (tipo IN ('sangria', 'suprimento', 'recebimento_fiado')),
    forma_pagamento TEXT NOT NULL DEFAULT 'dinheiro',
    valor INTEGER NOT NULL,
    descricao TEXT,
    cliente_id INTEGER REFERENCES clientes(id),
    criado_em TEXT NOT NULL
  );

  CREATE TABLE vendas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caixa_id INTEGER NOT NULL REFERENCES caixas(id),
    cliente_id INTEGER REFERENCES clientes(id),
    subtotal INTEGER NOT NULL,
    desconto INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL,
    forma_pagamento TEXT NOT NULL,
    valor_recebido INTEGER,
    troco INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'concluida' CHECK (status IN ('concluida', 'cancelada')),
    motivo_cancelamento TEXT,
    criado_em TEXT NOT NULL,
    cancelada_em TEXT
  );
  CREATE INDEX ix_vendas_criado ON vendas(criado_em);
  CREATE INDEX ix_vendas_caixa ON vendas(caixa_id);

  CREATE TABLE venda_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venda_id INTEGER NOT NULL REFERENCES vendas(id),
    produto_id INTEGER REFERENCES produtos(id),
    nome_produto TEXT NOT NULL,
    quantidade INTEGER NOT NULL,
    preco_unitario INTEGER NOT NULL,
    custo_unitario INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL
  );
  CREATE INDEX ix_venda_itens_venda ON venda_itens(venda_id);

  CREATE TABLE movimentos_estoque (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'perda', 'ajuste', 'venda', 'estorno')),
    quantidade INTEGER NOT NULL,               -- com sinal: + entra, - sai
    estoque_apos INTEGER NOT NULL,
    observacao TEXT,
    venda_id INTEGER REFERENCES vendas(id),
    criado_em TEXT NOT NULL
  );
  CREATE INDEX ix_mov_estoque_produto ON movimentos_estoque(produto_id);

  CREATE TABLE fiado_lancamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id),
    tipo TEXT NOT NULL CHECK (tipo IN ('compra', 'pagamento', 'estorno')),
    valor INTEGER NOT NULL,
    venda_id INTEGER REFERENCES vendas(id),
    descricao TEXT,
    criado_em TEXT NOT NULL
  );
  CREATE INDEX ix_fiado_cliente ON fiado_lancamentos(cliente_id);
  `,

  // v2: configurações da loja e pagamento dividido
  `
  CREATE TABLE config (
    chave TEXT PRIMARY KEY,
    valor TEXT
  );
  INSERT INTO config (chave, valor) VALUES ('nome_loja', 'Minha Loja'), ('papel', '80'), ('imprimir_auto', '0');

  CREATE TABLE venda_pagamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venda_id INTEGER NOT NULL REFERENCES vendas(id),
    forma TEXT NOT NULL CHECK (forma IN ('dinheiro', 'pix', 'debito', 'credito', 'fiado')),
    valor INTEGER NOT NULL
  );
  CREATE INDEX ix_venda_pagamentos_venda ON venda_pagamentos(venda_id);
  -- vendas antigas: uma forma só, valor = total
  INSERT INTO venda_pagamentos (venda_id, forma, valor) SELECT id, forma_pagamento, total FROM vendas;
  `,
];

let db = null;
let arquivo = null;
let profundidade = 0;

function normalizar(params = []) {
  return params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
}

function configurar() {
  db.run('PRAGMA foreign_keys = ON;');
}

async function abrir(caminho) {
  const SQL = await initSqlJs({
    locateFile: (f) => path.join(path.dirname(require.resolve('sql.js')), f),
  });
  arquivo = caminho || null;
  db = arquivo && fs.existsSync(arquivo) ? new SQL.Database(fs.readFileSync(arquivo)) : new SQL.Database();
  configurar();
  migrar();
  salvar();
}

function migrar() {
  const versao = get('PRAGMA user_version').user_version;
  for (let i = versao; i < MIGRACOES.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRACOES[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

// Grava em arquivo temporário e renomeia, para não corromper o banco se o PC desligar no meio.
function salvar() {
  if (!arquivo) return;
  const dados = db.export();
  configurar(); // export() reabre o banco e zera os PRAGMAs
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const tmp = `${arquivo}.tmp`;
  fs.writeFileSync(tmp, Buffer.from(dados));
  fs.renameSync(tmp, arquivo);
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(normalizar(params));
    const linhas = [];
    while (stmt.step()) linhas.push(stmt.getAsObject());
    return linhas;
  } finally {
    stmt.free();
  }
}

function get(sql, params = []) {
  return all(sql, params)[0];
}

function run(sql, params = []) {
  db.run(sql, normalizar(params));
  const alteradas = db.getRowsModified();
  return { id: get('SELECT last_insert_rowid() AS id').id, alteradas };
}

// Executa fn numa transação; grava o arquivo só se tudo der certo.
function tx(fn) {
  if (profundidade > 0) return fn();
  profundidade++;
  db.run('BEGIN');
  try {
    const r = fn();
    db.run('COMMIT');
    salvar();
    return r;
  } catch (e) {
    try { db.run('ROLLBACK'); } catch { /* já desfeita */ }
    throw e;
  } finally {
    profundidade--;
  }
}

function caminhoArquivo() {
  return arquivo;
}

module.exports = { abrir, all, get, run, tx, salvar, caminhoArquivo };
