import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { AvisoProvider, CaixaProvider, ConfigProvider, SenhaProvider } from './componentes/contexto.jsx';
// Fontes embutidas no app (funcionam sem internet)
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import './estilo.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <AvisoProvider>
        <ConfigProvider>
          <SenhaProvider>
            <CaixaProvider>
              <App />
            </CaixaProvider>
          </SenhaProvider>
        </ConfigProvider>
      </AvisoProvider>
    </HashRouter>
  </StrictMode>,
);
