// Teste rápido das regras de negócio, sem Electron (banco em memória).
// Uso: npm run teste
const assert = require('assert');
const db = require('../electron/db.cjs');
const s = require('../electron/servicos.cjs');

function falha(fn, trecho) {
  assert.throws(fn, (e) => e.amigavel && e.message.includes(trecho), `esperava erro "${trecho}"`);
}

(async () => {
  await db.abrir(null);

  assert.strictEqual(s.produtos.carregarExemplos(), 21);
  const coxinha = s.produtos.listar({ busca: 'Coxinha' })[0];
  const refri = s.produtos.listar({ busca: 'lata' })[0];
  assert.strictEqual(coxinha.estoque, 30);

  falha(() => s.vendas.finalizar({ itens: [{ produtoId: coxinha.id, quantidade: 1 }], formaPagamento: 'pix' }), 'Abra o caixa');

  s.caixa.abrir({ valorInicial: 5000 });
  falha(() => s.caixa.abrir({ valorInicial: 0 }), 'Já existe');

  // Venda em dinheiro com troco
  const v1 = s.vendas.finalizar({
    itens: [{ produtoId: coxinha.id, quantidade: 2 }, { produtoId: refri.id, quantidade: 1 }],
    formaPagamento: 'dinheiro', valorRecebido: 5000,
  });
  assert.strictEqual(v1.total, 2000);
  assert.strictEqual(v1.troco, 3000);
  assert.strictEqual(s.produtos.listar({ busca: 'Coxinha' })[0].estoque, 28);

  // Venda pix com desconto
  const v2 = s.vendas.finalizar({ itens: [{ produtoId: coxinha.id, quantidade: 1 }], formaPagamento: 'pix', desconto: 100 });
  assert.strictEqual(v2.total, 600);

  // Fiado
  const cli = s.clientes.salvar({ nome: 'Maria da clínica', telefone: '11999990000' });
  falha(() => s.vendas.finalizar({ itens: [{ produtoId: refri.id, quantidade: 1 }], formaPagamento: 'fiado' }), 'Selecione o cliente');
  const v3 = s.vendas.finalizar({ itens: [{ produtoId: refri.id, quantidade: 2 }], formaPagamento: 'fiado', clienteId: cli.id });
  assert.strictEqual(s.clientes.extrato(cli.id).cliente.saldo, 1200);
  s.clientes.receber({ clienteId: cli.id, valor: 500, formaPagamento: 'dinheiro' });
  assert.strictEqual(s.clientes.extrato(cli.id).cliente.saldo, 700);
  falha(() => s.clientes.receber({ clienteId: cli.id, valor: 800 }), 'maior que o saldo');

  // Cancelamento devolve estoque e estorna fiado
  s.vendas.cancelar({ id: v3.id, motivo: 'teste' });
  assert.strictEqual(s.produtos.listar({ busca: 'lata' })[0].estoque, 47);
  // Pagou 5,00 de uma compra que foi cancelada: fica com 5,00 de crédito (saldo negativo).
  assert.strictEqual(s.clientes.extrato(cli.id).cliente.saldo, -500);
  falha(() => s.vendas.cancelar({ id: v3.id }), 'já está cancelada');

  // Estoque
  s.estoque.movimentar({ produtoId: coxinha.id, tipo: 'entrada', quantidade: 12 });
  s.estoque.movimentar({ produtoId: coxinha.id, tipo: 'perda', quantidade: 2, observacao: 'caiu no chão' });
  s.estoque.movimentar({ produtoId: coxinha.id, tipo: 'ajuste', quantidade: 30 });
  assert.strictEqual(s.produtos.listar({ busca: 'Coxinha' })[0].estoque, 30);

  // Caixa: 5000 inicial + 2000 venda dinheiro + 500 fiado recebido + 1000 suprimento - 3000 sangria
  s.caixa.movimentar({ tipo: 'suprimento', valor: 1000 });
  s.caixa.movimentar({ tipo: 'sangria', valor: 3000 });
  falha(() => s.caixa.movimentar({ tipo: 'sangria', valor: 999999 }), 'maior que o dinheiro');
  const r = s.caixa.atual();
  assert.strictEqual(r.dinheiroEsperado, 5500);
  assert.strictEqual(r.vendas.porForma.pix, 600);
  assert.strictEqual(r.vendas.quantidade, 2);

  const rel = s.relatorios.periodo();
  assert.strictEqual(rel.total, 2600);
  assert.strictEqual(rel.maisVendidos[0].nome, 'Coxinha de frango');

  // Pagamento dividido: 2 refri (1200) + 1 coxinha (700) = 1900
  //   = 400 dinheiro (entregou 1000, troco 600) + 1000 pix + 500 fiado
  const v4 = s.vendas.finalizar({
    itens: [{ produtoId: refri.id, quantidade: 2 }, { produtoId: coxinha.id, quantidade: 1 }],
    pagamentos: [{ forma: 'dinheiro', valor: 400 }, { forma: 'pix', valor: 1000 }, { forma: 'fiado', valor: 500 }],
    valorRecebido: 1000, clienteId: cli.id,
  });
  assert.strictEqual(v4.total, 1900);
  assert.strictEqual(v4.forma_pagamento, 'misto');
  assert.strictEqual(v4.troco, 600);
  assert.strictEqual(v4.pagamentos.length, 3);
  assert.strictEqual(s.clientes.extrato(cli.id).cliente.saldo, 0); // -500 de crédito + 500 de fiado
  falha(() => s.vendas.finalizar({
    itens: [{ produtoId: coxinha.id, quantidade: 1 }], pagamentos: [{ forma: 'pix', valor: 300 }, { forma: 'dinheiro', valor: 300 }],
  }), 'não bate');
  falha(() => s.vendas.finalizar({
    itens: [{ produtoId: coxinha.id, quantidade: 1 }], pagamentos: [{ forma: 'pix', valor: 200 }, { forma: 'dinheiro', valor: 500 }], valorRecebido: 400,
  }), 'menor que');
  let r2 = s.caixa.atual();
  assert.strictEqual(r2.vendas.porForma.pix, 1600);
  assert.strictEqual(r2.dinheiroEsperado, 5900); // 5500 + 400 da parte em dinheiro

  // Configurações e senha de gerente
  assert.strictEqual(s.config.obter().temSenha, false);
  s.config.salvar({ dados: { nome_loja: 'Salgados da Esquina', papel: '58', imprimir_auto: true } });
  s.config.definirSenha({ novaSenha: '1234' });
  assert.strictEqual(s.config.obter().temSenha, true);
  assert.strictEqual(s.config.obter().papel, '58');
  falha(() => s.config.salvar({ dados: { nome_loja: 'X' } }), 'Informe a senha');
  falha(() => s.config.salvar({ dados: { nome_loja: 'X' }, senha: '0000' }), 'incorreta');
  falha(() => s.vendas.cancelar({ id: v4.id }), 'Informe a senha');
  s.vendas.cancelar({ id: v4.id, senha: '1234' });
  assert.strictEqual(s.clientes.extrato(cli.id).cliente.saldo, -500); // fiado da v4 estornado
  r2 = s.caixa.atual();
  assert.strictEqual(r2.vendas.porForma.pix, 600);

  // Cupom (HTML) gera sem erro e escapa texto
  const imp = require('../electron/impressao.cjs');
  const cfg = { ...s.config.obter(), mensagem_cupom: '<b>Volte sempre</b>' };
  const html = imp.cupomVenda(s.vendas.detalhe(v4.id), cfg);
  assert.ok(html.includes('Salgados da Esquina') && html.includes('VENDA CANCELADA') && html.includes('&lt;b&gt;'));
  assert.ok(imp.fechamento(s.caixa.atual(), cfg).includes('RESUMO DE CAIXA'));

  // Backup em Excel/PDF: gera sem erro e com as abas no padrão de linhas e colunas
  const bk = require('../electron/backup.cjs');
  const dadosBk = s.relatorios.backup();
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await bk.gerarExcel(dadosBk, cfg));
  assert.deepStrictEqual(wb.worksheets.map((w) => w.name),
    ['RESUMO ANUAL', 'VENDAS POR CATEGORIA', 'VENDAS', 'ITENS VENDIDOS', 'PRODUTOS E ESTOQUE', 'FIADO', 'CAIXAS', 'MOVIMENTOS ESTOQUE']);
  const resumo = wb.getWorksheet('RESUMO ANUAL');
  assert.strictEqual(resumo.getCell('A3').value, 'JANEIRO');
  assert.strictEqual(resumo.getCell('A9').value, 'TOTAL');
  assert.ok(String(resumo.getCell('B9').value.formula).startsWith('SUM('));
  assert.ok(bk.gerarHtml(dadosBk, cfg).includes('CONTROLE DE VENDAS ANUAL'));

  falha(() => s.caixa.fechar({ valorContado: 5400 }), 'Informe a senha');
  const fechado = s.caixa.fechar({ valorContado: 5400, senha: '1234' });
  assert.strictEqual(fechado.caixa.valor_esperado, 5500);
  falha(() => s.vendas.cancelar({ id: v1.id, senha: '1234' }), 'caixa aberto');
  s.config.definirSenha({ senhaAtual: '1234', novaSenha: '' });
  assert.strictEqual(s.config.obter().temSenha, false);

  console.log('OK: todos os testes passaram.');
})().catch((e) => {
  console.error('FALHOU:', e);
  process.exit(1);
});
