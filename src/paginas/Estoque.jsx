import { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from '../componentes/Modal.jsx';
import { useAviso } from '../componentes/contexto.jsx';
import { api, dataHora, semAcento } from '../util.js';

const TIPOS = {
  entrada: { titulo: 'Entrada de estoque', rotulo: 'Quantidade que chegou / foi produzida' },
  perda: { titulo: 'Registrar perda', rotulo: 'Quantidade perdida (estragou, caiu, consumo)' },
  ajuste: { titulo: 'Ajustar estoque (contagem)', rotulo: 'Quantidade contada agora' },
};
const NOMES_MOV = { entrada: 'Entrada', perda: 'Perda', ajuste: 'Ajuste', venda: 'Venda', estorno: 'Cancelamento' };

export default function Estoque() {
  const avisar = useAviso();
  const [produtos, setProdutos] = useState([]);
  const [movimentos, setMovimentos] = useState([]);
  const [busca, setBusca] = useState('');
  const [soBaixo, setSoBaixo] = useState(false);
  const [acao, setAcao] = useState(null); // { produto, tipo }

  const carregar = useCallback(async () => {
    try {
      const [p, m] = await Promise.all([api('produtos.listar'), api('estoque.movimentos', { limite: 50 })]);
      setProdutos(p.filter((x) => x.controla_estoque));
      setMovimentos(m);
    } catch (e) {
      avisar(e.message, 'erro');
    }
  }, [avisar]);
  useEffect(() => { carregar(); }, [carregar]);

  const lista = useMemo(() => {
    const t = semAcento(busca);
    return produtos.filter((p) => (!t || semAcento(p.nome).includes(t)) && (!soBaixo || p.estoque <= p.estoque_minimo));
  }, [produtos, busca, soBaixo]);

  return (
    <div>
      <div className="cabecalho"><h1>Estoque</h1></div>

      <div className="filtros">
        <input className="campo" placeholder="Buscar produto" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <label className="check"><input type="checkbox" checked={soBaixo} onChange={(e) => setSoBaixo(e.target.checked)} /> Só estoque baixo</label>
      </div>

      <section className="painel">
        <table className="tabela">
          <thead><tr><th>Produto</th><th>Categoria</th><th className="num">Estoque</th><th className="num">Mínimo</th><th>Situação</th><th></th></tr></thead>
          <tbody>
            {lista.map((p) => (
              <tr key={p.id}>
                <td>{p.nome}</td>
                <td>{p.categoria ?? '—'}</td>
                <td className="num"><strong>{p.estoque}</strong></td>
                <td className="num suave">{p.estoque_minimo}</td>
                <td>
                  {p.estoque <= 0 ? <span className="etiqueta erro">Em falta</span>
                    : p.estoque <= p.estoque_minimo ? <span className="etiqueta alerta">Baixo</span>
                      : <span className="etiqueta ok">OK</span>}
                </td>
                <td className="num acoes-linha">
                  <button className="btn btn-primario btn-mini" onClick={() => setAcao({ produto: p, tipo: 'entrada' })}>+ Entrada</button>
                  <button className="btn btn-claro btn-mini" onClick={() => setAcao({ produto: p, tipo: 'perda' })}>Perda</button>
                  <button className="btn btn-claro btn-mini" onClick={() => setAcao({ produto: p, tipo: 'ajuste' })}>Ajustar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {lista.length === 0 && <p className="vazio">Nenhum produto com controle de estoque.</p>}
      </section>

      <section className="painel">
        <h2>Últimas movimentações</h2>
        {movimentos.length === 0 ? <p className="vazio">Nenhuma movimentação.</p> : (
          <table className="tabela">
            <thead><tr><th>Quando</th><th>Produto</th><th>Tipo</th><th className="num">Qtd</th><th className="num">Ficou</th><th>Observação</th></tr></thead>
            <tbody>
              {movimentos.map((m) => (
                <tr key={m.id}>
                  <td>{dataHora(m.criado_em)}</td>
                  <td>{m.produto}</td>
                  <td>{NOMES_MOV[m.tipo]}{m.venda_id ? ` #${m.venda_id}` : ''}</td>
                  <td className={`num ${m.quantidade < 0 ? 'texto-erro' : 'texto-ok'}`}>{m.quantidade > 0 ? '+' : ''}{m.quantidade}</td>
                  <td className="num">{m.estoque_apos}</td>
                  <td className="suave">{m.observacao}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {acao && <FormMovimento {...acao} onFechar={() => setAcao(null)} onSalvo={() => { setAcao(null); carregar(); }} />}
    </div>
  );
}

function FormMovimento({ produto, tipo, onFechar, onSalvo }) {
  const avisar = useAviso();
  const [qtd, setQtd] = useState(tipo === 'ajuste' ? String(produto.estoque) : '');
  const [obs, setObs] = useState('');

  async function salvar(e) {
    e.preventDefault();
    try {
      await api('estoque.movimentar', { produtoId: produto.id, tipo, quantidade: parseInt(qtd, 10), observacao: obs });
      avisar('Estoque atualizado.');
      onSalvo();
    } catch (err) {
      avisar(err.message, 'erro');
    }
  }

  return (
    <Modal titulo={TIPOS[tipo].titulo} onFechar={onFechar}>
      <form onSubmit={salvar} className="form">
        <p><strong>{produto.nome}</strong> — estoque atual: {produto.estoque}</p>
        <label>{TIPOS[tipo].rotulo}<input className="campo" autoFocus inputMode="numeric" value={qtd} onChange={(e) => setQtd(e.target.value)} /></label>
        <label>Observação <small className="suave">(opcional)</small><input className="campo" value={obs} onChange={(e) => setObs(e.target.value)} /></label>
        <div className="form-acoes">
          <button type="button" className="btn btn-claro" onClick={onFechar}>Cancelar</button>
          <button className="btn btn-primario">Salvar</button>
        </div>
      </form>
    </Modal>
  );
}
