// Chamada ao processo principal do Electron. Lança Error com mensagem amigável.
export async function api(metodo, ...args) {
  if (!window.api) throw new Error('Abra o sistema pelo aplicativo (npm run dev).');
  const r = await window.api.call(metodo, args);
  if (!r.ok) throw new Error(r.erro);
  return r.dados;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const moeda = (centavos) => BRL.format((centavos || 0) / 100);

// "5,50" | "5.50" | "1.234,56" -> centavos. Vazio -> 0. Inválido -> NaN.
export function paraCentavos(valor) {
  const s = String(valor ?? '').replace(/[R$\s]/g, '');
  if (!s) return 0;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
export const paraCampo = (centavos) => ((centavos || 0) / 100).toFixed(2).replace('.', ',');

export function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// "2026-11-18 14:05:00" -> "18/11 14:05"
export function dataHora(s, { ano = false } = {}) {
  if (!s) return '';
  const [d, h] = s.split(' ');
  const [a, m, dia] = d.split('-');
  return `${dia}/${m}${ano ? '/' + a : ''} ${h?.slice(0, 5) ?? ''}`.trim();
}
export const dataBR = (s) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '');

export const semAcento = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const FORMAS = [
  { id: 'dinheiro', nome: 'Dinheiro' },
  { id: 'pix', nome: 'Pix' },
  { id: 'debito', nome: 'Débito' },
  { id: 'credito', nome: 'Crédito' },
  { id: 'fiado', nome: 'Fiado' },
];
export const nomeForma = (id) => (id === 'misto' ? 'Misto' : FORMAS.find((f) => f.id === id)?.nome ?? id);
// Para uma venda da lista: "Pix + Dinheiro" quando o pagamento foi dividido.
export const nomeFormas = (v) => (v.formas ? v.formas.split('+').map(nomeForma).join(' + ') : nomeForma(v.forma_pagamento));
