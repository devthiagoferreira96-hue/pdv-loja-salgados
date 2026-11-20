// Regras de negócio. Valores em dinheiro são sempre inteiros em centavos.
const crypto = require('crypto');
const { all, get, run, tx } = require('./db.cjs');

const FORMAS = ['dinheiro', 'pix', 'debito', 'credito', 'fiado'];
const reais = (c) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;

// ---------- utilitários ----------
function agora() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
const hoje = () => agora().slice(0, 10);

function erro(msg) {
  const e = new Error(msg);
  e.amigavel = true;
  return e;
}

function inteiro(v, nome, { min = 0 } = {}) {
  const n = Number(v);
  if (v === null || v === '' || !Number.isInteger(n) || n < min) throw erro(`${nome} inválido.`);
  return n;
}

const texto = (v) => (v ?? '').toString().trim();

function data(v, nome) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) throw erro(`${nome} inválida.`);
  return v;
}

// ---------- configurações e senha de gerente ----------
const CHAVES_CONFIG = [
  'nome_loja', 'endereco', 'telefone', 'documento', 'mensagem_cupom', 'logo',
  'impressora', 'papel', 'imprimir_auto',
];
const LOGO_MAX = 1_500_000; // caracteres do data URL (~1 MB)

function lerConfig() {
  return Object.fromEntries(all('SELECT chave, valor FROM config').map((r) => [r.chave, r.valor]));
}
function gravarConfig(chave, valor) {
  run('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor', [chave, valor]);
}
const hashSenha = (senha, sal) => crypto.scryptSync(String(senha), sal, 32).toString('hex');

