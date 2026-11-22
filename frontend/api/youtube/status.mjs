export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });
  return res.status(200).json({ configured: !!process.env.YOUTUBE_API_KEY?.trim() });
}
