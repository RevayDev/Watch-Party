const fs = require('fs');
let file = fs.readFileSync('src/types/room.ts', 'utf8');

const replacement = [
  '/** Entrada de la cola musical. */',
  'export interface IMusicQueueEntry {',
  '  id: string;',
  '  trackId: string;',
  '  name: string;',
  '  artists: string;',
  '  albumArt?: string;',
  '  durationMs?: number;',
  '  uri?: string;',
  '  openUrl?: string;',
  '  proposedBy: string;',
  '  votes: string[];',
  '  status: "queued" | "pending";',
  '}',
  '',
  '/** Lo que suena ahora (cola musical). */',
  'export interface IMusicNowPlaying {',
  '  id: string;',
  '  trackId: string;',
  '  name: string;',
  '  artists: string;',
  '  albumArt?: string;',
  '  durationMs?: number;',
  '  uri?: string;',
  '  openUrl?: string;',
  '  proposedBy: string;',
  '  votes: string[];',
  '  status: "queued" | "pending";',
  '  startedAt?: string;',
  '}'
].join('\r\n');

file = file.replace('/** Entrada de la cola musical. */\r\n\r\n', replacement + '\r\n\r\n');
if (!file.includes('IMusicQueueEntry')) {
  file = file.replace('/** Entrada de la cola musical. */\n\n', replacement + '\n\n');
}

fs.writeFileSync('src/types/room.ts', file, 'utf8');
console.log('Updated types successfully');
