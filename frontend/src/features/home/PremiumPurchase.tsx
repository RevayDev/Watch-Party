import React, { useEffect, useState } from 'react';
import { BadgeCheck, ExternalLink, Gift, Loader2, Ticket } from 'lucide-react';
import { ApiService } from '../../services/api';

interface PlanInfo {
  id: string;
  name: string;
  amount: number;
  currency: string;
}

/**
 * Compra inmediata al inicio de la sección de planes: tarjeta premium con
 * precio y botón de compra (checkout → PayPal), más canje de códigos de
 * regalo. Sin cuenta ni registro: el acceso queda asociado al nombre o sala
 * que se indique al canjear.
 */
export const PremiumPurchase: React.FC = () => {
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [buyState, setBuyState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [buyMessage, setBuyMessage] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [redeemState, setRedeemState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [redeemMessage, setRedeemMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    ApiService.getPlans()
      .then((data) => {
        if (cancelled) return;
        const premium =
          data.plans.find((p) => /premium/i.test(p.id) || /premium/i.test(p.name)) ??
          data.plans[0] ??
          null;
        setPlan(premium);
      })
      .catch(() => {
        if (!cancelled) setPlan(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleBuy = async () => {
    if (!plan || buyState === 'loading') return;
    setBuyState('loading');
    setBuyMessage('');
    try {
      const result = await ApiService.createCheckout({ provider: 'paypal', plan: plan.id });
      if (result.approveUrl) {
        window.open(result.approveUrl, '_blank', 'noopener,noreferrer');
        setBuyMessage(
          'Pago iniciado en PayPal. Al completarlo, tu acceso premium se activa automáticamente.'
        );
      } else {
        setBuyMessage(result.message || 'Compra registrada. Te avisaremos cuando se confirme el pago.');
      }
      setBuyState('done');
    } catch (err) {
      setBuyMessage(err instanceof Error ? err.message : 'No se pudo iniciar la compra.');
      setBuyState('error');
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
      <article className="home-buy__card">
        <span className="home-buy__icon" aria-hidden="true">
          <BadgeCheck size={20} strokeWidth={2} />
        </span>
        <div className="home-buy__info">
          <h3 className="home-buy__title">
            {plan ? `${plan.name} — ${plan.amount} ${plan.currency}` : 'Sala premium'}
          </h3>
          <p className="home-buy__desc">
            Hasta 10 usuarios por sala. Pago único por PayPal, sin cuenta.
          </p>
        </div>
        <button
          type="button"
          className="home-hero-btn home-hero-btn--primary home-buy__cta"
          onClick={handleBuy}
          disabled={!plan || buyState === 'loading'}
        >
          {buyState === 'loading' ? (
            <Loader2 size={15} className="animate-spin" aria-hidden="true" />
          ) : (
            <ExternalLink size={15} aria-hidden="true" />
          )}
          <span>{buyState === 'loading' ? 'Abriendo PayPal…' : 'Comprar ahora'}</span>
        </button>
      </article>
      {buyMessage && (
        <p className={`home-buy__message home-buy__message--${buyState}`} role="status">
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
