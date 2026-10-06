import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
    cssCodeSplit: true,
    chunkSizeWarningLimit: 600,
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'socket-vendor': ['socket.io-client'],
          'hls-vendor': ['hls.js'],
          'icons-vendor': ['lucide-react'],
        },
      },
    },
  },
  server: {
    host: true, // Permite conexiones desde teléfonos y otros dispositivos en la misma red Wi-Fi
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
