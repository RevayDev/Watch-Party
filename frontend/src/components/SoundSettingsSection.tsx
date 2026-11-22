import { useSyncExternalStore } from 'react';
import { Button, Range } from '../shared/components/ui';
export type SoundPreferences = { gain: number; bass: number; balance: number };
let preferences: SoundPreferences = { gain: 100, bass: 0, balance: 0 };
const listeners = new Set<() => void>();
export function subscribeSound(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function getSound() { return preferences; }
export function updateSound(patch: Partial<SoundPreferences>) {
 preferences = { gain: Math.max(100, Math.min(600, patch.gain ?? preferences.gain)), bass: Math.max(-12, Math.min(12, patch.bass ?? preferences.bass)), balance: Math.max(-1, Math.min(1, patch.balance ?? preferences.balance)) };
 listeners.forEach(listener => listener());
 window.dispatchEvent(new Event('watch-party-sound'));
}
export function SoundSettingsSection() {
 const sound = useSyncExternalStore(subscribeSound, getSound);
 return <section className="room-settings__box"><h4>Sonido del video</h4>
 <p className="room-settings__box-desc">Ajustes personales para archivos y videos compatibles. YouTube y algunos enlaces externos no admiten estos efectos. El micrófono no cambia.</p>
 <div className="sound-settings__fields">
 <label>Amplificación · {sound.gain}%<Range aria-label="Amplificación del video" min={100} max={600} step={25} value={sound.gain} onChange={e => updateSound({ gain: Number(e.target.value) })} /></label>
 <label>Bajos · {sound.bass > 0 ? '+' : ''}{sound.bass} dB<Range aria-label="Bajos del video" min={-12} max={12} step={1} value={sound.bass} onChange={e => updateSound({ bass: Number(e.target.value) })} /></label>
 <label>Balance · {sound.balance === 0 ? 'Centro' : `${Math.round(Math.abs(sound.balance) * 100)}% ${sound.balance < 0 ? 'izquierda' : 'derecha'}`}<Range aria-label="Balance del video" min={-1} max={1} step={.05} value={sound.balance} onChange={e => updateSound({ balance: Number(e.target.value) })} /></label>
 </div><p className="room-settings__box-desc">Empieza con poco aumento. Si se distorsiona, reduce la ganancia o los bajos. Un limitador suaviza los picos.</p>
 <Button variant="secondary" onClick={() => updateSound({ gain: 100, bass: 0, balance: 0 })}>Restablecer sonido</Button>
 </section>;
}
