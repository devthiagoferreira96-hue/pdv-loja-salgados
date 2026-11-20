// Monta o HTML do cupom e do fechamento para impressora térmica (58 ou 80 mm).
// Funções puras: recebem dados, devolvem HTML. Quem imprime é o main.cjs.

const NOMES = { dinheiro: 'Dinheiro', pix: 'Pix', debito: 'Débito', credito: 'Crédito', fiado: 'Fiado' };
const reais = (c) => `R$ ${((c || 0) / 100).toFixed(2).replace('.', ',')}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const dataBR = (s) => {
  if (!s) return '';
  const [d, h] = s.split(' ');
  return `${d.split('-').reverse().join('/')} ${h?.slice(0, 5) ?? ''}`;
};
const linha = (esq, dir, classe = '') => `<div class="l ${classe}"><span>${esq}</span><span>${dir}</span></div>`;

function pagina(cfg, corpo) {
  const largura = cfg.papel === '58' ? 48 : 72; // área útil em mm
  const logo = cfg.logo ? `<div class="c"><img src="${cfg.logo}"></div>` : '';
  const dados = [cfg.endereco, cfg.telefone && `Tel: ${cfg.telefone}`, cfg.documento]
    .filter(Boolean).map((t) => `<div class="c p">${esc(t)}</div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 2mm; width: ${largura + 4}mm; font-family: 'Courier New', monospace; font-size: ${cfg.papel === '58' ? 10 : 12}px; color: #000; }
    .c { text-align: center; }
    .l { display: flex; justify-content: space-between; gap: 6px; }
    .l span:last-child { white-space: nowrap; }
    .g { font-weight: bold; font-size: 1.25em; }
    .n { font-weight: bold; font-size: 1.3em; margin: 2px 0; }
    .p { font-size: .9em; }
    .item { margin: 3px 0; }
    hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
    img { max-width: 70%; max-height: 28mm; filter: grayscale(1); margin-bottom: 4px; }
  </style></head><body>
    ${logo}
    <div class="c n">${esc(cfg.nome_loja || 'Minha Loja')}</div>
    ${dados}
    <hr>
    ${corpo}
    <div style="height: 8mm"></div>
  </body></html>`;
}

function cupomVenda(v, cfg) {
  const itens = v.itens.map((i) => `
    <div class="item">${esc(i.nome_produto)}
      ${linha(`&nbsp;&nbsp;${i.quantidade} x ${reais(i.preco_unitario)}`, reais(i.total))}
    </div>`).join('');
  const pags = (v.pagamentos?.length ? v.pagamentos : [{ forma: v.forma_pagamento, valor: v.total }])
    .map((p) => linha(NOMES[p.forma] ?? p.forma, reais(p.valor))).join('');
  const temDinheiro = (v.pagamentos || []).some((p) => p.forma === 'dinheiro') || v.forma_pagamento === 'dinheiro';
  return pagina(cfg, `
    <div class="c"><b>CUPOM DE VENDA #${v.id}</b></div>
    <div class="c p">${dataBR(v.criado_em)}</div>
    ${v.status === 'cancelada' ? '<div class="c g">*** VENDA CANCELADA ***</div>' : ''}
    <hr>
    ${itens}
    <hr>
    ${v.desconto > 0 ? linha('Subtotal', reais(v.subtotal)) + linha('Desconto', `- ${reais(v.desconto)}`) : ''}
    ${linha('TOTAL', reais(v.total), 'g')}
    <hr>
    ${pags}
    ${temDinheiro && v.valor_recebido != null ? linha('Recebido em dinheiro', reais(v.valor_recebido)) + linha('Troco', reais(v.troco)) : ''}
    ${v.cliente ? `<div>Cliente: ${esc(v.cliente)}</div>` : ''}
    <hr>
    ${cfg.mensagem_cupom ? `<div class="c">${esc(cfg.mensagem_cupom)}</div>` : ''}
    <div class="c p">Não é documento fiscal</div>
  `);
}

function fechamento(r, cfg) {
  const c = r.caixa;
  const formas = Object.entries(r.vendas.porForma).map(([f, val]) => linha(NOMES[f] ?? f, reais(val))).join('');
  const fiado = Object.values(r.recebimentosFiado).reduce((a, b) => a + b, 0);
  const dif = c.valor_contado != null ? c.valor_contado - c.valor_esperado : null;
  return pagina(cfg, `
    <div class="c"><b>${c.status === 'fechado' ? 'FECHAMENTO' : 'RESUMO'} DE CAIXA #${c.id}</b></div>
    <div class="p">Abertura: ${dataBR(c.aberto_em)}</div>
    ${c.fechado_em ? `<div class="p">Fechamento: ${dataBR(c.fechado_em)}</div>` : ''}
    <hr>
    ${linha(`Vendas (${r.vendas.quantidade})`, reais(r.vendas.total), 'g')}
    ${formas}
    ${fiado ? linha('Fiado recebido', reais(fiado)) : ''}
    <hr>
    <div><b>Dinheiro</b></div>
    ${linha('Valor inicial', reais(c.valor_inicial))}
    ${linha('+ Vendas em dinheiro', reais(r.vendas.porForma.dinheiro))}
    ${r.recebimentosFiado.dinheiro ? linha('+ Fiado em dinheiro', reais(r.recebimentosFiado.dinheiro)) : ''}
    ${linha('+ Suprimentos', reais(r.suprimentos))}
    ${linha('- Sangrias', reais(r.sangrias))}
    ${linha('= Esperado', reais(r.dinheiroEsperado), 'g')}
    ${dif !== null ? linha('Contado', reais(c.valor_contado)) + linha(dif === 0 ? 'Diferença' : dif < 0 ? 'FALTOU' : 'SOBROU', reais(Math.abs(dif)), 'g') : ''}
    ${c.observacao ? `<hr><div>Obs: ${esc(c.observacao)}</div>` : ''}
    <hr>
    <br><br>
    <div class="c">______________________________</div>
    <div class="c p">Assinatura</div>
  `);
}

function teste(cfg) {
  return pagina(cfg, `
    <div class="c g">TESTE DE IMPRESSÃO</div>
    <div class="c">Papel ${cfg.papel === '58' ? '58' : '80'} mm</div>
    <hr>
    ${linha('Coxinha de frango', reais(700))}
    ${linha('TOTAL', reais(700), 'g')}
    <hr>
    <div class="c">Se este texto saiu inteiro, está tudo certo!</div>
  `);
}

module.exports = { cupomVenda, fechamento, teste };
