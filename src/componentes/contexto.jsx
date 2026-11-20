import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../util.js';

// ---------- avisos (toasts) ----------
const AvisoCtx = createContext(() => {});

export function AvisoProvider({ children }) {
  const [itens, setItens] = useState([]);
  const avisar = useCallback((msg, tipo = 'ok') => {
    const id = Math.random();
    setItens((l) => [...l, { id, msg, tipo }]);
    setTimeout(() => setItens((l) => l.filter((t) => t.id !== id)), tipo === 'erro' ? 5000 : 3000);
  }, []);
  return (
    <AvisoCtx.Provider value={avisar}>
      {children}
      <div className="avisos">
        {itens.map((t) => <div key={t.id} className={`aviso ${t.tipo}`}>{t.msg}</div>)}
      </div>
    </AvisoCtx.Provider>
  );
}
export const useAviso = () => useContext(AvisoCtx);

// ---------- configurações da loja ----------
const ConfigCtx = createContext({ config: null, recarregarConfig: async () => {} });

export function ConfigProvider({ children }) {
  const [config, setConfig] = useState(null);
  const avisar = useAviso();
  const recarregarConfig = useCallback(async () => {
    try {
      const c = await api('config.obter');
      setConfig(c);
      document.title = c.nome_loja || 'Sistema da Loja';
    } catch (e) {
      avisar(e.message, 'erro');
    }
  }, [avisar]);
  useEffect(() => { recarregarConfig(); }, [recarregarConfig]);
  return <ConfigCtx.Provider value={{ config, recarregarConfig }}>{children}</ConfigCtx.Provider>;
}
export const useConfig = () => useContext(ConfigCtx);

// ---------- senha do gerente ----------
// pedirSenha(motivo) -> Promise<string | null>. Resolve '' na hora se não há senha cadastrada,
// e null se o usuário desistir. Quem confere a senha é o backend.
const SenhaCtx = createContext(async () => '');

export function SenhaProvider({ children }) {
  const { config } = useConfig();
  const [pedido, setPedido] = useState(null); // { motivo }
  const [senha, setSenha] = useState('');
  const resolver = useRef(null);

  const pedirSenha = useCallback((motivo) => {
    if (!config?.temSenha) return Promise.resolve('');
    setSenha('');
    setPedido({ motivo });
    return new Promise((res) => { resolver.current = res; });
  }, [config]);

  function responder(valor) {
    resolver.current?.(valor);
    resolver.current = null;
    setPedido(null);
  }

  return (
    <SenhaCtx.Provider value={pedirSenha}>
      {children}
      {pedido && (
        <Modal titulo="Senha do gerente" onFechar={() => responder(null)} largura={380}>
          <form className="form" onSubmit={(e) => { e.preventDefault(); responder(senha); }}>
            <p>{pedido.motivo}</p>
            <input className="campo" type="password" autoFocus value={senha} onChange={(e) => setSenha(e.target.value)} />
            <div className="form-acoes">
              <button type="button" className="btn btn-claro" onClick={() => responder(null)}>Cancelar</button>
              <button className="btn btn-primario">Confirmar</button>
            </div>
          </form>
        </Modal>
      )}
    </SenhaCtx.Provider>
  );
}
export const useSenha = () => useContext(SenhaCtx);

// ---------- caixa atual (compartilhado entre as telas) ----------
const CaixaCtx = createContext({ caixa: null, carregado: false, recarregarCaixa: async () => {} });

export function CaixaProvider({ children }) {
  const [caixa, setCaixa] = useState(null);
  const [carregado, setCarregado] = useState(false);
  const avisar = useAviso();
  const recarregarCaixa = useCallback(async () => {
    try {
      setCaixa(await api('caixa.atual'));
    } catch (e) {
      avisar(e.message, 'erro');
    } finally {
      setCarregado(true);
    }
  }, [avisar]);
  useEffect(() => { recarregarCaixa(); }, [recarregarCaixa]);
  return <CaixaCtx.Provider value={{ caixa, carregado, recarregarCaixa }}>{children}</CaixaCtx.Provider>;
}
export const useCaixa = () => useContext(CaixaCtx);

// ---------- impressão ----------
// Imprime sem travar a tela; erro de impressão só avisa (a venda já está salva).
export function useImprimir() {
  const avisar = useAviso();
  return useCallback(async (metodo, id) => {
    try {
      await api(metodo, id);
    } catch (e) {
      avisar(e.message, 'erro');
    }
  }, [avisar]);
}
