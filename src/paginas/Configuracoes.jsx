import { useEffect, useState } from 'react';
import { useAviso, useConfig, useSenha } from '../componentes/contexto.jsx';
import { api } from '../util.js';

// Reduz a imagem escolhida para no máximo 400x200 e devolve um data URL PNG.
function lerLogo(arquivo) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    leitor.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Arquivo de imagem inválido.'));
      img.onload = () => {
        const escala = Math.min(1, 400 / img.width, 200 / img.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * escala);
        canvas.height = Math.round(img.height * escala);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = leitor.result;
    };
    leitor.readAsDataURL(arquivo);
  });
}

export default function Configuracoes() {
  const { config, recarregarConfig } = useConfig();
  const avisar = useAviso();
  const pedirSenha = useSenha();
  const [f, setF] = useState(null);
  const [impressoras, setImpressoras] = useState([]);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { if (config) setF({ ...config }); }, [config]);
  useEffect(() => {
    api('impressao.impressoras').then(setImpressoras).catch((e) => avisar(e.message, 'erro'));
  }, [avisar]);

  if (!f) return <div className="carregando">Carregando…</div>;
  const campo = (n) => (e) => setF({ ...f, [n]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function escolherLogo(e) {
    const arq = e.target.files?.[0];
    e.target.value = '';
    if (!arq) return;
    try {
      setF({ ...f, logo: await lerLogo(arq) });
    } catch (err) {
      avisar(err.message, 'erro');
    }
  }

  async function salvar() {
    const senha = await pedirSenha('Confirme a senha para alterar as configurações.');
    if (senha === null) return false;
    setSalvando(true);
    try {
      const { temSenha, ...dados } = f;
      await api('config.salvar', { dados, senha });
      await recarregarConfig();
      avisar('Configurações salvas.');
      return true;
    } catch (err) {
      avisar(err.message, 'erro');
      return false;
    } finally {
      setSalvando(false);
    }
  }

  async function imprimirTeste() {
    if (!(await salvar())) return;
    try {
      await api('impressao.teste');
    } catch (err) {
      avisar(err.message, 'erro');
    }
  }

  return (
    <div>
      <div className="cabecalho">
        <h1>Configurações</h1>
        <button className="btn btn-primario" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar alterações'}</button>
      </div>

      <div className="grade-2">
        <section className="painel">
          <h2>Dados da loja</h2>
          <p className="suave">Aparecem no topo do sistema e no cupom impresso.</p>
          <div className="form">
            <label>Nome da loja<input className="campo" value={f.nome_loja} onChange={campo('nome_loja')} /></label>
            <label>Endereço<input className="campo" value={f.endereco} onChange={campo('endereco')} /></label>
            <div className="form-linha">
              <label>Telefone / WhatsApp<input className="campo" value={f.telefone} onChange={campo('telefone')} /></label>
              <label>CNPJ ou CPF <small className="suave">(opcional)</small><input className="campo" value={f.documento} onChange={campo('documento')} /></label>
            </div>
            <label>Mensagem no fim do cupom<input className="campo" placeholder="Ex.: Obrigado e volte sempre!" value={f.mensagem_cupom} onChange={campo('mensagem_cupom')} /></label>
            <div>
              <strong className="rotulo">Logo</strong>
              <div className="logo-config">
                <div className="logo-previa">{f.logo ? <img src={f.logo} alt="Logo" /> : <span className="suave">Sem logo</span>}</div>
                <div className="acoes">
                  <label className="btn btn-claro">
                    Escolher imagem
                    <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={escolherLogo} />
                  </label>
                  {f.logo && <button className="btn btn-claro" onClick={() => setF({ ...f, logo: '' })}>Remover</button>}
                </div>
              </div>
            </div>
          </div>
        </section>

        <div>
          <section className="painel">
            <h2>Impressão do cupom</h2>
            <div className="form">
              <label>Impressora
                <select className="campo" value={f.impressora} onChange={campo('impressora')}>
                  <option value="">Perguntar sempre (abre a janela de impressão)</option>
                  {impressoras.map((p) => <option key={p.nome} value={p.nome}>{p.descricao}</option>)}
                  {f.impressora && !impressoras.some((p) => p.nome === f.impressora) && (
                    <option value={f.impressora}>{f.impressora} (não encontrada)</option>
                  )}
                </select>
              </label>
              <label>Largura do papel
                <select className="campo" value={f.papel} onChange={campo('papel')}>
                  <option value="80">80 mm (mais comum)</option>
                  <option value="58">58 mm (impressoras pequenas)</option>
                </select>
              </label>
              <label className="check">
                <input type="checkbox" checked={f.imprimir_auto} onChange={campo('imprimir_auto')} />
                Imprimir cupom automaticamente ao finalizar a venda e o fechamento ao fechar o caixa
              </label>
              <div><button className="btn btn-claro" onClick={imprimirTeste}>Salvar e imprimir teste</button></div>
            </div>
          </section>

          <Senha temSenha={config.temSenha} onAlterada={recarregarConfig} />
        </div>
      </div>
    </div>
  );
}

function Senha({ temSenha, onAlterada }) {
  const avisar = useAviso();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirma, setConfirma] = useState('');

  async function salvar(e, remover = false) {
    e.preventDefault();
    if (!remover && !nova) return avisar('Digite a nova senha.', 'erro');
    if (!remover && nova !== confirma) return avisar('A confirmação não confere com a nova senha.', 'erro');
    try {
      await api('config.definirSenha', { senhaAtual: atual, novaSenha: remover ? '' : nova });
      setAtual(''); setNova(''); setConfirma('');
      avisar(remover ? 'Senha removida.' : 'Senha salva.');
      onAlterada();
    } catch (err) {
      avisar(err.message, 'erro');
    }
  }

  return (
    <section className="painel">
      <h2>Senha do gerente {temSenha ? <span className="etiqueta ok">ativa</span> : <span className="etiqueta alerta">sem senha</span>}</h2>
      <p className="suave">Pedida para cancelar vendas, fechar o caixa e alterar estas configurações.</p>
      <form className="form" onSubmit={salvar}>
        {temSenha && <label>Senha atual<input className="campo" type="password" value={atual} onChange={(e) => setAtual(e.target.value)} /></label>}
        <div className="form-linha">
          <label>{temSenha ? 'Nova senha' : 'Senha'}<input className="campo" type="password" value={nova} onChange={(e) => setNova(e.target.value)} /></label>
          <label>Repita a senha<input className="campo" type="password" value={confirma} onChange={(e) => setConfirma(e.target.value)} /></label>
        </div>
        <div className="form-acoes">
          {temSenha && <button type="button" className="btn btn-claro" onClick={(e) => salvar(e, true)}>Remover senha</button>}
          <button className="btn btn-primario">{temSenha ? 'Trocar senha' : 'Criar senha'}</button>
        </div>
      </form>
    </section>
  );
}
