import React, { useEffect, useRef } from 'react';

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<void> | null = null;

export function loadYouTubeIframeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (!ytApiPromise) {
    ytApiPromise = new Promise((resolve) => {
      const existing = document.getElementById('yt-iframe-api');
      if (!existing) {
        const tag = document.createElement('script');
        tag.id = 'yt-iframe-api';
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
      }
      const prevCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prevCallback === 'function') prevCallback();
        resolve();
      };
      if (window.YT && window.YT.Player) {
        resolve();
      }
    });
  }
  return ytApiPromise;
}

export interface YouTubePlayerViewProps {
  videoId: string;
  onReady?: (player: any) => void;
  onStateChange?: (event: { data: number }) => void;
  className?: string;
}

/**
 * Componente que monta el IFrame oficial de YouTube con API JS habilitada.
 */
export const YouTubePlayerView: React.FC<YouTubePlayerViewProps> = ({
  videoId,
  onReady,
  onStateChange,
  className = 'player-container__video',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const onReadyRef = useRef(onReady);
  const onStateChangeRef = useRef(onStateChange);
  onReadyRef.current = onReady;
  onStateChangeRef.current = onStateChange;

  useEffect(() => {
    let active = true;
    const elemId = `yt-player-${Math.random().toString(36).slice(2, 9)}`;
    if (containerRef.current) {
      containerRef.current.id = elemId;
    }

    loadYouTubeIframeApi().then(() => {
      if (!active || !containerRef.current || !window.YT) return;
      try {
        playerRef.current = new window.YT.Player(elemId, {
          videoId,
          playerVars: {
            autoplay: 1,
            controls: 1,
            enablejsapi: 1,
            modestbranding: 1,
            rel: 0,
            origin: window.location.origin,
          },
          events: {
            onReady: (event: any) => {
              if (active) onReadyRef.current?.(event.target);
            },
            onStateChange: (event: any) => {
              if (active) onStateChangeRef.current?.(event);
            },
          },
        });
      } catch (err) {
        console.warn('Error inicializando YouTube Player API:', err);
      }
    });

    return () => {
      active = false;
      try {
        if (playerRef.current?.destroy) {
          playerRef.current.destroy();
          playerRef.current = null;
        }
      } catch {
        /* noop */
      }
    };
  }, [videoId]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: '100%', height: '100%', border: 'none' }}
    />
  );
};
