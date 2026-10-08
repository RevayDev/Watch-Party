import React from 'react';

export interface ChartDatum {
  label: string;
  value: number;
}

interface AdminBarChartProps {
  data: ChartDatum[];
  label: string;
  color?: string;
  formatValue?: (v: number) => string;
}

const BAR_W = 640;
const BAR_H = 180;
const PAD = 28;

/**
 * Barras SVG hechas a mano (SIN librerías): agregados del admin por día/mes.
 * Si no hay datos, se dice explícitamente (jamás se inventan).
 */
export const AdminBarChart: React.FC<AdminBarChartProps> = ({
  data,
  label,
  color = '#818cf8',
  formatValue = (v) => String(v),
}) => {
  if (data.length === 0) {
    return (
      <p className="admin-chart__empty" role="img" aria-label={`${label}: sin datos`}>
        Sin datos para este rango
      </p>
    );
  }
  const max = Math.max(...data.map((d) => d.value), 0) || 1;
  const slot = (BAR_W - PAD * 2) / data.length;
  const barW = Math.max(4, Math.min(44, slot * 0.6));
  const total = data.reduce((acc, d) => acc + d.value, 0);

  return (
    <svg
      className="admin-chart"
      viewBox={`0 0 ${BAR_W} ${BAR_H}`}
      role="img"
      aria-label={`${label}: ${data.length} puntos, total ${formatValue(total)}, máximo ${formatValue(max)}`}
    >
      <text x={BAR_W - 8} y={14} textAnchor="end" fontSize="11" fontWeight="700" fill="#e2e8f0">
        {`Total ${formatValue(total)} · Máx ${formatValue(max)}`}
      </text>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line
          key={f}
          x1={PAD}
          x2={BAR_W - 8}
          y1={BAR_H - PAD - f * (BAR_H - PAD * 2)}
          y2={BAR_H - PAD - f * (BAR_H - PAD * 2)}
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="1"
        />
      ))}
      {data.map((d, i) => {
        const h = (d.value / max) * (BAR_H - PAD * 2);
        const x = PAD + i * slot + (slot - barW) / 2;
        const y = BAR_H - PAD - h;
        return (
          <g key={`${d.label}-${i}`}>
            <title>{`${d.label}: ${formatValue(d.value)}`}</title>
            <rect x={x} y={y} width={barW} height={Math.max(h, 2)} rx="4" fill={color} opacity={d.value === 0 ? 0.25 : 0.9} />
            {slot > 44 && (
              <text x={x + barW / 2} y={Math.max(y - 5, 24)} textAnchor="middle" fontSize="10" fontWeight="700" fill="#e2e8f0">
                {formatValue(d.value)}
              </text>
            )}
            {slot > 34 && (
              <text x={x + barW / 2} y={BAR_H - 10} textAnchor="middle" fontSize="10" fill="#94a3b8">
                {d.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
};

interface AdminLineChartProps {
  data: ChartDatum[];
  label: string;
  color?: string;
  formatValue?: (v: number) => string;
}

/** Línea SVG hecha a mano (tráfico por minuto, conexiones, etc.). */
export const AdminLineChart: React.FC<AdminLineChartProps> = ({ data, label, color = '#34d399', formatValue = (v) => String(Math.round(v * 100) / 100) }) => {
  if (data.length === 0) {
    return (
      <p className="admin-chart__empty" role="img" aria-label={`${label}: sin datos`}>
        Sin datos todavía
      </p>
    );
  }
  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 640;
  const h = 140;
  const pad = 24;
  const stepX = data.length > 1 ? (w - pad * 2) / (data.length - 1) : 0;
  const pts = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const lastX = pad + (values.length - 1) * stepX;
  const lastY = h - pad - ((values[values.length - 1] - min) / span) * (h - pad * 2);
  return (
    <svg
      className="admin-chart"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`${label}: actual ${formatValue(values[values.length - 1])}, mínimo ${formatValue(min)}, máximo ${formatValue(max)}`}
      preserveAspectRatio="none"
    >
      <text x={pad} y={14} textAnchor="start" fontSize="11" fontWeight="700" fill="#e2e8f0">
        {`Actual ${formatValue(values[values.length - 1])} · Mín ${formatValue(min)} · Máx ${formatValue(max)}`}
      </text>
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {pts.map((pt, i) => {
        const [x, y] = pt.split(',');
        return <circle key={i} cx={Number(x)} cy={Number(y)} r="2.5" fill={color} opacity="0.7" />;
      })}
      <circle cx={lastX} cy={lastY} r="4" fill={color} />
      <text
        x={Math.min(lastX + 8, w - 8)}
        y={Math.max(lastY - 8, 26)}
        textAnchor={lastX + 8 > w - 8 ? 'end' : 'start'}
        fontSize="11"
        fontWeight="700"
        fill="#ffffff"
      >
        {formatValue(values[values.length - 1])}
      </text>
    </svg>
  );
};

export default AdminBarChart;
