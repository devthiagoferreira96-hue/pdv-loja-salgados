import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import {
  BookOpen, Boxes, DatabaseBackup, House, Receipt, Settings, ShoppingCart, UtensilsCrossed, Wallet,
} from 'lucide-react';
import { useState } from 'react';
import { useCaixa, useConfig } from './componentes/contexto.jsx';
import Backup from './componentes/Backup.jsx';
import { moeda } from './util.js';
import Inicio from './paginas/Inicio.jsx';
import Vender from './paginas/Vender.jsx';
import Vendas from './paginas/Vendas.jsx';
import Produtos from './paginas/Produtos.jsx';
import Estoque from './paginas/Estoque.jsx';
import Caixa from './paginas/Caixa.jsx';
import Fiado from './paginas/Fiado.jsx';
import Configuracoes from './paginas/Configuracoes.jsx';

const MENU = [
  { para: '/', nome: 'Início', Icone: House },
  { para: '/vender', nome: 'Vender', Icone: ShoppingCart },
  { para: '/vendas', nome: 'Vendas', Icone: Receipt },
  { para: '/produtos', nome: 'Produtos', Icone: UtensilsCrossed },
  { para: '/estoque', nome: 'Estoque', Icone: Boxes },
  { para: '/caixa', nome: 'Caixa', Icone: Wallet },
  { para: '/fiado', nome: 'Fiado', Icone: BookOpen },
  { para: '/configuracoes', nome: 'Configurações', Icone: Settings },
];

export default function App() {
  const { caixa } = useCaixa();
  const { config } = useConfig();
  const [backupAberto, setBackupAberto] = useState(false);

  return (
    <div className="app">
      <aside className="lateral">
        <div className="marca">
          {config?.logo && <img src={config.logo} alt="" />}
          <span>{config?.nome_loja || 'Sistema da Loja'}</span>
        </div>
        <nav>
          {MENU.map((m) => (
            <NavLink key={m.para} to={m.para} end={m.para === '/'} className="menu-item">
              <m.Icone className="icone" strokeWidth={2} /> {m.nome}
            </NavLink>
          ))}
        </nav>
        <div className="lateral-rodape">
          <div className={`status-caixa ${caixa ? 'aberto' : 'fechado'}`}>
            {caixa ? <>Caixa aberto<small>{moeda(caixa.vendas.total)} em vendas</small></> : 'Caixa fechado'}
          </div>
          <button className="btn btn-claro btn-bloco" onClick={() => setBackupAberto(true)}><DatabaseBackup className="icone" /> Fazer backup</button>
        </div>
      </aside>
      <main className="conteudo">
        <Routes>
          <Route path="/" element={<Inicio />} />
          <Route path="/vender" element={<Vender />} />
          <Route path="/vendas" element={<Vendas />} />
          <Route path="/produtos" element={<Produtos />} />
          <Route path="/estoque" element={<Estoque />} />
          <Route path="/caixa" element={<Caixa />} />
          <Route path="/fiado" element={<Fiado />} />
          <Route path="/configuracoes" element={<Configuracoes />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {backupAberto && <Backup onFechar={() => setBackupAberto(false)} />}
    </div>
  );
}
