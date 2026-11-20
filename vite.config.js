import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// CSP só no build: o servidor de dev do Vite precisa de scripts inline.
const csp = {
  name: 'csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace(
    '<head>',
    `<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:" />`,
  ),
};

export default defineConfig({
  plugins: [react(), csp],
  base: './', // caminhos relativos para funcionar via file:// no Electron
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
