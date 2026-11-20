import { Printer } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAviso, useCaixa, useConfig, useImprimir } from '../componentes/contexto.jsx';
import { api, FORMAS, moeda, nomeForma, paraCampo, paraCentavos, semAcento } from '../util.js';

export default function Vender() {
  const { caixa, carregado, recarregarCaixa } = useCaixa();
  const { config } = useConfig();
  const imprimir = useImprimir();
  const avisar = useAviso();
  const buscaRef = useRef(null);

  const [categorias, setCategorias] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [categoria, setCategoria] = useState(null);
  const [busca, setBusca] = useState('');

  const [carrinho, setCarrinho] = useState([]); // [{ produto, quantidade }]
  const [desconto, setDesconto] = useState('');
  const [forma, setForma] = useState('dinheiro');
  const [dividir, setDividir] = useState(false);
  const [partes, setPartes] = useState([]); // pagamento dividido: [{ forma, valor: '5,00' }]
  const [recebido, setRecebido] = useState('');
  const [clienteId, setClienteId] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [ultima, setUltima] = useState(null);

  const carregar = useCallback(async () => {
    try {
      const [c, p, cl] = await Promise.all([api('categorias.listar'), api('produtos.listar'), api('clientes.listar')]);
      setCategorias(c);
      setProdutos(p);
      setClientes(cl);
    } catch (e) {
      avisar(e.message, 'erro');
    }
  }, [avisar]);
  useEffect(() => { carregar(); }, [carregar]);

  const visiveis = useMemo(() => {
    const termo = semAcento(busca.trim());
    return produtos.filter((p) =>
      (!categoria || p.categoria_id === categoria) &&
      (!termo || semAcento(p.nome).includes(termo) || p.codigo_barras === busca.trim()));
  }, [produtos, categoria, busca]);

  const subtotal = carrinho.reduce((s, i) => s + i.produto.preco * i.quantidade, 0);
  const descontoC = paraCentavos(desconto);
  const descontoValido = Number.isFinite(descontoC) && descontoC >= 0 && descontoC <= subtotal;
  const total = descontoValido ? subtotal - descontoC : subtotal;

  const pagamentos = dividir
    ? partes.map((p) => ({ forma: p.forma, valor: paraCentavos(p.valor) }))
    : [{ forma, valor: total }];
  const partesValidas = pagamentos.every((p) => Number.isFinite(p.valor) && p.valor >= 0);
  const restante = total - pagamentos.reduce((s, p) => s + (Number.isFinite(p.valor) ? p.valor : 0), 0);
  const temDinheiro = pagamentos.some((p) => p.forma === 'dinheiro');
  const temFiado = pagamentos.some((p) => p.forma === 'fiado');
  const parteDinheiro = pagamentos.find((p) => p.forma === 'dinheiro')?.valor || 0;
  const recebidoC = recebido === '' ? parteDinheiro : paraCentavos(recebido);
  const troco = temDinheiro && Number.isFinite(recebidoC) ? recebidoC - parteDinheiro : 0;

  function adicionarParte(f) {
    if (partes.some((p) => p.forma === f)) return;
    setPartes([...partes, { forma: f, valor: paraCampo(Math.max(restante, 0)) }]);
  }

  function adicionar(produto) {
    setUltima(null);
    setCarrinho((c) => {
      const i = c.findIndex((x) => x.produto.id === produto.id);
      if (i === -1) return [...c, { produto, quantidade: 1 }];
      const novo = [...c];
      novo[i] = { ...novo[i], quantidade: novo[i].quantidade + 1 };
      return novo;
    });
  }

  function alterar(id, delta) {
    setCarrinho((c) => c
      .map((x) => (x.produto.id === id ? { ...x, quantidade: x.quantidade + delta } : x))
      .filter((x) => x.quantidade > 0));
  }

  function definirQuantidade(id, valor) {
    const q = Math.max(0, parseInt(valor, 10) || 0);
    setCarrinho((c) => c.map((x) => (x.produto.id === id ? { ...x, quantidade: q } : x)));
  }

  function limpar() {
    setCarrinho([]);
    setDesconto('');
    setRecebido('');
    setClienteId('');
    setForma('dinheiro');
    setDividir(false);
    setPartes([]);
  }

  function enterNaBusca(e) {
    if (e.key !== 'Enter') return;
    const termo = busca.trim();
    const porCodigo = produtos.find((p) => p.codigo_barras && p.codigo_barras === termo);
    const alvo = porCodigo || (visiveis.length === 1 ? visiveis[0] : null);
    if (alvo) {
      adicionar(alvo);
      setBusca('');
    }
  }

  async function finalizar() {
    if (enviando || !carrinho.length) return;
    const itens = carrinho.filter((i) => i.quantidade > 0);
    if (!itens.length) return avisar('Carrinho vazio.', 'erro');
    if (!descontoValido) return avisar('Desconto inválido.', 'erro');
    if (dividir && !partes.length) return avisar('Adicione as formas de pagamento.', 'erro');
    if (!partesValidas) return avisar('Valor de pagamento inválido.', 'erro');
    if (restante !== 0) {
      return avisar(restante > 0 ? `Ainda faltam ${moeda(restante)} nos pagamentos.` : `Os pagamentos passam do total em ${moeda(-restante)}.`, 'erro');
    }
    if (temDinheiro && (!Number.isFinite(recebidoC) || recebidoC < parteDinheiro)) {
      return avisar('Valor recebido em dinheiro é menor que o devido.', 'erro');
    }
    if (temFiado && !clienteId) return avisar('Escolha o cliente do fiado.', 'erro');
    setEnviando(true);
    try {
      const venda = await api('vendas.finalizar', {
        itens: itens.map((i) => ({ produtoId: i.produto.id, quantidade: i.quantidade })),
        desconto: descontoC || 0,
        pagamentos,
        valorRecebido: temDinheiro ? recebidoC : null,
        clienteId: temFiado ? Number(clienteId) : null,
      });
      setUltima(venda);
      limpar();
      avisar(`Venda #${venda.id} concluída.`);
      if (config?.imprimir_auto) imprimir('impressao.venda', venda.id);
      carregar();
      recarregarCaixa();
      buscaRef.current?.focus();
    } catch (e) {
      avisar(e.message, 'erro');
    } finally {
      setEnviando(false);
    }
  }

  // Atalhos: F2 busca, F9 finaliza, Esc limpa a busca.
  const finalizarRef = useRef(finalizar);
  finalizarRef.current = finalizar;
  useEffect(() => {
    const tecla = (e) => {
      if (e.key === 'F2') { e.preventDefault(); buscaRef.current?.focus(); }
      if (e.key === 'F9') { e.preventDefault(); finalizarRef.current(); }
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, []);

  if (!carregado) return <div className="carregando">Carregando…</div>;
  if (!caixa) {
    return (
      <div className="centro">
        <div className="painel aviso-caixa">
          <h2>O caixa está fechado</h2>
          <p>Abra o caixa para começar a vender.</p>
          <Link to="/caixa" className="btn btn-primario btn-grande">Abrir caixa</Link>
        </div>
      </div>
    );
  }

  const sugestoes = [...new Set([parteDinheiro, 1000, 2000, 5000, 10000].filter((v) => v >= parteDinheiro))].slice(0, 5);

  return (
    <div className="pdv">
      <section className="pdv-produtos">
        <input
          ref={buscaRef}
          autoFocus
          className="campo busca"
          placeholder="Buscar produto ou ler código de barras (F2)"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => { enterNaBusca(e); if (e.key === 'Escape') setBusca(''); }}
        />
        <div className="abas">
          <button className={`aba ${!categoria ? 'ativa' : ''}`} onClick={() => setCategoria(null)}>Todos</button>
          {categorias.map((c) => (
            <button key={c.id} className={`aba ${categoria === c.id ? 'ativa' : ''}`} onClick={() => setCategoria(c.id)}>
              {c.nome}
            </button>
          ))}
        </div>
        <div className="grade-produtos">
          {visiveis.map((p) => (
            <button key={p.id} className="produto" onClick={() => adicionar(p)}>
              <span className="produto-nome">{p.nome}</span>
              <span className="produto-preco">{moeda(p.preco)}</span>
              {p.controla_estoque === 1 && (
                <span className={`produto-estoque ${p.estoque <= 0 ? 'texto-erro' : p.estoque <= p.estoque_minimo ? 'texto-alerta' : ''}`}>
                  {p.estoque} em estoque
                </span>
              )}
            </button>
          ))}
          {visiveis.length === 0 && (
            <p className="vazio">
              {produtos.length === 0 ? <>Nenhum produto cadastrado. <Link to="/produtos" className="link">Cadastrar</Link></> : 'Nada encontrado.'}
            </p>
          )}
        </div>
      </section>

      <section className="pdv-carrinho">
        <h2>Pedido</h2>
        <div className="itens">
          {carrinho.length === 0 && !ultima && <p className="vazio">Toque nos produtos para adicionar.</p>}
          {carrinho.length === 0 && ultima && (
            <div className="ultima-venda">
              <strong>Venda #{ultima.id} concluída</strong>
              <span>Total {moeda(ultima.total)}</span>
              {ultima.troco > 0 && <span className="troco-grande">Troco: {moeda(ultima.troco)}</span>}
              <button className="btn btn-claro" onClick={() => imprimir('impressao.venda', ultima.id)}>🖨️ Imprimir cupom</button>
            </div>
          )}
          {carrinho.map((i) => (
            <div key={i.produto.id} className="item">
              <div className="item-info">
                <span>{i.produto.nome}</span>
                <small>{moeda(i.produto.preco)} cada</small>
              </div>
              <div className="qtd">
                <button onClick={() => alterar(i.produto.id, -1)}>−</button>
                <input value={i.quantidade} onChange={(e) => definirQuantidade(i.produto.id, e.target.value)}
                  onBlur={() => setCarrinho((c) => c.filter((x) => x.quantidade > 0))} />
                <button onClick={() => alterar(i.produto.id, 1)}>+</button>
              </div>
              <strong className="item-total">{moeda(i.produto.preco * i.quantidade)}</strong>
            </div>
          ))}
        </div>

        <div className="totais">
          <div className="linha"><span>Subtotal</span><span>{moeda(subtotal)}</span></div>
          <div className="linha">
            <span>Desconto (R$)</span>
            <input className={`campo pequeno ${descontoValido ? '' : 'invalido'}`} inputMode="decimal" placeholder="0,00"
              value={desconto} onChange={(e) => setDesconto(e.target.value)} />
          </div>
          <div className="linha total"><span>Total</span><span>{moeda(total)}</span></div>
        </div>

        <div className="pagamento-topo">
          <strong>Pagamento</strong>
          <label className="check">
            <input type="checkbox" checked={dividir} onChange={(e) => { setDividir(e.target.checked); setPartes([]); setRecebido(''); }} />
            Dividir em mais de uma forma
          </label>
        </div>

        {!dividir ? (
          <div className="formas">
            {FORMAS.map((f) => (
              <button key={f.id} className={`forma ${forma === f.id ? 'ativa' : ''}`} onClick={() => setForma(f.id)}>{f.nome}</button>
            ))}
          </div>
        ) : (
          <div className="partes">
            {partes.map((p, i) => (
              <div key={p.forma} className="parte">
                <span>{nomeForma(p.forma)}</span>
                <input className="campo pequeno" inputMode="decimal" autoFocus={i === partes.length - 1} value={p.valor}
                  onChange={(e) => setPartes(partes.map((x) => (x.forma === p.forma ? { ...x, valor: e.target.value } : x)))} />
                <button className="btn-icone" aria-label="Remover" onClick={() => setPartes(partes.filter((x) => x.forma !== p.forma))}>×</button>
              </div>
            ))}
            <div className="formas">
              {FORMAS.filter((f) => !partes.some((p) => p.forma === f.id)).map((f) => (
                <button key={f.id} className="forma" onClick={() => adicionarParte(f.id)}>+ {f.nome}</button>
              ))}
            </div>
            {restante !== 0 && (
              <div className={restante > 0 ? 'texto-alerta' : 'texto-erro'}>
                {restante > 0 ? `Faltam ${moeda(restante)}` : `Passou ${moeda(-restante)} do total`}
              </div>
            )}
          </div>
        )}

        {temDinheiro && (
          <div className="pagamento">
            <label>Valor recebido em dinheiro</label>
            <input className="campo" inputMode="decimal" placeholder={moeda(parteDinheiro)} value={recebido}
              onChange={(e) => setRecebido(e.target.value)} />
            <div className="sugestoes">
              {sugestoes.map((v) => <button key={v} className="btn btn-claro" onClick={() => setRecebido(String(v / 100).replace('.', ','))}>{moeda(v)}</button>)}
            </div>
            <div className={`troco ${troco < 0 ? 'texto-erro' : ''}`}>
              {troco < 0 ? `Faltam ${moeda(-troco)}` : `Troco: ${moeda(troco)}`}
            </div>
          </div>
        )}

        {temFiado && (
          <div className="pagamento">
            <label>Cliente</label>
            <select className="campo" value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
              <option value="">Selecione…</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.saldo > 0 ? ` (deve ${moeda(c.saldo)})` : ''}</option>)}
            </select>
            <Link to="/fiado" className="link">Cadastrar cliente</Link>
          </div>
        )}

        <div className="acoes-pdv">
          <button className="btn btn-claro" onClick={limpar} disabled={!carrinho.length}>Limpar</button>
          <button className="btn btn-primario btn-grande" onClick={finalizar} disabled={!carrinho.length || enviando}>
            {enviando ? 'Salvando…' : `Finalizar ${moeda(total)} (F9)`}
          </button>
        </div>
      </section>
    </div>
  );
}