// Lança erro se existe senha cadastrada e a informada não confere. Sem senha cadastrada, libera.
function exigirSenha(senha) {
  const c = lerConfig();
  if (!c.senha_hash) return;
  if (!senha) throw erro('Informe a senha do gerente.');
  const a = Buffer.from(hashSenha(senha, c.senha_sal), 'hex');
  const b = Buffer.from(c.senha_hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw erro('Senha incorreta.');
}

const config = {
  obter() {
    const c = lerConfig();
    const pub = Object.fromEntries(CHAVES_CONFIG.map((k) => [k, c[k] ?? '']));
    pub.imprimir_auto = c.imprimir_auto === '1';
    pub.papel = c.papel === '58' ? '58' : '80';
    pub.temSenha = !!c.senha_hash;
    return pub;
  },

  salvar({ dados = {}, senha } = {}) {
    return tx(() => {
      exigirSenha(senha);
      for (const k of CHAVES_CONFIG) {
        if (!(k in dados)) continue;
        let v = dados[k];
        if (k === 'imprimir_auto') v = v ? '1' : '0';
        else if (k === 'logo') {
          v = v || '';
          if (v && (!/^data:image\/(png|jpeg|webp|gif);base64,/.test(v) || v.length > LOGO_MAX)) throw erro('Logo inválida ou grande demais.');
        } else v = texto(v);
        if (k === 'nome_loja' && !v) throw erro('Informe o nome da loja.');
        if (k === 'papel' && !['58', '80'].includes(v)) throw erro('Largura de papel inválida.');
        gravarConfig(k, v);
      }
      return config.obter();
    });
  },

  // novaSenha vazia remove a senha.
  definirSenha({ senhaAtual, novaSenha } = {}) {
    return tx(() => {
      exigirSenha(senhaAtual);
      const nova = String(novaSenha ?? '');
      if (!nova) {
        run("DELETE FROM config WHERE chave IN ('senha_hash', 'senha_sal')");
      } else {
        if (nova.length < 4) throw erro('A senha precisa ter pelo menos 4 caracteres.');
        const sal = crypto.randomBytes(16).toString('hex');
        gravarConfig('senha_sal', sal);
        gravarConfig('senha_hash', hashSenha(nova, sal));
      }
      return config.obter();
    });
  },

  verificarSenha(senha) {
    exigirSenha(senha);
    return true;
  },
};

// ---------- categorias ----------
const categorias = {
  listar() {
    return all('SELECT * FROM categorias ORDER BY ordem, nome');
  },
};

// ---------- produtos ----------
const produtos = {
  listar({ busca = '', categoriaId = null, incluirInativos = false } = {}) {
    const where = [];
    const params = [];
    if (!incluirInativos) where.push('p.ativo = 1');
    if (categoriaId) { where.push('p.categoria_id = ?'); params.push(categoriaId); }
    if (busca) { where.push('(p.nome LIKE ? OR p.codigo_barras = ?)'); params.push(`%${busca}%`, busca); }
    return all(
      `SELECT p.*, c.nome AS categoria
         FROM produtos p LEFT JOIN categorias c ON c.id = p.categoria_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY c.ordem, p.nome`,
      params,
    );
  },

  salvar(p = {}) {
    return tx(() => {
      const nome = texto(p.nome);
      if (!nome) throw erro('Informe o nome do produto.');
      const preco = inteiro(p.preco, 'Preço');
      const custo = inteiro(p.custo ?? 0, 'Custo');
      const categoriaId = p.categoria_id ? inteiro(p.categoria_id, 'Categoria', { min: 1 }) : null;
      const codigo = texto(p.codigo_barras) || null;
      const controla = p.controla_estoque ? 1 : 0;
      const minimo = inteiro(p.estoque_minimo ?? 0, 'Estoque mínimo');

      if (codigo) {
        const outro = get('SELECT id, nome FROM produtos WHERE codigo_barras = ? AND id <> ?', [codigo, p.id || 0]);
        if (outro) throw erro(`Código de barras já usado em "${outro.nome}".`);
      }

      if (p.id) {
        const r = run(
          `UPDATE produtos SET nome=?, categoria_id=?, preco=?, custo=?, codigo_barras=?,
                  controla_estoque=?, estoque_minimo=?, atualizado_em=? WHERE id=?`,
          [nome, categoriaId, preco, custo, codigo, controla, minimo, agora(), p.id],
        );
        if (!r.alteradas) throw erro('Produto não encontrado.');
        return get('SELECT * FROM produtos WHERE id = ?', [p.id]);
      }

      const inicial = controla ? inteiro(p.estoque ?? 0, 'Estoque inicial') : 0;
      const { id } = run(
        `INSERT INTO produtos (nome, categoria_id, preco, custo, codigo_barras, controla_estoque,
                               estoque, estoque_minimo, criado_em)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [nome, categoriaId, preco, custo, codigo, controla, inicial, minimo, agora()],
      );
      if (inicial > 0) {
        run(
          `INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, estoque_apos, observacao, criado_em)
           VALUES (?, 'entrada', ?, ?, 'Estoque inicial', ?)`,
          [id, inicial, inicial, agora()],
        );
      }
      return get('SELECT * FROM produtos WHERE id = ?', [id]);
    });
  },

  alternarAtivo(id) {
    return tx(() => {
      const r = run('UPDATE produtos SET ativo = 1 - ativo, atualizado_em = ? WHERE id = ?', [agora(), id]);
      if (!r.alteradas) throw erro('Produto não encontrado.');
      return get('SELECT * FROM produtos WHERE id = ?', [id]);
    });
  },

  carregarExemplos() {
    return tx(() => {
      if (get('SELECT COUNT(*) AS n FROM produtos').n > 0) throw erro('Já existem produtos cadastrados.');
      const cat = Object.fromEntries(categorias.listar().map((c) => [c.nome, c.id]));
      const exemplos = [
        ['Coxinha de frango', 'Salgados fritos', 700, 250, 30, 10],
        ['Pastel de carne', 'Salgados fritos', 800, 300, 20, 8],
        ['Pastel de queijo', 'Salgados fritos', 800, 280, 20, 8],
        ['Kibe', 'Salgados fritos', 700, 250, 15, 5],
        ['Enroladinho de salsicha', 'Salgados fritos', 600, 200, 15, 5],
        ['Esfiha de carne', 'Salgados assados', 650, 220, 20, 8],
        ['Esfiha de frango', 'Salgados assados', 650, 220, 20, 8],
        ['Pão de queijo', 'Salgados assados', 400, 120, 30, 10],
        ['Croissant presunto e queijo', 'Salgados assados', 900, 350, 10, 4],
        ['Lámen instantâneo sabor galinha', 'Miojos e lámens', 350, 180, 40, 10],
        ['Lámen coreano picante', 'Miojos e lámens', 1200, 700, 24, 6],
        ['Udon instantâneo', 'Miojos e lámens', 1500, 900, 12, 4],
        ['Refrigerante lata 350ml', 'Bebidas', 600, 300, 48, 12],
        ['Água mineral 500ml', 'Bebidas', 350, 120, 24, 12],
        ['Chá verde gelado', 'Bebidas', 900, 450, 12, 6],
        ['Refrigerante japonês de bolinha', 'Bebidas', 1400, 800, 12, 4],
        ['Mochi', 'Doces', 800, 400, 20, 6],
        ['Biscoito palito de chocolate', 'Doces', 1000, 550, 15, 5],
        ['Bala de leite oriental', 'Doces', 700, 350, 15, 5],
        ['Alga temperada (snack)', 'Outros orientais', 900, 450, 15, 5],
        ['Molho shoyu 150ml', 'Outros orientais', 1100, 600, 8, 3],
      ];
      for (const [nome, categoria, preco, custo, estoque, minimo] of exemplos) {
        produtos.salvar({
          nome, categoria_id: cat[categoria], preco, custo, estoque, estoque_minimo: minimo, controla_estoque: true,
        });
      }
      return exemplos.length;
    });
  },
};

// ---------- estoque ----------
const estoque = {
  movimentar({ produtoId, tipo, quantidade, observacao = '' } = {}) {
    return tx(() => {
      const p = get('SELECT * FROM produtos WHERE id = ?', [produtoId]);
      if (!p) throw erro('Produto não encontrado.');
      if (!p.controla_estoque) throw erro('Este produto não controla estoque.');
      let delta;
      if (tipo === 'entrada') delta = inteiro(quantidade, 'Quantidade', { min: 1 });
      else if (tipo === 'perda') delta = -inteiro(quantidade, 'Quantidade', { min: 1 });
      else if (tipo === 'ajuste') {
        delta = inteiro(quantidade, 'Quantidade contada') - p.estoque;
        if (delta === 0) throw erro('O estoque já está com essa quantidade.');
      } else throw erro('Tipo de movimento inválido.');

      const novo = p.estoque + delta;
      run('UPDATE produtos SET estoque = ?, atualizado_em = ? WHERE id = ?', [novo, agora(), p.id]);
      run(
        `INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, estoque_apos, observacao, criado_em)
         VALUES (?,?,?,?,?,?)`,
        [p.id, tipo, delta, novo, texto(observacao) || null, agora()],
      );
      return get('SELECT * FROM produtos WHERE id = ?', [p.id]);
    });
  },

  movimentos({ produtoId = null, limite = 100 } = {}) {
    return all(
      `SELECT m.*, p.nome AS produto FROM movimentos_estoque m JOIN produtos p ON p.id = m.produto_id
        ${produtoId ? 'WHERE m.produto_id = ?' : ''} ORDER BY m.id DESC LIMIT ?`,
      produtoId ? [produtoId, limite] : [limite],
    );
  },

  baixo() {
    return all(
      `SELECT id, nome, estoque, estoque_minimo FROM produtos
        WHERE ativo = 1 AND controla_estoque = 1 AND estoque <= estoque_minimo
        ORDER BY estoque - estoque_minimo, nome`,
    );
  },
};

// ---------- caixa ----------
const caixaAberto = () => get("SELECT * FROM caixas WHERE status = 'aberto' ORDER BY id DESC LIMIT 1");

function resumoCaixa(caixaId) {
  const c = get('SELECT * FROM caixas WHERE id = ?', [caixaId]);
  if (!c) throw erro('Caixa não encontrado.');
  const porForma = Object.fromEntries(FORMAS.map((f) => [f, 0]));
  for (const r of all(
    `SELECT p.forma AS f, SUM(p.valor) AS t FROM venda_pagamentos p JOIN vendas v ON v.id = p.venda_id
      WHERE v.caixa_id = ? AND v.status = 'concluida' GROUP BY p.forma`, [caixaId],
  )) porForma[r.f] = r.t;
  const v = get(
    `SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS t FROM vendas WHERE caixa_id = ? AND status = 'concluida'`,
    [caixaId],
  );
  const movimentos = all('SELECT * FROM caixa_movimentos WHERE caixa_id = ? ORDER BY id DESC', [caixaId]);
  let suprimentos = 0;
  let sangrias = 0;
  const recebimentosFiado = { dinheiro: 0, pix: 0, debito: 0, credito: 0 };
  for (const m of movimentos) {
    if (m.tipo === 'suprimento') suprimentos += m.valor;
    else if (m.tipo === 'sangria') sangrias += m.valor;
    else recebimentosFiado[m.forma_pagamento] = (recebimentosFiado[m.forma_pagamento] || 0) + m.valor;
  }
  const dinheiroEsperado = c.valor_inicial + porForma.dinheiro + suprimentos - sangrias + recebimentosFiado.dinheiro;
  return {
    caixa: c,
    vendas: { quantidade: v.n, total: v.t, porForma },
    suprimentos, sangrias, recebimentosFiado, dinheiroEsperado, movimentos,
  };
}

const caixa = {
  atual() {
    const c = caixaAberto();
    return c ? resumoCaixa(c.id) : null;
  },

  abrir({ valorInicial = 0 } = {}) {
    return tx(() => {
      if (caixaAberto()) throw erro('Já existe um caixa aberto.');
      const { id } = run(
        "INSERT INTO caixas (status, valor_inicial, aberto_em) VALUES ('aberto', ?, ?)",
        [inteiro(valorInicial, 'Valor inicial'), agora()],
      );
      return resumoCaixa(id);
    });
  },

  movimentar({ tipo, valor, descricao = '' } = {}) {
    return tx(() => {
      const c = caixaAberto();
      if (!c) throw erro('Nenhum caixa aberto.');
      if (!['sangria', 'suprimento'].includes(tipo)) throw erro('Tipo de movimento inválido.');
      const v = inteiro(valor, 'Valor', { min: 1 });
      if (tipo === 'sangria' && v > resumoCaixa(c.id).dinheiroEsperado) {
        throw erro('Sangria maior que o dinheiro em caixa.');
      }
      run(
        `INSERT INTO caixa_movimentos (caixa_id, tipo, forma_pagamento, valor, descricao, criado_em)
         VALUES (?, ?, 'dinheiro', ?, ?, ?)`,
        [c.id, tipo, v, texto(descricao) || null, agora()],
      );
      return resumoCaixa(c.id);
    });
  },

  fechar({ valorContado, observacao = '', senha } = {}) {
    return tx(() => {
      const c = caixaAberto();
      if (!c) throw erro('Nenhum caixa aberto.');
      exigirSenha(senha);
      const contado = inteiro(valorContado, 'Valor contado');
      const r = resumoCaixa(c.id);
      run(
        `UPDATE caixas SET status = 'fechado', valor_esperado = ?, valor_contado = ?, observacao = ?, fechado_em = ?
          WHERE id = ?`,
        [r.dinheiroEsperado, contado, texto(observacao) || null, agora(), c.id],
      );
      return resumoCaixa(c.id);
    });
  },

  resumo(id) {
    return resumoCaixa(id);
  },

  historico({ limite = 30 } = {}) {
    return all(
      `SELECT c.*,
              (SELECT COALESCE(SUM(total), 0) FROM vendas WHERE caixa_id = c.id AND status = 'concluida') AS total_vendas,
              (SELECT COUNT(*) FROM vendas WHERE caixa_id = c.id AND status = 'concluida') AS qtd_vendas
         FROM caixas c ORDER BY c.id DESC LIMIT ?`,
      [limite],
    );
  },
};

// ---------- clientes / fiado ----------
const SALDO_SQL = `(SELECT COALESCE(SUM(CASE WHEN tipo = 'compra' THEN valor ELSE -valor END), 0)
                      FROM fiado_lancamentos WHERE cliente_id = c.id)`;

const clientes = {
  listar({ busca = '', incluirInativos = false } = {}) {
    const where = [];
    const params = [];
    if (!incluirInativos) where.push('c.ativo = 1');
    if (busca) { where.push('(c.nome LIKE ? OR c.telefone LIKE ?)'); params.push(`%${busca}%`, `%${busca}%`); }
    return all(
      `SELECT c.*, ${SALDO_SQL} AS saldo FROM clientes c
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.nome`,
      params,
    );
  },

  salvar(c = {}) {
    return tx(() => {
      const nome = texto(c.nome);
      if (!nome) throw erro('Informe o nome do cliente.');
      const dados = [nome, texto(c.telefone) || null, texto(c.observacao) || null];
      if (c.id) {
        const r = run('UPDATE clientes SET nome = ?, telefone = ?, observacao = ? WHERE id = ?', [...dados, c.id]);
        if (!r.alteradas) throw erro('Cliente não encontrado.');
        return get('SELECT * FROM clientes WHERE id = ?', [c.id]);
      }
      const { id } = run(
        'INSERT INTO clientes (nome, telefone, observacao, criado_em) VALUES (?,?,?,?)', [...dados, agora()],
      );
      return get('SELECT * FROM clientes WHERE id = ?', [id]);
    });
  },

  alternarAtivo(id) {
    return tx(() => {
      const c = get(`SELECT c.*, ${SALDO_SQL} AS saldo FROM clientes c WHERE c.id = ?`, [id]);
      if (!c) throw erro('Cliente não encontrado.');
      if (c.ativo && c.saldo > 0) throw erro('Cliente tem saldo em aberto; receba antes de desativar.');
      run('UPDATE clientes SET ativo = 1 - ativo WHERE id = ?', [id]);
      return get('SELECT * FROM clientes WHERE id = ?', [id]);
    });
  },

  extrato(id) {
    const c = get(`SELECT c.*, ${SALDO_SQL} AS saldo FROM clientes c WHERE c.id = ?`, [id]);
    if (!c) throw erro('Cliente não encontrado.');
    const lancamentos = all('SELECT * FROM fiado_lancamentos WHERE cliente_id = ? ORDER BY id DESC', [id]);
    return { cliente: c, lancamentos };
  },

  receber({ clienteId, valor, formaPagamento = 'dinheiro' } = {}) {
    return tx(() => {
      const cx = caixaAberto();
      if (!cx) throw erro('Abra o caixa para receber pagamentos.');
      if (!FORMAS.includes(formaPagamento) || formaPagamento === 'fiado') throw erro('Forma de pagamento inválida.');
      const { cliente } = clientes.extrato(clienteId);
      const v = inteiro(valor, 'Valor', { min: 1 });
      if (v > cliente.saldo) throw erro('Valor maior que o saldo devedor.');
      run(
        `INSERT INTO fiado_lancamentos (cliente_id, tipo, valor, descricao, criado_em)
         VALUES (?, 'pagamento', ?, ?, ?)`,
        [cliente.id, v, `Pagamento (${formaPagamento})`, agora()],
      );
      run(
        `INSERT INTO caixa_movimentos (caixa_id, tipo, forma_pagamento, valor, descricao, cliente_id, criado_em)
         VALUES (?, 'recebimento_fiado', ?, ?, ?, ?, ?)`,
        [cx.id, formaPagamento, v, `Fiado: ${cliente.nome}`, cliente.id, agora()],
      );
      return clientes.extrato(cliente.id);
    });
  },

  totalAReceber() {
    return get(
      "SELECT COALESCE(SUM(CASE WHEN tipo = 'compra' THEN valor ELSE -valor END), 0) AS t FROM fiado_lancamentos",
    ).t;
  },
};

// ---------- vendas ----------

// Junta formas repetidas e confere se a soma bate com o total.
function normalizarPagamentos(pagamentos, total) {
  if (!Array.isArray(pagamentos) || !pagamentos.length) throw erro('Informe a forma de pagamento.');
  const soma = {};
  for (const p of pagamentos) {
    if (!FORMAS.includes(p?.forma)) throw erro('Forma de pagamento inválida.');
    soma[p.forma] = (soma[p.forma] || 0) + inteiro(p.valor, 'Valor do pagamento');
  }
  const lista = Object.entries(soma)
    .map(([forma, valor]) => ({ forma, valor }))
    .filter((p) => p.valor > 0 || total === 0);
  if (!lista.length) throw erro('Informe a forma de pagamento.');
  const pago = lista.reduce((s, p) => s + p.valor, 0);
  if (pago !== total) {
    throw erro(`A soma dos pagamentos (${reais(pago)}) não bate com o total (${reais(total)}).`);
  }
  return total === 0 ? lista.slice(0, 1) : lista;
}

const vendas = {
  // pagamentos: [{ forma, valor }]. Para uma forma só, pode mandar apenas formaPagamento.
  // valorRecebido: quanto o cliente entregou em dinheiro (para calcular o troco).
  finalizar({ itens, desconto = 0, pagamentos = null, formaPagamento = null, valorRecebido = null, clienteId = null } = {}) {
    return tx(() => {
      const cx = caixaAberto();
      if (!cx) throw erro('Abra o caixa antes de vender.');
      if (!Array.isArray(itens) || !itens.length) throw erro('Adicione pelo menos um produto.');

      // Preços sempre vêm do banco, nunca da tela.
      const linhas = [];
      let subtotal = 0;
      for (const it of itens) {
        const q = inteiro(it.quantidade, 'Quantidade', { min: 1 });
        const p = get('SELECT * FROM produtos WHERE id = ?', [it.produtoId]);
        if (!p) throw erro('Produto não encontrado.');
        if (!p.ativo) throw erro(`"${p.nome}" está inativo.`);
        subtotal += p.preco * q;
        linhas.push({ p, q });
      }
      const desc = inteiro(desconto || 0, 'Desconto');
      if (desc > subtotal) throw erro('Desconto maior que o total.');
      const total = subtotal - desc;

      const pags = normalizarPagamentos(
        pagamentos ?? (formaPagamento ? [{ forma: formaPagamento, valor: total }] : null), total,
      );
      const parte = (forma) => pags.find((p) => p.forma === forma)?.valor ?? 0;

      let recebido = null;
      let troco = 0;
      if (pags.some((p) => p.forma === 'dinheiro')) {
        const devido = parte('dinheiro');
        recebido = valorRecebido === null || valorRecebido === '' ? devido : inteiro(valorRecebido, 'Valor recebido');
        if (recebido < devido) throw erro(`Valor recebido em dinheiro menor que ${reais(devido)}.`);
        troco = recebido - devido;
      }
      let cliente = null;
      if (pags.some((p) => p.forma === 'fiado')) {
        if (!clienteId) throw erro('Selecione o cliente para vender fiado.');
        cliente = get('SELECT * FROM clientes WHERE id = ? AND ativo = 1', [clienteId]);
        if (!cliente) throw erro('Cliente não encontrado.');
      }

      const quando = agora();
      const { id: vendaId } = run(
        `INSERT INTO vendas (caixa_id, cliente_id, subtotal, desconto, total, forma_pagamento,
                             valor_recebido, troco, criado_em)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [cx.id, cliente?.id ?? null, subtotal, desc, total, pags.length === 1 ? pags[0].forma : 'misto', recebido, troco, quando],
      );
      for (const p of pags) {
        run('INSERT INTO venda_pagamentos (venda_id, forma, valor) VALUES (?,?,?)', [vendaId, p.forma, p.valor]);
      }
      for (const { p, q } of linhas) {
        run(
          `INSERT INTO venda_itens (venda_id, produto_id, nome_produto, quantidade, preco_unitario, custo_unitario, total)
           VALUES (?,?,?,?,?,?,?)`,
          [vendaId, p.id, p.nome, q, p.preco, p.custo, p.preco * q],
        );
        if (p.controla_estoque) {
          // Vende mesmo sem estoque registrado (o estoque fica negativo e aparece para ajuste).
          const atual = get('SELECT estoque FROM produtos WHERE id = ?', [p.id]).estoque - q;
          run('UPDATE produtos SET estoque = ? WHERE id = ?', [atual, p.id]);
          run(
            `INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, estoque_apos, venda_id, criado_em)
             VALUES (?, 'venda', ?, ?, ?, ?)`,
            [p.id, -q, atual, vendaId, quando],
          );
        }
      }
      if (cliente && parte('fiado') > 0) {
        run(
          `INSERT INTO fiado_lancamentos (cliente_id, tipo, valor, venda_id, descricao, criado_em)
           VALUES (?, 'compra', ?, ?, ?, ?)`,
          [cliente.id, parte('fiado'), vendaId, `Venda #${vendaId}`, quando],
        );
      }
      return vendas.detalhe(vendaId);
    });
  },

  detalhe(id) {
    const v = get(
      `SELECT v.*, c.nome AS cliente, cx.status AS caixa_status
         FROM vendas v LEFT JOIN clientes c ON c.id = v.cliente_id JOIN caixas cx ON cx.id = v.caixa_id
        WHERE v.id = ?`, [id],
    );
    if (!v) throw erro('Venda não encontrada.');
    v.itens = all('SELECT * FROM venda_itens WHERE venda_id = ? ORDER BY id', [id]);
    v.pagamentos = all('SELECT forma, valor FROM venda_pagamentos WHERE venda_id = ? ORDER BY id', [id]);
    return v;
  },

  listar({ inicio = hoje(), fim = hoje(), limite = 500 } = {}) {
    return all(
      `SELECT v.*, c.nome AS cliente,
              (SELECT GROUP_CONCAT(quantidade || 'x ' || nome_produto, ', ') FROM venda_itens WHERE venda_id = v.id) AS resumo,
              (SELECT GROUP_CONCAT(forma, '+') FROM venda_pagamentos WHERE venda_id = v.id) AS formas
         FROM vendas v LEFT JOIN clientes c ON c.id = v.cliente_id
        WHERE v.criado_em BETWEEN ? AND ?
        ORDER BY v.id DESC LIMIT ?`,
      [`${data(inicio, 'Data inicial')} 00:00:00`, `${data(fim, 'Data final')} 23:59:59`, limite],
    );
  },

  cancelar({ id, motivo = '', senha } = {}) {
    return tx(() => {
      const v = vendas.detalhe(id);
      if (v.status !== 'concluida') throw erro('Esta venda já está cancelada.');
      if (v.caixa_status !== 'aberto') throw erro('Só é possível cancelar vendas do caixa aberto.');
      exigirSenha(senha);
      const quando = agora();
      run(
        "UPDATE vendas SET status = 'cancelada', motivo_cancelamento = ?, cancelada_em = ? WHERE id = ?",
        [texto(motivo) || null, quando, id],
      );
      // Devolve ao estoque exatamente o que a venda tirou.
      for (const m of all("SELECT * FROM movimentos_estoque WHERE venda_id = ? AND tipo = 'venda'", [id])) {
        const atual = get('SELECT estoque FROM produtos WHERE id = ?', [m.produto_id]).estoque - m.quantidade;
        run('UPDATE produtos SET estoque = ? WHERE id = ?', [atual, m.produto_id]);
        run(
          `INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, estoque_apos, observacao, venda_id, criado_em)
           VALUES (?, 'estorno', ?, ?, ?, ?, ?)`,
          [m.produto_id, -m.quantidade, atual, `Cancelamento da venda #${id}`, id, quando],
        );
      }
      const fiado = v.pagamentos.filter((p) => p.forma === 'fiado').reduce((s, p) => s + p.valor, 0);
      if (fiado > 0 && v.cliente_id) {
        run(
          `INSERT INTO fiado_lancamentos (cliente_id, tipo, valor, venda_id, descricao, criado_em)
           VALUES (?, 'estorno', ?, ?, ?, ?)`,
          [v.cliente_id, fiado, id, `Venda #${id} cancelada`, quando],
        );
      }
      return vendas.detalhe(id);
    });
  },
};

