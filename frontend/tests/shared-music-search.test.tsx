// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { YouTubeSearch } from '../src/features/room/components/YouTubeSearch';
afterEach(cleanup);
it('shows room search results and publishes a shared reset when a result is queued', () => {
 const onAdd = vi.fn(), onShareSearch = vi.fn();
 render(<YouTubeSearch onAdd={onAdd} onShareSearch={onShareSearch} sharedSearch={{ id: 'shared', query: 'Song', tracks: [{ id: 'abcdefghijk', name: 'Song', artists: 'Artist' }] }} />);
 expect(screen.getByRole('searchbox')).toHaveValue('Song');
 fireEvent.click(screen.getByRole('button', { name: 'Añadir Song a la cola' }));
 expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 'abcdefghijk' }));
 expect(onShareSearch).toHaveBeenCalledWith(expect.objectContaining({ query: '', tracks: null }));
 expect(screen.queryByRole('list')).toBeNull();
});
it('does not overwrite a locally typed query when an identical snapshot arrives', () => {
 const shared = { id: 'shared', query: '', tracks: null };
 const view = render(<YouTubeSearch onAdd={vi.fn()} sharedSearch={shared} />);
 fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'typing' } });
 view.rerender(<YouTubeSearch onAdd={vi.fn()} sharedSearch={{ ...shared }} />);
 expect(screen.getByRole('searchbox')).toHaveValue('typing');
});
