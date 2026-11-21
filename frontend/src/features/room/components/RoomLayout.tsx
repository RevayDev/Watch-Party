import type { ReactNode } from 'react';

interface RoomLayoutProps {
  header: ReactNode;
  player: ReactNode;
  cameras: ReactNode;
  drawer?: ReactNode;
  controls: ReactNode;
  children?: ReactNode;
  uiPinned?: boolean;
  camerasCollapsed?: boolean;
}

export function RoomLayout({
  header, player, cameras, drawer, controls, children, uiPinned = true, camerasCollapsed = false,
}: RoomLayoutProps) {
  return (
    <div className={`meet-layout ${!uiPinned ? 'meet-layout--bars-hidden' : ''}`}>
      {header}
      <main className={`meet-stage ${camerasCollapsed ? 'meet-stage--cams-collapsed' : ''}`}>
        <section className="meet-stage__video-wrapper">{player}</section>
        {!camerasCollapsed && <aside className="meet-stage__cams-strip">{cameras}</aside>}
        {drawer}
      </main>
      {controls}
      {children}
    </div>
  );
}
