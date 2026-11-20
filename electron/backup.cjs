// Backup legível em Excel (.xlsx) e PDF, no padrão "linhas e colunas" da planilha de controle anual:
//  - RESUMO ANUAL: blocos por mês; linhas = formas de pagamento, colunas = anos; TOTAL por fórmula.
//  - VENDAS POR CATEGORIA: blocos lado a lado (DATA | QTD | VALOR) com TOTAL, um mês empilhado sob o outro.
//  - Abas de dados completos (vendas, itens, produtos, fiado, caixas, estoque) no mesmo estilo.
// Funções puras: recebem os dados de servicos.relatorios.backup() e devolvem Buffer/HTML.
const ExcelJS = require('exceljs');

const MESES = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
const FORMAS = ['dinheiro', 'pix', 'debito', 'credito', 'fiado'];
const NOMES = { dinheiro: 'DINHEIRO', pix: 'PIX', debito: 'DÉBITO', credito: 'CRÉDITO', fiado: 'FIADO', misto: 'MISTO' };
const TIPOS_FIADO = { compra: 'COMPRA', pagamento: 'PAGAMENTO', estorno: 'ESTORNO' };
const TIPOS_MOV = { entrada: 'ENTRADA', perda: 'PERDA', ajuste: 'AJUSTE', venda: 'VENDA', estorno: 'CANCELAMENTO' };

const FONTE = { name: 'Aptos Narrow', size: 11 };
const FINO = { style: 'thin' };
const BORDA = { top: FINO, left: FINO, bottom: FINO, right: FINO };
const FMT = { moeda: '"R$" #,##0.00', qtd: '#,##0', data: 'dd/mm/yyyy', dataHora: 'dd/mm/yyyy hh:mm', pct: '0%' };

const reais = (c) => (c || 0) / 100;
const nomeFormas = (v) => (v.formas ? v.formas.split('+').map((f) => NOMES[f] ?? f).join(' + ') : NOMES[v.forma_pagamento] ?? v.forma_pagamento);
const statusTxt = (s) => (s === 'cancelada' ? 'CANCELADA' : 'CONCLUÍDA');

// "2026-11-18 14:05:00" -> Date em UTC com a mesma hora "de parede" (o Excel não tem fuso).
function dataExcel(s) {
  if (!s) return null;
  const [d, h = '00:00:00'] = s.split(' ');
  const [a, m, dia] = d.split('-').map(Number);
  const [hh, mm, ss] = h.split(':').map(Number);
  return new Date(Date.UTC(a, m - 1, dia, hh, mm, ss || 0));
}

// Agrupa os dados que os dois formatos usam.
function preparar(d) {
  const mensal = {};
  for (const r of d.mensal) mensal[`${r.ano}-${r.mes}-${r.forma}`] = r.total;
  const qtd = {};
  for (const r of d.qtdMensal) qtd[`${r.ano}-${r.mes}`] = r.n;

  const usadas = new Set(d.categoriasDia.map((r) => r.categoria));
  const cats = d.categorias.map((c) => c.nome).filter((n) => usadas.has(n));
  if (usadas.has('Sem categoria')) cats.push('Sem categoria');
  for (const n of usadas) if (!cats.includes(n)) cats.push(n);

  const porMes = new Map(); // 'YYYY-MM' -> { cat -> [{dia, qtd, total}] }
  for (const r of d.categoriasDia) {
    const k = r.dia.slice(0, 7);
    if (!porMes.has(k)) porMes.set(k, {});
    (porMes.get(k)[r.categoria] ||= []).push(r);
  }
  return { mensal, qtd, cats, porMes };
}
const nomeMes = (chave) => `${MESES[Number(chave.slice(5, 7)) - 1]}/${chave.slice(0, 4)}`;

// =========================================================== EXCEL
function titulo(ws, r, c1, c2, texto) {
  if (c2 > c1) ws.mergeCells(r, c1, r, c2);
  const cel = ws.getCell(r, c1);
  cel.value = texto;
  cel.font = { ...FONTE, bold: true, size: 12 };
  cel.alignment = { horizontal: 'center', vertical: 'middle' };
}

