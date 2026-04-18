import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

console.log("%c ECHOVOX STARTING v1.0.6 ", "background: #ff4e00; color: white; font-weight: bold; padding: 4px;");

try {
  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error("Root element not found");
  
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} catch (e) {
  console.error("CRITICAL BOOT ERROR:", e);
  document.body.innerHTML = `<div style="background:black; color:red; padding:20px; font-family:sans-serif;">
    <h1>Critical Error</h1>
    <p>The application failed to start. Please check the console for details.</p>
    <pre>${e instanceof Error ? e.message : String(e)}</pre>
  </div>`;
}