// ---------- relatórios ----------
const relatorios = {
  periodo({ inicio = hoje(), fim = hoje() } = {}) {
    const ini = `${data(inicio, 'Data inicial')} 00:00:00`;
    const fi = `${data(fim, 'Data final')} 23:59:59`;
    const filtro = "v.status = 'concluida' AND v.criado_em BETWEEN ? AND ?";
    const t = get(
      `SELECT COUNT(*) AS qtd, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(desconto), 0) AS descontos
         FROM vendas v WHERE ${filtro}`, [ini, fi],
    );
    const custo = get(
      `SELECT COALESCE(SUM(i.custo_unitario * i.quantidade), 0) AS c
         FROM venda_itens i JOIN vendas v ON v.id = i.venda_id WHERE ${filtro}`, [ini, fi],
    ).c;
    const porForma = Object.fromEntries(FORMAS.map((f) => [f, 0]));
    for (const r of all(
      `SELECT p.forma AS f, SUM(p.valor) AS t FROM venda_pagamentos p JOIN vendas v ON v.id = p.venda_id
        WHERE ${filtro} GROUP BY p.forma`, [ini, fi],
    )) porForma[r.f] = r.t;
    return {
      inicio, fim,
      quantidade: t.qtd,
      total: t.total,
      descontos: t.descontos,
      ticketMedio: t.qtd ? Math.round(t.total / t.qtd) : 0,
      lucroEstimado: t.total - custo,
      porForma,
      porDia: all(
        `SELECT substr(criado_em, 1, 10) AS dia, COUNT(*) AS qtd, SUM(total) AS total
           FROM vendas v WHERE ${filtro} GROUP BY dia ORDER BY dia`, [ini, fi],
      ),
      maisVendidos: all(
        `SELECT i.nome_produto AS nome, SUM(i.quantidade) AS qtd, SUM(i.total) AS total
           FROM venda_itens i JOIN vendas v ON v.id = i.venda_id WHERE ${filtro}
          GROUP BY i.produto_id, i.nome_produto ORDER BY qtd DESC, total DESC LIMIT 10`, [ini, fi],
      ),
    };
  },

  // Todos os dados para o backup em Excel/PDF. `ano` define o recorte do PDF.
  backup({ ano = Number(hoje().slice(0, 4)) } = {}) {
    const anoTxt = String(inteiro(ano, 'Ano', { min: 2000 }));
    const anos = all('SELECT DISTINCT substr(criado_em, 1, 4) AS a FROM vendas ORDER BY a').map((r) => r.a);
    if (!anos.includes(anoTxt)) anos.push(anoTxt);
    anos.sort();
    const CAT = "COALESCE(c.nome, 'Sem categoria')";
    return {
      ano: anoTxt,
      anos,
      geradoEm: agora(),
      categorias: categorias.listar(),
      mensal: all(
        `SELECT substr(v.criado_em, 1, 4) AS ano, CAST(substr(v.criado_em, 6, 2) AS INTEGER) AS mes, p.forma, SUM(p.valor) AS total
           FROM venda_pagamentos p JOIN vendas v ON v.id = p.venda_id
          WHERE v.status = 'concluida' GROUP BY ano, mes, p.forma`,
      ),
      qtdMensal: all(
        `SELECT substr(criado_em, 1, 4) AS ano, CAST(substr(criado_em, 6, 2) AS INTEGER) AS mes, COUNT(*) AS n
           FROM vendas WHERE status = 'concluida' GROUP BY ano, mes`,
      ),
      categoriasDia: all(
        `SELECT substr(v.criado_em, 1, 10) AS dia, ${CAT} AS categoria, SUM(i.quantidade) AS qtd, SUM(i.total) AS total
           FROM venda_itens i JOIN vendas v ON v.id = i.venda_id
           LEFT JOIN produtos p ON p.id = i.produto_id LEFT JOIN categorias c ON c.id = p.categoria_id
          WHERE v.status = 'concluida' GROUP BY dia, categoria ORDER BY dia`,
      ),
      vendas: all(
        `SELECT v.*, c.nome AS cliente,
                (SELECT GROUP_CONCAT(quantidade || 'x ' || nome_produto, ', ') FROM venda_itens WHERE venda_id = v.id) AS resumo,
                (SELECT GROUP_CONCAT(forma, '+') FROM venda_pagamentos WHERE venda_id = v.id) AS formas
           FROM vendas v LEFT JOIN clientes c ON c.id = v.cliente_id ORDER BY v.id`,
      ),
      itens: all(
        `SELECT i.*, v.criado_em, v.status, ${CAT} AS categoria
           FROM venda_itens i JOIN vendas v ON v.id = i.venda_id
           LEFT JOIN produtos p ON p.id = i.produto_id LEFT JOIN categorias c ON c.id = p.categoria_id
          ORDER BY i.id`,
      ),
      produtos: produtos.listar({ incluirInativos: true }),
      clientes: clientes.listar({ incluirInativos: true }),
      lancamentos: all(
        `SELECT f.*, c.nome AS cliente FROM fiado_lancamentos f JOIN clientes c ON c.id = f.cliente_id ORDER BY f.id`,
      ),
      caixas: caixa.historico({ limite: 1_000_000 }).reverse(),
      movimentos: estoque.movimentos({ limite: 1_000_000 }).reverse(),
    };
  },

  painel() {
    return {
      hoje: relatorios.periodo(),
      estoqueBaixo: estoque.baixo(),
      fiadoAReceber: clientes.totalAReceber(),
      ultimasVendas: vendas.listar({ limite: 8 }),
    };
  },
};

module.exports = { config, categorias, produtos, estoque, caixa, clientes, vendas, relatorios, FORMAS };
