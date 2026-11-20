import { ShoppingCart } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAviso, useCaixa } from '../componentes/contexto.jsx';
import { api, dataHora, moeda, nomeFormas } from '../util.js';

export default function Inicio() {
  const [p, setP] = useState(null);
  const { caixa } = useCaixa();
  const avisar = useAviso();

  useEffect(() => {
    api('relatorios.painel').then(setP).catch((e) => avisar(e.message, 'erro'));
  }, [avisar]);

  if (!p) return <div className="carregando">Carregando…</div>;
  const h = p.hoje;

  return (
    <div>
      <div className="cabecalho">
        <h1>Hoje</h1>
        <Link to={caixa ? '/vender' : '/caixa'} className="btn btn-primario btn-grande">
          {caixa ? '🛒 Nova venda' : 'Abrir o caixa'}
        </Link>
      </div>

      <div className="cartoes">
        <div className="cartao destaque"><span>Vendido hoje</span><strong>{moeda(h.total)}</strong></div>
        <div className="cartao"><span>Vendas</span><strong>{h.quantidade}</strong></div>
        <div className="cartao"><span>Ticket médio</span><strong>{moeda(h.ticketMedio)}</strong></div>
        <div className="cartao"><span>Fiado a receber</span><strong>{moeda(p.fiadoAReceber)}</strong></div>
      </div>

      <div className="grade-2">
        <section className="painel">
          <h2>Mais vendidos hoje</h2>
          {h.maisVendidos.length === 0 ? <p className="vazio">Nenhuma venda ainda.</p> : (
            <table className="tabela">
              <tbody>
                {h.maisVendidos.map((m) => (
                  <tr key={m.nome}><td>{m.nome}</td><td className="num">{m.qtd} un</td><td className="num">{moeda(m.total)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="painel">
          <h2>Estoque baixo {p.estoqueBaixo.length > 0 && <span className="etiqueta alerta">{p.estoqueBaixo.length}</span>}</h2>
          {p.estoqueBaixo.length === 0 ? <p className="vazio">Tudo em ordem.</p> : (
            <table className="tabela">
              <tbody>
                {p.estoqueBaixo.slice(0, 8).map((e) => (
                  <tr key={e.id}>
                    <td>{e.nome}</td>
                    <td className={`num ${e.estoque <= 0 ? 'texto-erro' : 'texto-alerta'}`}>{e.estoque} un</td>
                    <td className="num suave">mín. {e.estoque_minimo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {p.estoqueBaixo.length > 0 && <Link to="/estoque" className="link">Ver estoque →</Link>}
        </section>
      </div>

      <section className="painel">
        <h2>Últimas vendas</h2>
        {p.ultimasVendas.length === 0 ? <p className="vazio">Nenhuma venda hoje.</p> : (
          <table className="tabela">
            <thead><tr><th>#</th><th>Hora</th><th>Itens</th><th>Pagamento</th><th className="num">Total</th></tr></thead>
            <tbody>
              {p.ultimasVendas.map((v) => (
                <tr key={v.id} className={v.status === 'cancelada' ? 'cancelada' : ''}>
                  <td>{v.id}</td>
                  <td>{dataHora(v.criado_em).split(' ')[1]}</td>
                  <td className="corta">{v.resumo}</td>
                  <td>{nomeFormas(v)}{v.cliente ? ` · ${v.cliente}` : ''}</td>
                  <td className="num">{moeda(v.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
