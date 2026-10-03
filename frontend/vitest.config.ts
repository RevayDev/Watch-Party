import { defineConfig } from 'vitest/config';

// NOTA: se usa environment 'node' a propósito (sin jsdom) para no agregar
// librerías pesadas. Los tests cubren utilidades puras (recentRooms, ApiService
// con fetch mockeado) e inyectan un mock mínimo de `localStorage` en el
// propio test. Si en el futuro se quieren testear componentes React/hooks,
// habrá que añadir `jsdom` + `@testing-library/react`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 10000,
  },
});
