import React, { useState } from 'react';
import { Gift, Ticket } from 'lucide-react';
import { ApiService } from '../../services/api';
import { getOrCreateUserId } from '../../shared/utils';

/**
 * Canje de códigos de regalo debajo de los planes de apoyo.
 * Sin cuenta ni registro: el acceso queda asociado al nombre indicado.
 */
export const PremiumPurchase: React.FC = () => {
  const [code, setCode] = useState('');
  const [redeemState, setRedeemState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [redeemMessage, setRedeemMessage] = useState('');

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (redeemState === 'loading') return;
    const cleanCode = code.trim();
    if (!cleanCode) {
      setRedeemState('error');
      setRedeemMessage('Escribe el código de regalo para canjearlo.');
      return;
    }
    setRedeemState('loading');
    setRedeemMessage('');
    try {
      // El acceso se liga al userId estable de este navegador: el mismo que
      // usan crear/unirse a salas, así el premium aplica automáticamente.
      const result = await ApiService.redeemGiftCode({ code: cleanCode, userId: getOrCreateUserId() });
      setRedeemMessage(
        result.duplicate
          ? 'Ese código ya estaba canjeado a tu nombre. ¡Ya tienes el acceso!'
          : '¡Código canjeado! Tu acceso premium ya está activo.'
      );
      setRedeemState('done');
      setCode('');
    } catch (err) {
      setRedeemMessage(err instanceof Error ? err.message : 'No se pudo canjear el código.');
      setRedeemState('error');
    }
  };

  return (
    <div className="home-buy" aria-label="Canjear código de regalo">
      <p className="home-buy__subtitle">
        ¿Tienes un código de regalo? Canjéalo aquí para activar tu acceso premium.
      </p>
      <form className="home-buy__redeem" onSubmit={handleRedeem}>
        <span className="home-buy__icon" aria-hidden="true">
          <Ticket size={18} strokeWidth={2} />
        </span>
        <input
          type="text"
          className="home-buy__input"
          placeholder="Código de regalo (WATCH-XXXX-XXXX)"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-label="Código de regalo"
        />
        <button type="submit" className="home-hero-btn home-hero-btn--primary" disabled={redeemState === 'loading'}>
          <Gift size={15} aria-hidden="true" />
          <span>Canjear</span>
        </button>
      </form>
      {redeemMessage && (
        <p className={`home-buy__message home-buy__message--${redeemState}`} role="status">
          {redeemMessage}
        </p>
      )}
    </div>
  );
};

export default PremiumPurchase;
