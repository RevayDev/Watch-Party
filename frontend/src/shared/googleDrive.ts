/** Convert only actual Google Drive hosts, preserving access resource keys. */
export function googleDriveDownload(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || !['drive.google.com', 'drive.usercontent.google.com'].includes(url.hostname)) return null;
    const id = url.pathname.match(/^\/file\/d\/([\w-]+)/)?.[1] ?? url.searchParams.get('id');
    if (!id || !/^[\w-]+$/.test(id)) return null;
    const download = new URL('https://drive.usercontent.google.com/download');
    download.searchParams.set('export', 'download');
    download.searchParams.set('id', id);
    download.searchParams.set('confirm', 't');
    const resourceKey = url.searchParams.get('resourcekey');
    if (resourceKey) download.searchParams.set('resourcekey', resourceKey);
    return download.href;
  } catch { return null; }
}
