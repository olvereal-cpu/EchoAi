import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Настройка алиаса @ для удобных путей
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Критически важно для исправления ошибки "import.meta"
    target: 'esnext', 
    outDir: 'dist',
    sourcemap: true
  },
  server: {
    port: 3000,
    host: '0.0.0.0'
  }
});
