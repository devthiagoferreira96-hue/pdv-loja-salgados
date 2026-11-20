const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const db = require('./db.cjs');
const servicos = require('./servicos.cjs');
const impressao = require('./impressao.cjs');
const backup = require('./backup.cjs');

const DEV_URL = process.env.VITE_DEV_SERVER_URL;

// Só uma instância: duas janelas gravando o mesmo banco perderiam dados.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let janela = null;

// Métodos expostos à tela, no formato "modulo.metodo".
const metodos = {};
for (const [modulo, funcoes] of Object.entries(servicos)) {
  if (typeof funcoes !== 'object' || Array.isArray(funcoes)) continue;
  for (const [nome, fn] of Object.entries(funcoes)) {
    if (typeof fn === 'function') metodos[`${modulo}.${nome}`] = fn;
  }
}

// Gera uma pasta "Backup <loja> <data hora>" com Excel, PDF e/ou cópia do banco (.db, para restaurar).
metodos['sistema.backup'] = async ({ excel = true, pdf = true, banco = true, ano } = {}) => {
  if (!excel && !pdf && !banco) throw erroAmigavel('Escolha pelo menos um formato.');
  const { canceled, filePaths } = await dialog.showOpenDialog(janela, {
    title: 'Escolha a pasta onde salvar o backup',
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths?.[0]) return null;

  const cfg = servicos.config.obter();
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const carimbo = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}h${p2(d.getMinutes())}`;
  const loja = (cfg.nome_loja || 'Loja').replace(/[\\/:*?"<>|]+/g, '').trim() || 'Loja';
  const nome = `Backup ${loja} ${carimbo}`;
  const pasta = path.join(filePaths[0], nome);
  fs.mkdirSync(pasta, { recursive: true });

  const dados = servicos.relatorios.backup({ ano });
  const arquivos = [];
  if (excel) {
    const arq = path.join(pasta, `${nome}.xlsx`);
    fs.writeFileSync(arq, await backup.gerarExcel(dados, cfg));
    arquivos.push(arq);
  }
  if (pdf) {
    const arq = path.join(pasta, `${nome}.pdf`);
    fs.writeFileSync(arq, await htmlParaPdf(backup.gerarHtml(dados, cfg), cfg.nome_loja));
    arquivos.push(arq);
  }
  if (banco) {
    db.salvar();
    const arq = path.join(pasta, `${nome} (restauração).db`);
    fs.copyFileSync(db.caminhoArquivo(), arq);
    arquivos.push(arq);
  }
  shell.openPath(pasta);
  return { pasta, arquivos };
};

// Renderiza HTML numa janela oculta e devolve o PDF (A4 deitado, com número de página).
async function htmlParaPdf(html, loja) {
  const tmp = path.join(app.getPath('temp'), `backup-${Date.now()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await w.loadFile(tmp);
    const nome = String(loja || '').replace(/[&<>"']/g, '');
    return await w.webContents.printToPDF({
      landscape: true,
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.4, bottom: 0.5, left: 0.4, right: 0.4 },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="font-size:7px;width:100%;text-align:center;color:#555;font-family:Arial">${nome} — página <span class="pageNumber"></span> de <span class="totalPages"></span></div>`,
    });
  } finally {
    w.destroy();
    fs.rmSync(tmp, { force: true });
  }
}

// ---------- impressão ----------
function erroAmigavel(msg) {
  const e = new Error(msg);
  e.amigavel = true;
  return e;
}

// Com impressora configurada imprime direto (silencioso); sem ela, abre a janela de impressão do Windows.
async function imprimir(html) {
  const cfg = servicos.config.obter();
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await new Promise((resolve, reject) => {
      const opcoes = { silent: !!cfg.impressora, printBackground: true, margins: { marginType: 'none' } };
      if (cfg.impressora) opcoes.deviceName = cfg.impressora;
      w.webContents.print(opcoes, (ok, motivo) => {
        if (ok) resolve();
        else if (motivo === 'cancelled') reject(erroAmigavel('Impressão cancelada.'));
        else reject(erroAmigavel(`Não foi possível imprimir (${motivo}). Confira a impressora em Configurações.`));
      });
    });
    return true;
  } finally {
    w.destroy();
  }
}

metodos['impressao.impressoras'] = async () => {
  const lista = await janela.webContents.getPrintersAsync();
  return lista.map((p) => ({ nome: p.name, descricao: p.displayName || p.name }));
};
metodos['impressao.venda'] = (id) => imprimir(impressao.cupomVenda(servicos.vendas.detalhe(id), servicos.config.obter()));
metodos['impressao.fechamento'] = (caixaId) => imprimir(impressao.fechamento(servicos.caixa.resumo(caixaId), servicos.config.obter()));
metodos['impressao.teste'] = () => imprimir(impressao.teste(servicos.config.obter()));

ipcMain.handle('api', async (_evento, metodo, args = []) => {
  const fn = metodos[metodo];
  if (!fn) return { ok: false, erro: `Método desconhecido: ${metodo}` };
  try {
    return { ok: true, dados: await fn(...args) };
  } catch (e) {
    console.error(`[${metodo}]`, e);
    return { ok: false, erro: e.amigavel ? e.message : `Erro inesperado: ${e.message}` };
  }
});

function criarJanela() {
  janela = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'Sistema da Loja',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  janela.once('ready-to-show', () => {
    janela.maximize();
    janela.show();
  });
  if (DEV_URL) janela.loadURL(DEV_URL);
  else janela.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.on('second-instance', () => {
  if (janela) {
    if (janela.isMinimized()) janela.restore();
    janela.focus();
  }
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const arquivo = path.join(app.getPath('userData'), 'loja.db');
  try {
    if (fs.existsSync(arquivo)) {
      // cópia antes de migrar/abrir, caso algo dê errado
      fs.copyFileSync(arquivo, path.join(app.getPath('userData'), 'loja.anterior.db'));
    }
    await db.abrir(arquivo);
  } catch (e) {
    dialog.showErrorBox('Erro ao abrir o banco de dados', `${arquivo}\n\n${e.message}`);
    app.quit();
    return;
  }
  criarJanela();
});

app.on('window-all-closed', () => app.quit());
