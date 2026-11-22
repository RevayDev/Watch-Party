import type { ReactNode } from 'react';
export function ConnectionCard({ children, title = 'Entrando a la sala' }: { children: ReactNode; title?: string }) {
 return <div className="room-loading"><section className="room-connection-card" aria-label="Conexión de la sala"><h2>{title}</h2>{children}</section></div>;
}
