// @vitest-environment jsdom
import React from 'react';
import { act, render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { YouTubePlayerView } from '../src/features/player/YouTubePlayerView';

it('keeps the React container intact when YouTube replaces its target and the video is removed', async () => {
  const destroy = vi.fn();
  window.YT = { Player: class {
    constructor(id: string) {
      document.getElementById(id)!.replaceWith(document.createElement('iframe'));
    }
    destroy = destroy;
  } };
  try {
    const view = render(<YouTubePlayerView videoId="PW6ZSzdjrlo" />);
    await act(async () => {});
    expect(view.container.querySelector('div > iframe')).toBeTruthy();
    expect(() => view.unmount()).not.toThrow();
    expect(destroy).toHaveBeenCalledOnce();
  } finally { delete window.YT; }
});
