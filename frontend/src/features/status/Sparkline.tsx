import React, { useId } from 'react';

interface SparklineProps {
  /** Serie temporal (se dibuja tal cual, sin agregados inventados). */
  data: number[];
  /** Color de la línea (hereda del token de la card por defecto). */
  stroke?: string;
  width?: number;
  height?: number;
  label: string;
}

/**
 * Sparkline SVG hecha a mano (SIN librerías de charts): polyline normalizada
 * al min/max de la serie + punto en el último valor + área sutil.
 */
export const Sparkline: React.FC<SparklineProps> = ({
  data,
  stroke = '#818cf8',
  width = 220,
  height = 48,
  label,
}) => {
  const gradientId = useId();
  const clean = data.filter((n) => Number.isFinite(n));
  if (clean.length === 0) {
    return (
      <p className="sparkline__empty" role="img" aria-label={`${label}: sin datos todavía`}>
        Sin datos todavía
      </p>
    );
  }
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const pad = 4;
  const stepX = clean.length > 1 ? (width - pad * 2) / (clean.length - 1) : 0;
  const points = clean.map((v, i) => {
    const x = pad + i * stepX;
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = points[points.length - 1].split(',');
  const area = `M${pad},${height - pad} L${points.join(' L')} L${(pad + (clean.length - 1) * stepX).toFixed(1)},${height - pad} Z`;

  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${label}: ${clean[clean.length - 1]} (último)`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} stroke="none" />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={Number(last[0])} cy={Number(last[1])} r="3" fill={stroke} />
    </svg>
  );
};

export default Sparkline;
