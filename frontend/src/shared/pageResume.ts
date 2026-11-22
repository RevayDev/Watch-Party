/** Resume work after browser background throttling; hiding never means leaving. */
export function onPageResume(resume: () => void): () => void {
 const visible = () => { if (document.visibilityState !== 'hidden') resume(); };
 document.addEventListener('visibilitychange', visible);
 window.addEventListener('pageshow', visible);
 window.addEventListener('online', visible);
 return () => {
  document.removeEventListener('visibilitychange', visible);
  window.removeEventListener('pageshow', visible);
  window.removeEventListener('online', visible);
 };
}
