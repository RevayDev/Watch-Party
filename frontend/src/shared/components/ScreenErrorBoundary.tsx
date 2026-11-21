import { Component, type ReactNode } from 'react';

/** Keeps a failed lazy import or render from leaving the application blank. */
export class ScreenErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="room-loading" role="alert">
        <h2>No se pudo cargar esta pantalla</h2>
        <p>Comprueba que el servidor siga encendido y vuelve a cargar la página.</p>
        <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>Volver a cargar</button>
        <a href="/" className="btn btn--secondary">Volver al inicio</a>
      </main>
    );
  }
}
