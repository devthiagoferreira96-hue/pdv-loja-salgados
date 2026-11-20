import { Printer } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import Modal from '../componentes/Modal.jsx';
import { useAviso, useCaixa, useImprimir, useSenha } from '../componentes/contexto.jsx';
import { api, dataBR, dataHora, FORMAS, hojeISO, moeda, nomeForma, nomeFormas } from '../util.js';

export default function Vendas() {
  const avisar = useAviso();
  const pedirSenha = useSenha();
  const imprimir = useImprimir();
  const { recarregarCaixa } = useCaixa();
  const [inicio, setInicio] = useState(hojeISO());
  const [fim, setFim] = useState(hojeISO());
  const [rel, setRel] = useState(null);
  const [lista, setLista] = useState([]);
  const [detalhe, setDetalhe] = useState(null);
  const [motivo, setMotivo] = useState(null); // null = não está cancelando

  const carregar = useCallback(async () => {
    try {
      const [r, l] = await Promise.all([api('relatorios.periodo', { inicio, fim }), api('vendas.listar', { inicio, fim })]);
      setRel(r);
      setLista(l);
    } catch (e) {
      avisar(e.message, 'erro');
    }
  }, [inicio, fim, avisar]);
  useEffect(() => { carregar(); }, [carregar]);

  function atalho(dias) {
    const d = new Date();
    d.setDate(d.getDate() - dias);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    setInicio(iso);
    setFim(hojeISO());
  }

  async function abrir(id) {
    try {
      setMotivo(null);
      setDetalhe(await api('vendas.detalhe', id));
    } catch (e) {
      avisar(e.message, 'erro');
    }
  }

  async function cancelar() {
    if (motivo === null) return setMotivo('');
    const senha = await pedirSenha(`Confirme a senha para cancelar a venda #${detalhe.id}.`);
    if (senha === null) return;
    try {
      await api('vendas.cancelar', { id: detalhe.id, motivo, senha });
      avisar(`Venda #${detalhe.id} cancelada. Estoque devolvido.`);
      setDetalhe(null);
      carregar();
      recarregarCaixa();
    } catch (e) {
      avisar(e.message, 'erro');
    }
  }

  return (
    <div>
      <div className="cabecalho"><h1>Vendas e relatórios</h1></div>

      <div className="filtros">
        <label>De <input type="date" className="campo" value={inicio} onChange={(e) => setInicio(e.target.value)} /></label>
        <label>Até <input type="date" className="campo" value={fim} onChange={(e) => setFim(e.target.value)} /></label>
        <button className="btn btn-claro" onClick={() => atalho(0)}>Hoje</button>
        <button className="btn btn-claro" onClick={() => atalho(6)}>7 dias</button>
        <button className="btn btn-claro" onClick={() => atalho(29)}>30 dias</button>
      </div>

      {rel && (
        <>
          <div className="cartoes">
            <div className="cartao destaque"><span>Total vendido</span><strong>{moeda(rel.total)}</strong></div>
            <div className="cartao"><span>Vendas</span><strong>{rel.quantidade}</strong></div>
            <div className="cartao"><span>Ticket médio</span><strong>{moeda(rel.ticketMedio)}</strong></div>
            <div className="cartao"><span>Lucro estimado</span><strong>{moeda(rel.lucroEstimado)}</strong><small>com base no custo cadastrado</small></div>
          </div>
          <div className="grade-2">
            <section className="painel">
              <h2>Por forma de pagamento</h2>
              <table className="tabela"><tbody>
                {FORMAS.map((f) => <tr key={f.id}><td>{f.nome}</td><td className="num">{moeda(rel.porForma[f.id])}</td></tr>)}
                {rel.descontos > 0 && <tr><td className="suave">Descontos concedidos</td><td className="num suave">{moeda(rel.descontos)}</td></tr>}
              </tbody></table>
            </section>
            <section className="painel">
              <h2>Mais vendidos</h2>
              {rel.maisVendidos.length === 0 ? <p className="vazio">Sem vendas no período.</p> : (
                <table className="tabela"><tbody>
                  {rel.maisVendidos.map((m) => <tr key={m.nome}><td>{m.nome}</td><td className="num">{m.qtd} un</td><td className="num">{moeda(m.total)}</td></tr>)}
                </tbody></table>
              )}
            </section>
          </div>
          {rel.porDia.length > 1 && (
            <section className="painel">
              <h2>Por dia</h2>
              <div className="barras">
                {rel.porDia.map((d) => {
                  const max = Math.max(...rel.porDia.map((x) => x.total));
                  return (
                    <div key={d.dia} className="barra-linha">
                      <span className="barra-rotulo">{dataBR(d.dia)}</span>
                      <div className="barra-trilho"><div className="barra" style={{ width: `${(d.total / max) * 100}%` }} /></div>
                      <span className="barra-valor">{moeda(d.total)}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      <section className="painel">
        <h2>Lista de vendas</h2>
        {lista.length === 0 ? <p className="vazio">Nenhuma venda no período.</p> : (
          <table className="tabela clicavel">
            <thead><tr><th>#</th><th>Quando</th><th>Itens</th><th>Pagamento</th><th className="num">Total</th></tr></thead>
            <tbody>
              {lista.map((v) => (
                <tr key={v.id} className={v.status === 'cancelada' ? 'cancelada' : ''} onClick={() => abrir(v.id)}>
                  <td>{v.id}</td>
                  <td>{dataHora(v.criado_em)}</td>
                  <td className="corta">{v.resumo}</td>
                  <td>{nomeFormas(v)}{v.cliente ? ` · ${v.cliente}` : ''}{v.status === 'cancelada' && <span className="etiqueta erro">cancelada</span>}</td>
                  <td className="num">{moeda(v.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {detalhe && (
        <Modal titulo={`Venda #${detalhe.id}`} onFechar={() => setDetalhe(null)} largura={560}>
          <p className="suave">
            {dataHora(detalhe.criado_em, { ano: true })}
            {detalhe.cliente ? ` · ${detalhe.cliente}` : ''}
          </p>
          {detalhe.status === 'cancelada' && (
            <p className="texto-erro">Cancelada em {dataHora(detalhe.cancelada_em)}{detalhe.motivo_cancelamento ? ` — ${detalhe.motivo_cancelamento}` : ''}</p>
          )}
          <table className="tabela">
            <tbody>
              {detalhe.itens.map((i) => (
                <tr key={i.id}><td>{i.quantidade}x {i.nome_produto}</td><td className="num suave">{moeda(i.preco_unitario)}</td><td className="num">{moeda(i.total)}</td></tr>
              ))}
              {detalhe.desconto > 0 && <tr><td>Desconto</td><td></td><td className="num">−{moeda(detalhe.desconto)}</td></tr>}
              <tr className="linha-total"><td>Total</td><td></td><td className="num">{moeda(detalhe.total)}</td></tr>
              {detalhe.pagamentos.map((p) => (
                <tr key={p.forma}><td>Pago em {nomeForma(p.forma)}</td><td></td><td className="num">{moeda(p.valor)}</td></tr>
              ))}
              {detalhe.valor_recebido != null && (
                <tr><td className="suave">Recebido em dinheiro {moeda(detalhe.valor_recebido)} · troco</td><td></td><td className="num suave">{moeda(detalhe.troco)}</td></tr>
              )}
            </tbody>
          </table>
          {motivo !== null && (
            <label className="form">Motivo do cancelamento
              <input className="campo" autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') cancelar(); }} placeholder="Ex.: cliente desistiu" />
            </label>
          )}
          <div className="form-acoes">
            {detalhe.status === 'concluida' && detalhe.caixa_status === 'aberto' && (
              <button className="btn btn-perigo" onClick={cancelar}>{motivo === null ? 'Cancelar venda' : 'Confirmar cancelamento'}</button>
            )}
            <button className="btn btn-claro" onClick={() => imprimir('impressao.venda', detalhe.id)}>🖨️ Imprimir cupom</button>
            <button className="btn btn-claro" onClick={() => setDetalhe(null)}>Fechar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
