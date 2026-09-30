import React from 'react';

const EMOJIS = ['❤️', '😂', '😮', '👏', '🔥', '🍿'];

interface ReactionsProps {
  onReact: (emoji: string) => void;
}

export const Reactions: React.FC<ReactionsProps> = ({ onReact }) => {
  return (
    <div className="reactions-bar">
      {EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="reactions-bar__btn"
          onClick={() => onReact(emoji)}
          title={`Reaccionar con ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
};
