import { useState } from 'react';
import { FileSpreadsheet, FileText, DatabaseBackup } from 'lucide-react';
import Modal from './Modal.jsx';
import { useAviso } from './contexto.jsx';
import { api } from '../util.js';

export default function Backup({ onFechar }) {
  const avisar = useAviso();
  const anoAtual = new Date().getFullYear();
  const [f, setF] = useState({ excel: true, pdf: true, banco: true, ano: anoAtual });
  const [gerando, setGerando] = useState(false);
  const marcar = (k) => (e) => setF({ ...f, [k]: e.target.checked });

  async function gerar() {
    setGerando(true);
    try {
      const r = await api('sistema.backup', f);
      if (r) {
        avisar(`Backup salvo: ${r.arquivos.length} arquivo(s) na pasta "${r.pasta.split(/[\\/]/).pop()}".`);
        onFechar();
      }
    } catch (e) {
      avisar(e.message, 'erro');
    } finally {
      setGerando(false);
    }
  }

  return (
    <Modal titulo="Fazer backup" onFechar={onFechar} largura={520}>
      <div className="form">
        <p className="suave">Escolha os formatos. Na próxima etapa você seleciona a pasta (pode ser um pendrive) e o sistema cria nela uma pasta com a data de hoje.</p>
        <label className="opcao-backup">
          <input type="checkbox" checked={f.excel} onChange={marcar('excel')} />
          <FileSpreadsheet className="icone" />
          <span><strong>Planilha Excel</strong><small>Resumo anual por mês, vendas por categoria e todas as vendas, produtos, fiado e caixas.</small></span>
        </label>
        <label className="opcao-backup">
          <input type="checkbox" checked={f.pdf} onChange={marcar('pdf')} />
          <FileText className="icone" />
          <span><strong>Relatório em PDF</strong><small>Para imprimir ou guardar: resumo do ano, categorias, estoque, fiado e caixas.</small></span>
        </label>
        <label className="opcao-backup">
          <input type="checkbox" checked={f.banco} onChange={marcar('banco')} />
          <DatabaseBackup className="icone" />
          <span><strong>Cópia para restauração</strong><small>Arquivo do banco de dados. É o único que permite recuperar o sistema se o computador der problema.</small></span>
        </label>
        {f.pdf && (
          <label>Ano do relatório em PDF
            <select className="campo" value={f.ano} onChange={(e) => setF({ ...f, ano: Number(e.target.value) })}>
              {Array.from({ length: 5 }, (_, i) => anoAtual - i).map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
        )}
        <div className="form-acoes">
          <button className="btn btn-claro" onClick={onFechar}>Cancelar</button>
          <button className="btn btn-primario" onClick={gerar} disabled={gerando || (!f.excel && !f.pdf && !f.banco)}>
            {gerando ? 'Gerando…' : 'Escolher pasta e salvar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
