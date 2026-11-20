import { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from '../componentes/Modal.jsx';
import { useAviso, useCaixa } from '../componentes/contexto.jsx';
import { api, dataHora, FORMAS, moeda, paraCampo, paraCentavos, semAcento } from '../util.js';

const NOMES_LANC = { compra: 'Compra', pagamento: 'Pagamento', estorno: 'Estorno' };

export default function Fiado() {
  const avisar = useAviso();
  const [clientes, setClientes] = useState([]);
  const [busca, setBusca] = useState('');
  const [soDevedores, setSoDevedores] = useState(false);
  const [editando, setEditando] = useState(null);
  const [extratoId, setExtratoId] = useState(null);

  const carregar = useCallback(async () => {
    try {
      setClientes(await api('clientes.listar'));
    } catch (e) {
      avisar(e.message, 'erro');
    }
  }, [avisar]);
  useEffect(() => { carregar(); }, [carregar]);

  const lista = useMemo(() => {
    const t = semAcento(busca);
    return clientes.filter((c) => (!t || semAcento(c.nome).includes(t) || (c.telefone || '').includes(busca)) && (!soDevedores || c.saldo > 0));
  }, [clientes, busca, soDevedores]);
  const totalAReceber = clientes.reduce((s, c) => s + Math.max(0, c.saldo), 0);

  return (
    <div>
      <div className="cabecalho">
        <h1>Fiado <small className="suave">· a receber {moeda(totalAReceber)}</small></h1>
        <button className="btn btn-primario" onClick={() => setEditando({ nome: '', telefone: '', observacao: '' })}>+ Novo cliente</button>
      </div>

      <div className="filtros">
        <input className="campo" placeholder="Buscar por nome ou telefone" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <label className="check"><input type="checkbox" checked={soDevedores} onChange={(e) => setSoDevedores(e.target.checked)} /> Só quem está devendo</label>
      </div>

      <section className="painel">
        <table className="tabela clicavel">
          <thead><tr><th>Cliente</th><th>Telefone</th><th>Observação</th><th className="num">Saldo</th></tr></thead>
          <tbody>
            {lista.map((c) => (
              <tr key={c.id} onClick={() => setExtratoId(c.id)}>
                <td>{c.nome}</td>
                <td>{c.telefone}</td>
                <td className="suave corta">{c.observacao}</td>
                <td className={`num ${c.saldo > 0 ? 'texto-erro' : c.saldo < 0 ? 'texto-ok' : 'suave'}`}>
                  {c.saldo > 0 ? `deve ${moeda(c.saldo)}` : c.saldo < 0 ? `crédito ${moeda(-c.saldo)}` : 'em dia'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {lista.length === 0 && <p className="vazio">Nenhum cliente encontrado.</p>}
      </section>

      {editando && (
        <FormCliente inicial={editando} onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); carregar(); }} />
      )}
      {extratoId && (
        <Extrato
          id={extratoId}
          onFechar={() => { setExtratoId(null); carregar(); }}
          onEditar={(c) => { setExtratoId(null); setEditando(c); }}
        />
      )}
    </div>
  );
}

function FormCliente({ inicial, onFechar, onSalvo }) {
  const avisar = useAviso();
  const [f, setF] = useState(inicial);
  const campo = (n) => (e) => setF({ ...f, [n]: e.target.value });

  async function salvar(e) {
    e.preventDefault();
    try {
      await api('clientes.salvar', f);
      avisar(f.id ? 'Cliente atualizado.' : 'Cliente cadastrado.');
      onSalvo();
    } catch (err) {
      avisar(err.message, 'erro');
    }
  }

  return (
    <Modal titulo={f.id ? 'Editar cliente' : 'Novo cliente'} onFechar={onFechar}>
      <form onSubmit={salvar} className="form">
        <label>Nome<input className="campo" autoFocus value={f.nome} onChange={campo('nome')} /></label>
        <label>Telefone<input className="campo" value={f.telefone ?? ''} onChange={campo('telefone')} /></label>
        <label>Observação<input className="campo" placeholder="Ex.: trabalha na clínica" value={f.observacao ?? ''} onChange={campo('observacao')} /></label>
        <div className="form-acoes">
          <button type="button" className="btn btn-claro" onClick={onFechar}>Cancelar</button>
          <button className="btn btn-primario">Salvar</button>
        </div>
      </form>
    </Modal>
  );
}

function Extrato({ id, onFechar, onEditar }) {
  const avisar = useAviso();
  const { caixa, recarregarCaixa } = useCaixa();
  const [dados, setDados] = useState(null);
  const [valor, setValor] = useState('');
  const [forma, setForma] = useState('dinheiro');

  const carregar = useCallback(async () => {
    try {
      const d = await api('clientes.extrato', id);
      setDados(d);
      setValor(d.cliente.saldo > 0 ? paraCampo(d.cliente.saldo) : '');
    } catch (e) {
      avisar(e.message, 'erro');
    }
  }, [id, avisar]);
  useEffect(() => { carregar(); }, [carregar]);

  async function receber(e) {
    e.preventDefault();
    const c = paraCentavos(valor);
    if (!Number.isFinite(c) || c <= 0) return avisar('Valor inválido.', 'erro');
    try {
      await api('clientes.receber', { clienteId: id, valor: c, formaPagamento: forma });
      avisar(`Recebido ${moeda(c)}.`);
      carregar();
      recarregarCaixa();
    } catch (err) {
      avisar(err.message, 'erro');
    }
  }

  async function alternar() {
    try {
      await api('clientes.alternarAtivo', id);
      avisar('Cliente desativado.');
      onFechar();
    } catch (err) {
      avisar(err.message, 'erro');
    }
  }

  if (!dados) return null;
  const { cliente, lancamentos } = dados;

  return (
    <Modal titulo={cliente.nome} onFechar={onFechar} largura={640}>
      <div className="linha-info">
        <span>{cliente.telefone || 'Sem telefone'}</span>
        <strong className={cliente.saldo > 0 ? 'texto-erro' : 'texto-ok'}>
          {cliente.saldo > 0 ? `Deve ${moeda(cliente.saldo)}` : cliente.saldo < 0 ? `Crédito ${moeda(-cliente.saldo)}` : 'Em dia'}
        </strong>
      </div>

      {cliente.saldo > 0 && (
        caixa ? (
          <form onSubmit={receber} className="form-linha recebimento">
            <label>Receber (R$)<input className="campo" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></label>
            <label>Forma
              <select className="campo" value={forma} onChange={(e) => setForma(e.target.value)}>
                {FORMAS.filter((f) => f.id !== 'fiado').map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            </label>
            <button className="btn btn-primario">Receber</button>
          </form>
        ) : <p className="texto-alerta">Abra o caixa para receber pagamentos.</p>
      )}

      <h3>Histórico</h3>
      {lancamentos.length === 0 ? <p className="vazio">Nenhum lançamento.</p> : (
        <table className="tabela">
          <tbody>
            {lancamentos.map((l) => (
              <tr key={l.id}>
                <td>{dataHora(l.criado_em, { ano: true })}</td>
                <td>{NOMES_LANC[l.tipo]}</td>
                <td className="suave">{l.descricao}</td>
                <td className={`num ${l.tipo === 'compra' ? 'texto-erro' : 'texto-ok'}`}>{l.tipo === 'compra' ? '+' : '−'}{moeda(l.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="form-acoes">
        <button className="btn btn-claro" onClick={alternar}>Desativar cliente</button>
        <button className="btn btn-claro" onClick={() => onEditar(cliente)}>Editar dados</button>
      </div>
    </Modal>
  );
}
