import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    // Cada fichero aisla su módulo: el store en memoria no se comparte entre ficheros.
    isolate: true,
  },
});