function cel(ws, r, c, valor, { fmt, negrito = false, borda = true, alinhar } = {}) {
  const x = ws.getCell(r, c);
  x.value = valor ?? null;
  x.font = { ...FONTE, bold: negrito };
  if (fmt) x.numFmt = fmt;
  if (borda) x.border = BORDA;
  if (alinhar) x.alignment = { horizontal: alinhar };
  return x;
}
const end = (ws, r, c) => ws.getCell(r, c).address;

function abaResumoAnual(wb, d, p, cfg) {
  const ws = wb.addWorksheet('RESUMO ANUAL', { views: [{ zoomScale: 120 }] });
  const anos = d.anos;
  ws.getColumn(1).width = 26;
  anos.forEach((_, i) => { ws.getColumn(2 + i).width = 16; });
  titulo(ws, 1, 1, 1 + anos.length, `CONTROLE DE VENDAS ANUAL — ${cfg.nome_loja || 'LOJA'}`.toUpperCase());

  const linhas = Object.fromEntries([...FORMAS, 'total', 'qtd'].map((k) => [k, []]));
  let r = 3;
  const bloco = (rotulo, valorDe, qtdDe, formula) => {
    cel(ws, r, 1, rotulo, { negrito: true });
    anos.forEach((a, i) => cel(ws, r, 2 + i, Number(a), { negrito: true, alinhar: 'center' }));
    r++;
    const ini = r;
    for (const f of FORMAS) {
      cel(ws, r, 1, NOMES[f]);
      anos.forEach((a, i) => {
        const v = formula ? { formula: formula(f, 2 + i), result: valorDe(f, a) } : valorDe(f, a);
        cel(ws, r, 2 + i, v, { fmt: FMT.moeda });
      });
      if (!formula) linhas[f].push(r);
      r++;
    }
    cel(ws, r, 1, 'TOTAL', { negrito: true });
    anos.forEach((a, i) => {
      const c = 2 + i;
      const soma = FORMAS.reduce((s, f) => s + valorDe(f, a), 0);
      cel(ws, r, c, { formula: `SUM(${end(ws, ini, c)}:${end(ws, r - 1, c)})`, result: soma }, { fmt: FMT.moeda, negrito: true });
    });
    if (!formula) linhas.total.push(r);
    r++;
    cel(ws, r, 1, 'Nº DE VENDAS');
    anos.forEach((a, i) => {
      const c = 2 + i;
      const v = formula ? { formula: `SUM(${linhas.qtd.map((x) => end(ws, x, c)).join(',')})`, result: qtdDe(a) } : qtdDe(a);
      cel(ws, r, c, v, { fmt: FMT.qtd });
    });
    if (!formula) linhas.qtd.push(r);
    r += 2;
  };

  for (let m = 1; m <= 12; m++) {
    bloco(MESES[m - 1], (f, a) => reais(p.mensal[`${a}-${m}-${f}`]), (a) => p.qtd[`${a}-${m}`] || 0);
  }
  // Total do ano: soma das mesmas linhas de todos os meses (por fórmula, como na planilha original).
  const totalForma = (f, a) => Array.from({ length: 12 }, (_, i) => reais(p.mensal[`${a}-${i + 1}-${f}`])).reduce((x, y) => x + y, 0);
  const totalQtd = (a) => Array.from({ length: 12 }, (_, i) => p.qtd[`${a}-${i + 1}`] || 0).reduce((x, y) => x + y, 0);
  bloco('TOTAL DO ANO', totalForma, totalQtd, (f, c) => `SUM(${linhas[f].map((x) => end(ws, x, c)).join(',')})`);
}

