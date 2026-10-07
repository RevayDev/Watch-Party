import React, { useEffect, useState } from 'react';
import { BadgeCheck, Clock, ExternalLink, Gift, Loader2, Ticket, Users } from 'lucide-react';
import { ApiService } from '../../services/api';

interface PlanInfo {
  id: string;
  name: string;
  amount: number;
  currency: string;
  maxUsers?: number;
  durationHours?: number;
  tagline?: string;
}

/**
 * Compra inmediata al inicio de la sección de planes: niveles con precio,
 * capacidad y duración, cada uno con su botón hacia la pasarela de pago
 * (checkout → PayPal). Debajo, el canje de códigos de regalo.
 * Sin cuenta ni registro: el acceso queda asociado al nombre indicado.
 */
export const PremiumPurchase: React.FC = () => {
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [buyerName, setBuyerName] = useState('');
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [buyMessage, setBuyMessage] = useState('');
  const [buyOk, setBuyOk] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [redeemState, setRedeemState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [redeemMessage, setRedeemMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    ApiService.getPlans()
      .then((data) => {
        if (!cancelled) setPlans(data.plans ?? []);
      })
      .catch(() => {
        if (!cancelled) setPlans([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleBuy = async (plan: PlanInfo) => {
    if (buyingId) return;
    const cleanName = buyerName.trim();
    if (!cleanName) {
      setBuyOk(false);
      setBuyMessage('Escribe tu nombre para asociar la compra a tu acceso.');
      return;
    }
    setBuyingId(plan.id);
    setBuyMessage('');
    try {
      const result = await ApiService.createCheckout({
        provider: 'paypal',
        plan: plan.id,
        userId: cleanName,
      });
      if (result.approveUrl) {
        window.open(result.approveUrl, '_blank', 'noopener,noreferrer');
        setBuyMessage(
          'Pago iniciado en PayPal. Al completarlo, tu acceso premium se activa automáticamente.'
        );
      } else {
        setBuyMessage(result.message || 'Compra registrada. Te avisaremos cuando se confirme el pago.');
      }
      setBuyOk(true);
    } catch (err) {
      setBuyOk(false);
      setBuyMessage(err instanceof Error ? err.message : 'No se pudo iniciar la compra.');
    } finally {
      setBuyingId(null);
    }
  };

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (redeemState === 'loading') return;
    const cleanCode = code.trim();
    const cleanName = name.trim();
    if (!cleanCode || !cleanName) {
      setRedeemState('error');
      setRedeemMessage('Escribe el código y tu nombre para asociar el acceso.');
      return;
    }
    setRedeemState('loading');
    setRedeemMessage('');
    try {
      const result = await ApiService.redeemGiftCode({ code: cleanCode, userName: cleanName });
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
    <div className="home-buy" aria-label="Comprar acceso premium">
      <div className="home-buy__plans">
        {plans.map((plan) => (
          <article key={plan.id} className="home-buy__card">
            <span className="home-buy__icon" aria-hidden="true">
              <BadgeCheck size={20} strokeWidth={2} />
            </span>
            <div className="home-buy__info">
              <h3 className="home-buy__title">
                {plan.name} — {plan.amount} {plan.currency}
              </h3>
              <p className="home-buy__desc">
                {typeof plan.maxUsers === 'number' && (
                  <span className="home-buy__spec">
                    <Users size={13} aria-hidden="true" /> Hasta {plan.maxUsers} personas
                  </span>
                )}
                {typeof plan.durationHours === 'number' && (
                  <span className="home-buy__spec">
                    <Clock size={13} aria-hidden="true" /> {plan.durationHours} horas por sala
                  </span>
                )}
              </p>
              {plan.tagline && <p className="home-buy__tagline">{plan.tagline}</p>}
            </div>
            <button
              type="button"
              className="home-hero-btn home-hero-btn--primary home-buy__cta"
              onClick={() => handleBuy(plan)}
              disabled={buyingId !== null}
            >
              {buyingId === plan.id ? (
                <Loader2 size={15} className="animate-spin" aria-hidden="true" />
              ) : (
                <ExternalLink size={15} aria-hidden="true" />
              )}
              <span>{buyingId === plan.id ? 'Abriendo PayPal…' : 'Comprar ahora'}</span>
            </button>
          </article>
        ))}
      </div>

      <div className="home-buy__nameline">
        <label className="home-buy__namelabel" htmlFor="home-buy-name">
          Tu nombre (para asociar la compra a tu acceso)
        </label>
        <input
          id="home-buy-name"
          type="text"
          className="home-buy__input"
          placeholder="Ej. Roberto"
          value={buyerName}
          onChange={(e) => setBuyerName(e.target.value)}
        />
      </div>
      {buyMessage && (
        <p className={`home-buy__message home-buy__message--${buyOk ? 'done' : 'error'}`} role="status">
          {buyMessage}
        </p>
      )}

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
        <input
          type="text"
          className="home-buy__input"
          placeholder="Tu nombre"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Tu nombre"
        />
        <button type="submit" className="home-hero-btn home-hero-btn--secondary" disabled={redeemState === 'loading'}>
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
