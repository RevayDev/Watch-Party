import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Alcance de jsdom: solo los tests DOM lo usan. environmentMatchGlobs
    // documenta la intención, pero en vitest 5.0.3 (Windows) no se aplica;
    // el mecanismo efectivo es el pragma `// @vitest-environment jsdom`
    // en la primera línea de cada test DOM (ver PREGUNTAS del reporte).
    environmentMatchGlobs: [
      ['**/WaitingApproval.test.tsx', 'jsdom'],
      ['**/useRoomSocket.test.ts', 'jsdom'],
      ['**/usePresence.test.ts', 'jsdom'],
      ['**/socket-singleton.test.ts', 'jsdom'],
      ['**/uploadVideo.test.ts', 'jsdom'],
    ],
    globals: true,
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    testTimeout: 10000,
  },
});