function abaCategorias(wb, d, p) {
  const ws = wb.addWorksheet('VENDAS POR CATEGORIA', { views: [{ zoomScale: 120 }] });
  const { cats, porMes } = p;
  if (!cats.length) {
    titulo(ws, 1, 1, 3, 'VENDAS POR CATEGORIA');
    ws.getCell(3, 1).value = 'Nenhuma venda registrada.';
    return;
  }
  // Cada bloco: DATA | QTD | VALOR + 1 coluna vazia separando (como nas abas de safra).
  cats.forEach((_, i) => {
    const c0 = 1 + i * 4;
    ws.getColumn(c0).width = 13;
    ws.getColumn(c0 + 1).width = 8;
    ws.getColumn(c0 + 2).width = 15;
    ws.getColumn(c0 + 3).width = 4;
  });
  const ultimaCol = cats.length * 4 - 1;
  let r = 1;
  for (const [chave, porCat] of porMes) {
    titulo(ws, r, 1, ultimaCol, `VENDAS POR CATEGORIA — ${nomeMes(chave)}`);
    r += 2;
    cats.forEach((cat, i) => cel(ws, r, 1 + i * 4, cat.toUpperCase(), { negrito: true, borda: false }));
    r++;
    cats.forEach((_, i) => ['DATA', 'QTD', 'VALOR (R$)'].forEach((t, j) => cel(ws, r, 1 + i * 4 + j, t, { negrito: true, alinhar: 'center' })));
    r++;
    const ini = r;
    const altura = Math.max(1, ...cats.map((c) => (porCat[c] || []).length));
    cats.forEach((cat, i) => {
      const c0 = 1 + i * 4;
      for (let k = 0; k < altura; k++) {
        const x = (porCat[cat] || [])[k];
        cel(ws, ini + k, c0, x ? dataExcel(x.dia) : null, { fmt: FMT.data });
        cel(ws, ini + k, c0 + 1, x ? x.qtd : null, { fmt: FMT.qtd });
        cel(ws, ini + k, c0 + 2, x ? reais(x.total) : null, { fmt: FMT.moeda });
      }
    });
    r = ini + altura + 1;
    cats.forEach((cat, i) => {
      const c0 = 1 + i * 4;
      const lista = porCat[cat] || [];
      cel(ws, r, c0, 'TOTAL', { negrito: true });
      cel(ws, r, c0 + 1, { formula: `SUM(${end(ws, ini, c0 + 1)}:${end(ws, ini + altura - 1, c0 + 1)})`, result: lista.reduce((s, x) => s + x.qtd, 0) }, { fmt: FMT.qtd, negrito: true });
      cel(ws, r, c0 + 2, { formula: `SUM(${end(ws, ini, c0 + 2)}:${end(ws, ini + altura - 1, c0 + 2)})`, result: reais(lista.reduce((s, x) => s + x.total, 0)) }, { fmt: FMT.moeda, negrito: true });
    });
    r += 3;
  }
}

// Tabela simples: título mesclado, cabeçalho em negrito na linha 3, dados, linha TOTAL opcional.
// totais: { chave: 'soma' | { seColuna, igual } }  (o segundo vira SOMASE)
function abaTabela(wb, nome, tituloTxt, colunas, linhas, totais = {}) {
  const ws = wb.addWorksheet(nome, { views: [{ state: 'frozen', ySplit: 3, zoomScale: 120 }] });
  colunas.forEach((c, i) => { ws.getColumn(i + 1).width = c.largura ?? 14; });
  titulo(ws, 1, 1, colunas.length, tituloTxt);
  colunas.forEach((c, i) => cel(ws, 3, i + 1, c.titulo, { negrito: true, alinhar: 'center' }));
  linhas.forEach((l, j) => colunas.forEach((c, i) => cel(ws, 4 + j, i + 1, l[c.chave], { fmt: c.fmt, alinhar: c.alinhar })));
  if (!linhas.length) {
    ws.getCell(4, 1).value = 'Nenhum registro.';
    return ws;
  }
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: colunas.length } };
  const fim = 3 + linhas.length;
  const idx = (chave) => colunas.findIndex((c) => c.chave === chave) + 1;
  const faixa = (chave) => `${end(ws, 4, idx(chave))}:${end(ws, fim, idx(chave))}`;
  if (Object.keys(totais).length) {
    const r = fim + 1;
    cel(ws, r, 1, 'TOTAL', { negrito: true });
    for (const [chave, regra] of Object.entries(totais)) {
      const valores = linhas.filter((l) => regra === 'soma' || l[regra.seColuna] === regra.igual).map((l) => Number(l[chave]) || 0);
      const formula = regra === 'soma'
        ? `SUM(${faixa(chave)})`
        : `SUMIF(${faixa(regra.seColuna)},"${regra.igual}",${faixa(chave)})`;
      const c = colunas[idx(chave) - 1];
      cel(ws, r, idx(chave), { formula, result: valores.reduce((s, v) => s + v, 0) }, { fmt: c.fmt, negrito: true });
    }
  }
  return ws;
}

