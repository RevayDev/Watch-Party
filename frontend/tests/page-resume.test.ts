// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { onPageResume } from '../src/shared/pageResume';
afterEach(() => vi.restoreAllMocks());
it('does not treat hiding as exit and recovers on foreground, pageshow and online', () => {
 const resume = vi.fn();
 const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
 const stop = onPageResume(resume);
 document.dispatchEvent(new Event('visibilitychange'));
 expect(resume).not.toHaveBeenCalled();
 state.mockReturnValue('visible');
 document.dispatchEvent(new Event('visibilitychange'));
 window.dispatchEvent(new Event('pageshow'));
 window.dispatchEvent(new Event('online'));
 expect(resume).toHaveBeenCalledTimes(3);
 stop(); window.dispatchEvent(new Event('online'));
 expect(resume).toHaveBeenCalledTimes(3);
});
