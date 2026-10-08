import React, { useState } from 'react';

/** Emojis principales (incluye chispa ✨ y saturno 🪐 en la misma fila + clásicos). */
export const MAIN_EMOJIS = ['✨', '🪐', '❤️', '😂', '😮', '👏', '🔥', '🍿'];
/** Fila desplegable / invertida (temáticos florales/rosas). */
export const EXTRA_EMOJIS = ['🩷', '🌹', '🌸', '🌷', '🎀'];

interface ReactionsProps {
  onReact: (emoji: string) => void;
}

export const Reactions: React.FC<ReactionsProps> = ({ onReact }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="reactions-bar" role="toolbar" aria-label="Reacciones">
      <div className="reactions-bar__row">
        {MAIN_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="reactions-bar__btn"
            onClick={() => onReact(emoji)}
            title={`Reaccionar con ${emoji}`}
            aria-label={`Reaccionar con ${emoji}`}
          >
            {emoji}
          </button>
        ))}
        <button
          type="button"
          className="reactions-bar__btn reactions-bar__more-btn"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Mostrar menos reacciones' : 'Mostrar más reacciones'}
          aria-label={expanded ? 'Mostrar menos reacciones' : 'Mostrar más reacciones'}
          aria-expanded={expanded}
        >
          {expanded ? '−' : '+'}
        </button>
      </div>
      {expanded && (
        <div className="reactions-bar__row reactions-bar__row--extra">
          {EXTRA_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="reactions-bar__btn"
              onClick={() => onReact(emoji)}
              title={`Reaccionar con ${emoji}`}
              aria-label={`Reaccionar con ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