async function gerarExcel(d, cfg) {
  const p = preparar(d);
  const wb = new ExcelJS.Workbook();
  wb.creator = cfg.nome_loja || 'Sistema da Loja';
  wb.created = new Date();
  wb.calcProperties = { fullCalcOnLoad: true };

  abaResumoAnual(wb, d, p, cfg);
  abaCategorias(wb, d, p);

  abaTabela(wb, 'VENDAS', 'VENDAS — TODAS', [
    { titulo: 'Nº', chave: 'id', largura: 8, alinhar: 'center' },
    { titulo: 'DATA E HORA', chave: 'data', largura: 17, fmt: FMT.dataHora },
    { titulo: 'ITENS', chave: 'resumo', largura: 48 },
    { titulo: 'PAGAMENTO', chave: 'pagamento', largura: 20 },
    { titulo: 'CLIENTE', chave: 'cliente', largura: 20 },
    { titulo: 'SUBTOTAL', chave: 'subtotal', largura: 13, fmt: FMT.moeda },
    { titulo: 'DESCONTO', chave: 'desconto', largura: 13, fmt: FMT.moeda },
    { titulo: 'TOTAL', chave: 'total', largura: 13, fmt: FMT.moeda },
    { titulo: 'SITUAÇÃO', chave: 'status', largura: 13, alinhar: 'center' },
    { titulo: 'MOTIVO CANCELAMENTO', chave: 'motivo', largura: 26 },
  ], d.vendas.map((v) => ({
    id: v.id, data: dataExcel(v.criado_em), resumo: v.resumo, pagamento: nomeFormas(v), cliente: v.cliente,
    subtotal: reais(v.subtotal), desconto: reais(v.desconto), total: reais(v.total), status: statusTxt(v.status), motivo: v.motivo_cancelamento,
  })), {
    subtotal: { seColuna: 'status', igual: 'CONCLUÍDA' },
    desconto: { seColuna: 'status', igual: 'CONCLUÍDA' },
    total: { seColuna: 'status', igual: 'CONCLUÍDA' },
  });

  abaTabela(wb, 'ITENS VENDIDOS', 'ITENS VENDIDOS — TODOS', [
    { titulo: 'VENDA', chave: 'venda', largura: 8, alinhar: 'center' },
    { titulo: 'DATA', chave: 'data', largura: 13, fmt: FMT.data },
    { titulo: 'PRODUTO', chave: 'produto', largura: 34 },
    { titulo: 'CATEGORIA', chave: 'categoria', largura: 20 },
    { titulo: 'QTD', chave: 'qtd', largura: 8, fmt: FMT.qtd },
    { titulo: 'PREÇO UNIT.', chave: 'preco', largura: 13, fmt: FMT.moeda },
    { titulo: 'TOTAL', chave: 'total', largura: 13, fmt: FMT.moeda },
    { titulo: 'SITUAÇÃO', chave: 'status', largura: 13, alinhar: 'center' },
  ], d.itens.map((i) => ({
    venda: i.venda_id, data: dataExcel(i.criado_em.slice(0, 10)), produto: i.nome_produto, categoria: i.categoria,
    qtd: i.quantidade, preco: reais(i.preco_unitario), total: reais(i.total), status: statusTxt(i.status),
  })), {
    qtd: { seColuna: 'status', igual: 'CONCLUÍDA' },
    total: { seColuna: 'status', igual: 'CONCLUÍDA' },
  });

  abaTabela(wb, 'PRODUTOS E ESTOQUE', 'PRODUTOS E ESTOQUE', [
    { titulo: 'PRODUTO', chave: 'nome', largura: 34 },
    { titulo: 'CATEGORIA', chave: 'categoria', largura: 20 },
    { titulo: 'CÓD. BARRAS', chave: 'codigo', largura: 16 },
    { titulo: 'PREÇO', chave: 'preco', largura: 12, fmt: FMT.moeda },
    { titulo: 'CUSTO', chave: 'custo', largura: 12, fmt: FMT.moeda },
    { titulo: 'MARGEM', chave: 'margem', largura: 10, fmt: FMT.pct },
    { titulo: 'ESTOQUE', chave: 'estoque', largura: 10, fmt: FMT.qtd },
    { titulo: 'MÍNIMO', chave: 'minimo', largura: 10, fmt: FMT.qtd },
    { titulo: 'SITUAÇÃO', chave: 'situacao', largura: 14, alinhar: 'center' },
    { titulo: 'ATIVO', chave: 'ativo', largura: 8, alinhar: 'center' },
  ], d.produtos.map((x) => ({
    nome: x.nome, categoria: x.categoria ?? 'Sem categoria', codigo: x.codigo_barras, preco: reais(x.preco), custo: reais(x.custo),
    margem: x.custo && x.preco ? (x.preco - x.custo) / x.preco : null,
    estoque: x.controla_estoque ? x.estoque : null, minimo: x.controla_estoque ? x.estoque_minimo : null,
    situacao: !x.controla_estoque ? 'NÃO CONTROLA' : x.estoque <= 0 ? 'EM FALTA' : x.estoque <= x.estoque_minimo ? 'BAIXO' : 'OK',
    ativo: x.ativo ? 'SIM' : 'NÃO',
  })));

  // Fiado: resumo por cliente e, abaixo, os lançamentos (como os blocos empilhados da planilha original).
  const wsF = abaTabela(wb, 'FIADO', 'FIADO — SALDO POR CLIENTE', [
    { titulo: 'CLIENTE', chave: 'nome', largura: 30 },
    { titulo: 'TELEFONE', chave: 'telefone', largura: 18 },
    { titulo: 'OBSERVAÇÃO', chave: 'obs', largura: 30 },
    { titulo: 'SALDO DEVEDOR', chave: 'saldo', largura: 16, fmt: FMT.moeda },
    { titulo: 'ATIVO', chave: 'ativo', largura: 8, alinhar: 'center' },
  ], d.clientes.map((c) => ({ nome: c.nome, telefone: c.telefone, obs: c.observacao, saldo: reais(c.saldo), ativo: c.ativo ? 'SIM' : 'NÃO' })),
  { saldo: 'soma' });
  let r = 3 + Math.max(d.clientes.length, 1) + 4;
  titulo(wsF, r, 1, 5, 'FIADO — LANÇAMENTOS');
  r += 2;
  ['DATA E HORA', 'CLIENTE', 'DESCRIÇÃO', 'VALOR', 'TIPO'].forEach((t, i) => cel(wsF, r, i + 1, t, { negrito: true, alinhar: 'center' }));
  for (const l of d.lancamentos) {
    r++;
    cel(wsF, r, 1, dataExcel(l.criado_em), { fmt: FMT.dataHora });
    cel(wsF, r, 2, l.cliente);
    cel(wsF, r, 3, l.descricao);
    cel(wsF, r, 4, reais(l.tipo === 'compra' ? l.valor : -l.valor), { fmt: FMT.moeda });
    cel(wsF, r, 5, TIPOS_FIADO[l.tipo], { alinhar: 'center' });
  }

  abaTabela(wb, 'CAIXAS', 'CAIXAS — ABERTURAS E FECHAMENTOS', [
    { titulo: 'Nº', chave: 'id', largura: 7, alinhar: 'center' },
    { titulo: 'ABERTURA', chave: 'abertura', largura: 17, fmt: FMT.dataHora },
    { titulo: 'FECHAMENTO', chave: 'fechamento', largura: 17, fmt: FMT.dataHora },
    { titulo: 'VALOR INICIAL', chave: 'inicial', largura: 14, fmt: FMT.moeda },
    { titulo: 'Nº VENDAS', chave: 'qtd', largura: 10, fmt: FMT.qtd },
    { titulo: 'TOTAL VENDAS', chave: 'vendas', largura: 14, fmt: FMT.moeda },
    { titulo: 'DINHEIRO ESPERADO', chave: 'esperado', largura: 18, fmt: FMT.moeda },
    { titulo: 'DINHEIRO CONTADO', chave: 'contado', largura: 18, fmt: FMT.moeda },
    { titulo: 'DIFERENÇA', chave: 'diferenca', largura: 13, fmt: FMT.moeda },
    { titulo: 'OBSERVAÇÃO', chave: 'obs', largura: 28 },
  ], d.caixas.map((c) => ({
    id: c.id, abertura: dataExcel(c.aberto_em), fechamento: dataExcel(c.fechado_em), inicial: reais(c.valor_inicial),
    qtd: c.qtd_vendas, vendas: reais(c.total_vendas),
    esperado: c.valor_esperado != null ? reais(c.valor_esperado) : null,
    contado: c.valor_contado != null ? reais(c.valor_contado) : null,
    diferenca: c.valor_contado != null ? reais(c.valor_contado - c.valor_esperado) : null,
    obs: c.status === 'aberto' ? 'CAIXA AINDA ABERTO' : c.observacao,
  })), { qtd: 'soma', vendas: 'soma', diferenca: 'soma' });

  abaTabela(wb, 'MOVIMENTOS ESTOQUE', 'MOVIMENTAÇÕES DE ESTOQUE', [
    { titulo: 'DATA E HORA', chave: 'data', largura: 17, fmt: FMT.dataHora },
    { titulo: 'PRODUTO', chave: 'produto', largura: 34 },
    { titulo: 'TIPO', chave: 'tipo', largura: 15, alinhar: 'center' },
    { titulo: 'QTD', chave: 'qtd', largura: 8, fmt: FMT.qtd },
    { titulo: 'FICOU', chave: 'apos', largura: 8, fmt: FMT.qtd },
    { titulo: 'VENDA', chave: 'venda', largura: 8, alinhar: 'center' },
    { titulo: 'OBSERVAÇÃO', chave: 'obs', largura: 30 },
  ], d.movimentos.map((m) => ({
    data: dataExcel(m.criado_em), produto: m.produto, tipo: TIPOS_MOV[m.tipo], qtd: m.quantidade, apos: m.estoque_apos, venda: m.venda_id, obs: m.observacao,
  })));

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// =========================================================== PDF (HTML)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const brl = (c) => `R$ ${((c || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dBR = (s) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '');
const dhBR = (s) => (s ? `${dBR(s)} ${s.slice(11, 16)}` : '');

function tabelaHtml(colunas, linhas, total) {
  const th = colunas.map((c) => `<th>${c.t}</th>`).join('');
  const tr = linhas.map((l) => `<tr>${colunas.map((c) => `<td class="${c.n ? 'n' : ''}">${l[c.k] ?? ''}</td>`).join('')}</tr>`).join('');
  const tt = total ? `<tr class="tot">${colunas.map((c, i) => `<td class="${c.n ? 'n' : ''}">${i === 0 ? 'TOTAL' : total[c.k] ?? ''}</td>`).join('')}</tr>` : '';
  return `<table><thead><tr>${th}</tr></thead><tbody>${tr || `<tr><td colspan="${colunas.length}">Nenhum registro.</td></tr>`}${tt}</tbody></table>`;
}

function gerarHtml(d, cfg) {
  const p = preparar(d);
  const ano = d.ano;
  const loja = esc(cfg.nome_loja || 'Loja');

  // Resumo anual: um bloco por mês (formas x anos), em grade.
  const anos = d.anos;
  const blocoMes = (rotulo, valor, qtd) => {
    const linhas = FORMAS.map((f) => `<tr><td>${NOMES[f]}</td>${anos.map((a) => `<td class="n">${brl(valor(f, a))}</td>`).join('')}</tr>`).join('');
    const tot = anos.map((a) => `<td class="n">${brl(FORMAS.reduce((s, f) => s + valor(f, a), 0))}</td>`).join('');
    const q = anos.map((a) => `<td class="n">${qtd(a)}</td>`).join('');
    return `<table class="bloco"><thead><tr><th class="l">${rotulo}</th>${anos.map((a) => `<th>${a}</th>`).join('')}</tr></thead>
      <tbody>${linhas}<tr class="tot"><td>TOTAL</td>${tot}</tr><tr><td>Nº DE VENDAS</td>${q}</tr></tbody></table>`;
  };
  const meses = Array.from({ length: 12 }, (_, i) => blocoMes(MESES[i], (f, a) => p.mensal[`${a}-${i + 1}-${f}`] || 0, (a) => p.qtd[`${a}-${i + 1}`] || 0)).join('');
  const totalAno = blocoMes('TOTAL DO ANO',
    (f, a) => Array.from({ length: 12 }, (_, i) => p.mensal[`${a}-${i + 1}-${f}`] || 0).reduce((x, y) => x + y, 0),
    (a) => Array.from({ length: 12 }, (_, i) => p.qtd[`${a}-${i + 1}`] || 0).reduce((x, y) => x + y, 0));

  // Vendas por categoria do ano escolhido: blocos lado a lado por mês.
  const mesesAno = [...p.porMes].filter(([k]) => k.startsWith(ano));
  const categorias = mesesAno.map(([chave, porCat]) => {
    const blocos = p.cats.filter((c) => porCat[c]).map((cat) => {
      const l = porCat[cat];
      return `<div class="cat"><div class="cat-nome">${esc(cat.toUpperCase())}</div>
        ${tabelaHtml([{ t: 'DATA', k: 'd' }, { t: 'QTD', k: 'q', n: 1 }, { t: 'VALOR', k: 'v', n: 1 }],
        l.map((x) => ({ d: dBR(x.dia).slice(0, 5), q: x.qtd, v: brl(x.total) })),
        { q: l.reduce((s, x) => s + x.qtd, 0), v: brl(l.reduce((s, x) => s + x.total, 0)) })}</div>`;
    }).join('');
    return `<div class="mes"><h3>${nomeMes(chave)}</h3><div class="cats">${blocos}</div></div>`;
  }).join('') || '<p>Nenhuma venda neste ano.</p>';

  const produtos = tabelaHtml([
    { t: 'PRODUTO', k: 'nome' }, { t: 'CATEGORIA', k: 'cat' }, { t: 'PREÇO', k: 'preco', n: 1 }, { t: 'CUSTO', k: 'custo', n: 1 },
    { t: 'ESTOQUE', k: 'est', n: 1 }, { t: 'MÍNIMO', k: 'min', n: 1 }, { t: 'SITUAÇÃO', k: 'sit' }, { t: 'ATIVO', k: 'ativo' },
  ], d.produtos.map((x) => ({
    nome: esc(x.nome), cat: esc(x.categoria ?? 'Sem categoria'), preco: brl(x.preco), custo: x.custo ? brl(x.custo) : '—',
    est: x.controla_estoque ? x.estoque : '—', min: x.controla_estoque ? x.estoque_minimo : '—',
    sit: !x.controla_estoque ? 'NÃO CONTROLA' : x.estoque <= 0 ? 'EM FALTA' : x.estoque <= x.estoque_minimo ? 'BAIXO' : 'OK',
    ativo: x.ativo ? 'SIM' : 'NÃO',
  })));

  const comSaldo = d.clientes.filter((c) => c.saldo !== 0);
  const fiado = tabelaHtml([{ t: 'CLIENTE', k: 'nome' }, { t: 'TELEFONE', k: 'tel' }, { t: 'SALDO DEVEDOR', k: 'saldo', n: 1 }],
    comSaldo.map((c) => ({ nome: esc(c.nome), tel: esc(c.telefone), saldo: brl(c.saldo) })),
    comSaldo.length ? { saldo: brl(comSaldo.reduce((s, c) => s + c.saldo, 0)) } : null);

  const cxAno = d.caixas.filter((c) => c.aberto_em.startsWith(ano));
  const caixas = tabelaHtml([
    { t: 'Nº', k: 'id' }, { t: 'ABERTURA', k: 'ab' }, { t: 'FECHAMENTO', k: 'fe' }, { t: 'VENDAS', k: 'v', n: 1 },
    { t: 'ESPERADO', k: 'esp', n: 1 }, { t: 'CONTADO', k: 'cont', n: 1 }, { t: 'DIFERENÇA', k: 'dif', n: 1 },
  ], cxAno.map((c) => ({
    id: c.id, ab: dhBR(c.aberto_em), fe: c.fechado_em ? dhBR(c.fechado_em) : 'ABERTO', v: brl(c.total_vendas),
    esp: c.valor_esperado != null ? brl(c.valor_esperado) : '—', cont: c.valor_contado != null ? brl(c.valor_contado) : '—',
    dif: c.valor_contado != null ? brl(c.valor_contado - c.valor_esperado) : '—',
  })), cxAno.length ? { v: brl(cxAno.reduce((s, c) => s + c.total_vendas, 0)) } : null);

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #111; margin: 0; }
    h1 { font-size: 15pt; margin: 0 0 2px; text-align: center; }
    h2 { font-size: 11pt; text-align: center; margin: 18px 0 8px; padding: 4px 0; border-top: 1.5px solid #111; border-bottom: 1.5px solid #111; break-after: avoid; }
    h3 { font-size: 9.5pt; margin: 10px 0 4px; break-after: avoid; }
    .sub { text-align: center; color: #444; margin-bottom: 6px; }
    table { border-collapse: collapse; width: 100%; break-inside: auto; }
    tr { break-inside: avoid; }
    th, td { border: 0.6pt solid #555; padding: 2px 5px; text-align: left; }
    th { font-weight: bold; text-align: center; }
    th.l { text-align: left; }
    td.n { text-align: right; white-space: nowrap; }
    tr.tot td { font-weight: bold; }
    .grade { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .bloco { break-inside: avoid; }
    .total-ano { width: 33%; margin-top: 10px; }
    .mes { break-inside: avoid; margin-bottom: 8px; }
    .cats { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-start; }
    .cat { width: 175px; }
    .cat-nome { font-weight: bold; margin-bottom: 2px; }
    .quebra { break-before: page; }
  </style></head><body>
    <h1>${loja.toUpperCase()}</h1>
    <div class="sub">Backup gerado em ${dhBR(d.geradoEm)} · Relatório do ano ${ano} · Detalhe completo de todas as vendas no arquivo Excel</div>

    <h2>CONTROLE DE VENDAS ANUAL</h2>
    <div class="grade">${meses}</div>
    <div class="total-ano">${totalAno}</div>

    <h2 class="quebra">VENDAS POR CATEGORIA — ${ano}</h2>
    ${categorias}

    <h2 class="quebra">PRODUTOS E ESTOQUE</h2>
    ${produtos}

    <h2>FIADO — CLIENTES COM SALDO</h2>
    ${fiado}

    <h2>CAIXAS — ${ano}</h2>
    ${caixas}
  </body></html>`;
}

module.exports = { gerarExcel, gerarHtml };
