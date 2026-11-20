import { useEffect } from 'react';

export default function Modal({ titulo, onFechar, children, largura = 480 }) {
  useEffect(() => {
    const tecla = (e) => { if (e.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onFechar]);

  return (
    <div className="modal-fundo" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div className="modal" style={{ width: largura }}>
        <div className="modal-topo">
          <h3>{titulo}</h3>
          <button className="btn-icone" onClick={onFechar} aria-label="Fechar">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
