import { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from '../componentes/Modal.jsx';
import { useAviso } from '../componentes/contexto.jsx';
import { api, moeda, paraCampo, paraCentavos, semAcento } from '../util.js';

const VAZIO = {
  nome: '', categoria_id: '', preco: '', custo: '', codigo_barras: '',
  controla_estoque: true, estoque: '', estoque_minimo: '',
};

export default function Produtos() {
  const avisar = useAviso();
  const [produtos, setProdutos] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState('');
  const [inativos, setInativos] = useState(false);
  const [editando, setEditando] = useState(null);

  const carregar = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([api('produtos.listar', { incluirInativos: true }), api('categorias.listar')]);
      setProdutos(p);
      setCategorias(c);
    } catch (e) {
      avisar(e.message, 'erro');
    }
  }, [avisar]);
  useEffect(() => { carregar(); }, [carregar]);

  const lista = useMemo(() => {
    const t = semAcento(busca);
    return produtos.filter((p) => (inativos || p.ativo) &&
      (!categoria || p.categoria_id === Number(categoria)) &&
      (!t || semAcento(p.nome).includes(t) || p.codigo_barras === busca.trim()));
  }, [produtos, busca, categoria, inativos]);

  async function exemplos() {
    try {
      const n = await api('produtos.carregarExemplos');
      avisar(`${n} produtos de exemplo cadastrados.`);
      carregar();
    } catch (e) {
      avisar(e.message, 'erro');
    }
  }

  async function alternar(p) {
    try {
      await api('produtos.alternarAtivo', p.id);
      carregar();
    } catch (e) {
      avisar(e.message, 'erro');
    }
  }

  return (
    <div>
      <div className="cabecalho">
        <h1>Produtos</h1>
        <div className="acoes">
          {produtos.length === 0 && <button className="btn btn-claro" onClick={exemplos}>Carregar produtos de exemplo</button>}
          <button className="btn btn-primario" onClick={() => setEditando({ ...VAZIO, categoria_id: categorias[0]?.id ?? '' })}>+ Novo produto</button>
        </div>
      </div>

      <div className="filtros">
        <input className="campo" placeholder="Buscar por nome ou código" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <select className="campo" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
          <option value="">Todas as categorias</option>
          {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /> Mostrar inativos</label>
      </div>

      <section className="painel">
        <table className="tabela clicavel">
          <thead>
            <tr><th>Produto</th><th>Categoria</th><th className="num">Preço</th><th className="num">Custo</th><th className="num">Margem</th><th className="num">Estoque</th><th></th></tr>
          </thead>
          <tbody>
            {lista.map((p) => (
              <tr key={p.id} className={p.ativo ? '' : 'inativo'} onClick={() => setEditando({ ...p, preco: paraCampo(p.preco), custo: paraCampo(p.custo) })}>
                <td>{p.nome}{p.codigo_barras && <small className="suave"> · {p.codigo_barras}</small>}</td>
                <td>{p.categoria ?? '—'}</td>
                <td className="num">{moeda(p.preco)}</td>
                <td className="num suave">{p.custo ? moeda(p.custo) : '—'}</td>
                <td className="num suave">{p.custo && p.preco ? `${Math.round(((p.preco - p.custo) / p.preco) * 100)}%` : '—'}</td>
                <td className="num">{p.controla_estoque ? p.estoque : <span className="suave">não controla</span>}</td>
                <td className="num">
                  <button className="btn btn-claro btn-mini" onClick={(e) => { e.stopPropagation(); alternar(p); }}>
                    {p.ativo ? 'Desativar' : 'Reativar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {lista.length === 0 && <p className="vazio">Nenhum produto encontrado.</p>}
      </section>

      {editando && (
        <FormProduto
          inicial={editando}
          categorias={categorias}
          onFechar={() => setEditando(null)}
          onSalvo={() => { setEditando(null); carregar(); }}
        />
      )}
    </div>
  );
}

function FormProduto({ inicial, categorias, onFechar, onSalvo }) {
  const avisar = useAviso();
  const [f, setF] = useState({ ...inicial, controla_estoque: !!inicial.controla_estoque });
  const [salvando, setSalvando] = useState(false);
  const novo = !f.id;
  const campo = (nome) => (e) => setF({ ...f, [nome]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function salvar(e) {
    e.preventDefault();
    const preco = paraCentavos(f.preco);
    const custo = paraCentavos(f.custo);
    if (!Number.isFinite(preco) || preco <= 0) return avisar('Informe um preço válido.', 'erro');
    if (!Number.isFinite(custo) || custo < 0) return avisar('Custo inválido.', 'erro');
    setSalvando(true);
    try {
      await api('produtos.salvar', {
        id: f.id,
        nome: f.nome,
        categoria_id: f.categoria_id ? Number(f.categoria_id) : null,
        preco,
        custo,
        codigo_barras: f.codigo_barras,
        controla_estoque: f.controla_estoque,
        estoque: parseInt(f.estoque, 10) || 0,
        estoque_minimo: parseInt(f.estoque_minimo, 10) || 0,
      });
      avisar(novo ? 'Produto cadastrado.' : 'Produto atualizado.');
      onSalvo();
    } catch (err) {
      avisar(err.message, 'erro');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal titulo={novo ? 'Novo produto' : 'Editar produto'} onFechar={onFechar} largura={560}>
      <form onSubmit={salvar} className="form">
        <label>Nome<input className="campo" autoFocus value={f.nome} onChange={campo('nome')} /></label>
        <div className="form-linha">
          <label>Categoria
            <select className="campo" value={f.categoria_id ?? ''} onChange={campo('categoria_id')}>
              <option value="">Sem categoria</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
          <label>Código de barras <small className="suave">(opcional)</small>
            <input className="campo" value={f.codigo_barras ?? ''} onChange={campo('codigo_barras')} />
          </label>
        </div>
        <div className="form-linha">
          <label>Preço de venda (R$)<input className="campo" inputMode="decimal" placeholder="0,00" value={f.preco} onChange={campo('preco')} /></label>
          <label>Custo (R$) <small className="suave">(opcional)</small><input className="campo" inputMode="decimal" placeholder="0,00" value={f.custo} onChange={campo('custo')} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={f.controla_estoque} onChange={campo('controla_estoque')} /> Controlar estoque deste produto</label>
        {f.controla_estoque && (
          <div className="form-linha">
            {novo
              ? <label>Estoque inicial<input className="campo" inputMode="numeric" value={f.estoque} onChange={campo('estoque')} /></label>
              : <label>Estoque atual<input className="campo" disabled value={`${f.estoque} (altere na tela Estoque)`} /></label>}
            <label>Estoque mínimo (alerta)<input className="campo" inputMode="numeric" value={f.estoque_minimo} onChange={campo('estoque_minimo')} /></label>
          </div>
        )}
        <div className="form-acoes">
          <button type="button" className="btn btn-claro" onClick={onFechar}>Cancelar</button>
          <button className="btn btn-primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </Modal>
  );
}
