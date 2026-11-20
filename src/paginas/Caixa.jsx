import { Printer } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import Modal from '../componentes/Modal.jsx';
import { useAviso, useCaixa, useConfig, useImprimir, useSenha } from '../componentes/contexto.jsx';
import { api, dataHora, FORMAS, moeda, nomeForma, paraCentavos } from '../util.js';

const NOMES_MOV = { sangria: 'Sangria', suprimento: 'Suprimento', recebimento_fiado: 'Recebimento de fiado' };

export default function Caixa() {
  const { caixa, carregado, recarregarCaixa } = useCaixa();
  const avisar = useAviso();
  const imprimir = useImprimir();
  const [historico, setHistorico] = useState([]);
  const [modal, setModal] = useState(null); // 'sangria' | 'suprimento' | 'fechar'
  const [detalhe, setDetalhe] = useState(null);

  const carregarHistorico = useCallback(async () => {
    try {
      setHistorico((await api('caixa.historico')).filter((c) => c.status === 'fechado'));
    } catch (e) {
      avisar(e.message, 'erro');
    }
  }, [avisar]);
  useEffect(() => { carregarHistorico(); }, [carregarHistorico]);

  async function atualizar() {
    setModal(null);
    await recarregarCaixa();
    carregarHistorico();
  }

  async function verDetalhe(id) {
    try {
      setDetalhe(await api('caixa.resumo', id));
    } catch (e) {
      avisar(e.message, 'erro');
    }
  }

  if (!carregado) return <div className="carregando">Carregando…</div>;

  return (
    <div>
      <div className="cabecalho">
        <h1>Caixa</h1>
        {caixa && (
          <div className="acoes">
            <button className="btn btn-claro" onClick={() => imprimir('impressao.fechamento', caixa.caixa.id)}>🖨️ Imprimir resumo</button>
            <button className="btn btn-claro" onClick={() => setModal('suprimento')}>+ Suprimento</button>
            <button className="btn btn-claro" onClick={() => setModal('sangria')}>− Sangria</button>
            <button className="btn btn-perigo" onClick={() => setModal('fechar')}>Fechar caixa</button>
          </div>
        )}
      </div>

      {caixa ? <Resumo r={caixa} /> : <AbrirCaixa onAberto={atualizar} />}

      <section className="painel">
        <h2>Caixas anteriores</h2>
        {historico.length === 0 ? <p className="vazio">Nenhum caixa fechado ainda.</p> : (
          <table className="tabela clicavel">
            <thead><tr><th>Abertura</th><th>Fechamento</th><th className="num">Vendas</th><th className="num">Dinheiro esperado</th><th className="num">Contado</th><th className="num">Diferença</th></tr></thead>
            <tbody>
              {historico.map((c) => {
                const dif = c.valor_contado - c.valor_esperado;
                return (
                  <tr key={c.id} onClick={() => verDetalhe(c.id)}>
                    <td>{dataHora(c.aberto_em, { ano: true })}</td>
                    <td>{dataHora(c.fechado_em, { ano: true })}</td>
                    <td className="num">{moeda(c.total_vendas)} <small className="suave">({c.qtd_vendas})</small></td>
                    <td className="num">{moeda(c.valor_esperado)}</td>
                    <td className="num">{moeda(c.valor_contado)}</td>
                    <td className={`num ${dif < 0 ? 'texto-erro' : dif > 0 ? 'texto-alerta' : 'texto-ok'}`}>{dif > 0 ? '+' : ''}{moeda(dif)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {(modal === 'sangria' || modal === 'suprimento') && <FormMovimento tipo={modal} onFechar={() => setModal(null)} onSalvo={atualizar} />}
      {modal === 'fechar' && <FecharCaixa r={caixa} onFechar={() => setModal(null)} onSalvo={atualizar} />}
      {detalhe && (
        <Modal titulo={`Caixa de ${dataHora(detalhe.caixa.aberto_em, { ano: true })}`} onFechar={() => setDetalhe(null)} largura={760}>
          <Resumo r={detalhe} />
          {detalhe.caixa.observacao && <p><strong>Observação:</strong> {detalhe.caixa.observacao}</p>}
          <div className="form-acoes">
            <button className="btn btn-claro" onClick={() => imprimir('impressao.fechamento', detalhe.caixa.id)}>🖨️ Imprimir fechamento</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Resumo({ r }) {
  const fiado = Object.values(r.recebimentosFiado).reduce((a, b) => a + b, 0);
  return (
    <>
      <div className="cartoes">
        <div className="cartao destaque"><span>Dinheiro na gaveta (esperado)</span><strong>{moeda(r.dinheiroEsperado)}</strong></div>
        <div className="cartao"><span>Total vendido</span><strong>{moeda(r.vendas.total)}</strong><small>{r.vendas.quantidade} vendas</small></div>
        <div className="cartao"><span>Valor inicial</span><strong>{moeda(r.caixa.valor_inicial)}</strong><small>aberto {dataHora(r.caixa.aberto_em)}</small></div>
        <div className="cartao"><span>Fiado recebido</span><strong>{moeda(fiado)}</strong></div>
      </div>
      <div className="grade-2">
        <section className="painel">
          <h2>Vendas por forma de pagamento</h2>
          <table className="tabela">
            <tbody>
              {FORMAS.map((f) => <tr key={f.id}><td>{f.nome}</td><td className="num">{moeda(r.vendas.porForma[f.id])}</td></tr>)}
            </tbody>
          </table>
        </section>
        <section className="painel">
          <h2>Conta do dinheiro</h2>
          <table className="tabela">
            <tbody>
              <tr><td>Valor inicial</td><td className="num">{moeda(r.caixa.valor_inicial)}</td></tr>
              <tr><td>+ Vendas em dinheiro</td><td className="num">{moeda(r.vendas.porForma.dinheiro)}</td></tr>
              <tr><td>+ Fiado recebido em dinheiro</td><td className="num">{moeda(r.recebimentosFiado.dinheiro)}</td></tr>
              <tr><td>+ Suprimentos</td><td className="num">{moeda(r.suprimentos)}</td></tr>
              <tr><td>− Sangrias</td><td className="num">{moeda(r.sangrias)}</td></tr>
              <tr className="linha-total"><td>= Esperado na gaveta</td><td className="num">{moeda(r.dinheiroEsperado)}</td></tr>
            </tbody>
          </table>
        </section>
      </div>
      {r.movimentos.length > 0 && (
        <section className="painel">
          <h2>Movimentações</h2>
          <table className="tabela">
            <tbody>
              {r.movimentos.map((m) => (
                <tr key={m.id}>
                  <td>{dataHora(m.criado_em)}</td>
                  <td>{NOMES_MOV[m.tipo]}{m.tipo === 'recebimento_fiado' ? ` (${nomeForma(m.forma_pagamento)})` : ''}</td>
                  <td className="suave">{m.descricao}</td>
                  <td className={`num ${m.tipo === 'sangria' ? 'texto-erro' : 'texto-ok'}`}>{m.tipo === 'sangria' ? '−' : '+'}{moeda(m.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

function AbrirCaixa({ onAberto }) {
  const avisar = useAviso();
  const [valor, setValor] = useState('');

  async function abrir(e) {
    e.preventDefault();
    const c = paraCentavos(valor);
    if (!Number.isFinite(c) || c < 0) return avisar('Valor inválido.', 'erro');
    try {
      await api('caixa.abrir', { valorInicial: c });
      avisar('Caixa aberto. Boas vendas!');
      onAberto();
    } catch (err) {
      avisar(err.message, 'erro');
    }
  }

  return (
    <section className="painel aviso-caixa">
      <h2>Abrir caixa</h2>
      <form onSubmit={abrir} className="form">
        <label>Dinheiro na gaveta para troco (R$)
          <input className="campo" autoFocus inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} />
        </label>
        <button className="btn btn-primario btn-grande">Abrir caixa</button>
      </form>
    </section>
  );
}

function FormMovimento({ tipo, onFechar, onSalvo }) {
  const avisar = useAviso();
  const [valor, setValor] = useState('');
  const [descricao, setDescricao] = useState('');

  async function salvar(e) {
    e.preventDefault();
    const c = paraCentavos(valor);
    if (!Number.isFinite(c) || c <= 0) return avisar('Valor inválido.', 'erro');
    try {
      await api('caixa.movimentar', { tipo, valor: c, descricao });
      avisar(tipo === 'sangria' ? 'Sangria registrada.' : 'Suprimento registrado.');
      onSalvo();
    } catch (err) {
      avisar(err.message, 'erro');
    }
  }

  return (
    <Modal titulo={tipo === 'sangria' ? 'Sangria (retirar dinheiro)' : 'Suprimento (colocar dinheiro)'} onFechar={onFechar}>
      <form onSubmit={salvar} className="form">
        <label>Valor (R$)<input className="campo" autoFocus inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} /></label>
        <label>Motivo <small className="suave">(opcional)</small>
          <input className="campo" placeholder={tipo === 'sangria' ? 'Ex.: pagamento de fornecedor' : 'Ex.: troco extra'} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </label>
        <div className="form-acoes">
          <button type="button" className="btn btn-claro" onClick={onFechar}>Cancelar</button>
          <button className="btn btn-primario">Salvar</button>
        </div>
      </form>
    </Modal>
  );
}

function FecharCaixa({ r, onFechar, onSalvo }) {
  const avisar = useAviso();
  const pedirSenha = useSenha();
  const imprimir = useImprimir();
  const { config } = useConfig();
  const [contado, setContado] = useState('');
  const [obs, setObs] = useState('');
  const c = paraCentavos(contado);
  const dif = Number.isFinite(c) && contado !== '' ? c - r.dinheiroEsperado : null;

  async function fechar(e) {
    e.preventDefault();
    if (contado === '' || !Number.isFinite(c) || c < 0) return avisar('Informe o dinheiro contado na gaveta.', 'erro');
    const senha = await pedirSenha('Confirme a senha para fechar o caixa.');
    if (senha === null) return;
    try {
      await api('caixa.fechar', { valorContado: c, observacao: obs, senha });
      avisar('Caixa fechado.');
      if (config?.imprimir_auto) imprimir('impressao.fechamento', r.caixa.id);
      onSalvo();
    } catch (err) {
      avisar(err.message, 'erro');
    }
  }

  return (
    <Modal titulo="Fechar caixa" onFechar={onFechar}>
      <form onSubmit={fechar} className="form">
        <p>Conte o dinheiro da gaveta e informe abaixo. Pix e cartão não entram nessa contagem.</p>
        <div className="linha-info"><span>Esperado em dinheiro</span><strong>{moeda(r.dinheiroEsperado)}</strong></div>
        <label>Dinheiro contado (R$)<input className="campo" autoFocus inputMode="decimal" placeholder="0,00" value={contado} onChange={(e) => setContado(e.target.value)} /></label>
        {dif !== null && (
          <div className={`linha-info ${dif < 0 ? 'texto-erro' : dif > 0 ? 'texto-alerta' : 'texto-ok'}`}>
            <span>{dif === 0 ? 'Bateu certinho!' : dif < 0 ? 'Faltando' : 'Sobrando'}</span>
            <strong>{moeda(Math.abs(dif))}</strong>
          </div>
        )}
        <label>Observação <small className="suave">(opcional)</small><input className="campo" value={obs} onChange={(e) => setObs(e.target.value)} /></label>
        <div className="form-acoes">
          <button type="button" className="btn btn-claro" onClick={onFechar}>Cancelar</button>
          <button className="btn btn-perigo">Fechar caixa</button>
        </div>
      </form>
    </Modal>
  );
}
