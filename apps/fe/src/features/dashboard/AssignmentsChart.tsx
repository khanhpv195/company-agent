import type { DailyAssignments } from '@repo/shared';
import { useLayoutEffect, useRef, useState } from 'react';
import { C_DONE, C_FAIL } from '../tasks/tasks.logic';

const H = 230;
const L = 28;
const B = 26;
const T = 22;

const dayLabel = (days: DailyAssignments[], i: number) => {
  if (i === days.length - 1) return 'Hôm nay';
  const d = new Date(days[i].date);
  return `${d.getDate()}/${d.getMonth() + 1}`;
};

const topRound = (x: number, y0: number, w: number, h: number, r: number) =>
  `M${x} ${y0 + h}V${y0 + r}Q${x} ${y0} ${x + r} ${y0}H${x + w - r}Q${x + w} ${y0} ${x + w} ${y0 + r}V${y0 + h}Z`;

/** Stacked daily bars (completed + failed) with a hover tooltip. */
export function AssignmentsChart({ days }: { days: DailyAssignments[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = days.length;
  const peak = Math.max(...days.map((d) => d.completed + d.failed), 1);
  const max = Math.max(20, Math.ceil(peak / 5) * 5);
  const ticks = Array.from({ length: max / 5 + 1 }, (_, i) => i * 5);
  const slot = width > L ? (width - L) / n : 0;
  const bw = Math.min(24, slot * 0.56);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);

  const tipLeft = (i: number) => {
    const cx = L + slot * i + slot / 2;
    return cx + 16 + 150 > width ? cx - 16 - 150 : cx + 16;
  };
  const h = hover === null ? null : days[hover];

  return (
    <div ref={ref} className="chart" style={{ position: 'relative', height: H }}>
      {width > 0 && (
        <svg
          width={width}
          height={H}
          role="img"
          aria-label="Assignments 14 ngày: hoàn thành và lỗi theo ngày"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={L}
                x2={width}
                y1={y(t)}
                y2={y(t)}
                stroke={t ? '#f0efec' : '#d9d7d0'}
                strokeWidth="1"
              />
              <text x={L - 8} y={y(t) + 4} textAnchor="end">
                {t}
              </text>
            </g>
          ))}
          {days.map((d, i) => {
            const cx = L + slot * i + slot / 2;
            const x = cx - bw / 2;
            const yd = y(d.completed);
            const hd = y(0) - yd;
            const hf = y(0) - y(d.failed);
            const last = i === n - 1;
            return (
              <g key={d.date}>
                <rect
                  className="band"
                  x={L + slot * i}
                  y={T - 10}
                  width={slot}
                  height={H - T - B + 10}
                  rx="6"
                  fill={hover === i ? '#f5f4ef' : 'transparent'}
                  style={{ pointerEvents: 'all' }}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
                {d.failed ? (
                  <rect x={x} y={yd} width={bw} height={hd} fill={C_DONE} />
                ) : (
                  <path d={topRound(x, yd, bw, hd, Math.min(4, hd / 2))} fill={C_DONE} />
                )}
                {d.failed > 0 && (
                  <path
                    d={topRound(x, y(d.completed + d.failed) - 2, bw, hf, Math.min(4, hf / 2))}
                    fill={C_FAIL}
                  />
                )}
                {last && (
                  <text
                    x={cx}
                    y={y(d.completed + d.failed) - 9}
                    textAnchor="middle"
                    style={{ fill: 'var(--text)', fontWeight: 600 }}
                  >
                    {d.completed + d.failed}
                  </text>
                )}
                {i % 2 === 1 && (
                  <text
                    x={cx}
                    y={H - 6}
                    textAnchor="middle"
                    style={last ? { fill: 'var(--text)', fontWeight: 500 } : undefined}
                  >
                    {dayLabel(days, i)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {h && hover !== null && (
        <div
          className="tip"
          style={{ display: 'block', left: tipLeft(hover), top: 20, minWidth: 150 }}
        >
          <div style={{ color: '#bdbab1', marginBottom: 2 }}>{dayLabel(days, hover)}</div>
          <div>
            <i style={{ background: C_DONE }} />
            Hoàn thành<b>{h.completed}</b>
          </div>
          <div>
            <i style={{ background: C_FAIL }} />
            Lỗi<b>{h.failed}</b>
          </div>
          <div style={{ borderTop: '1px solid #3a3b3f', marginTop: 4, paddingTop: 4 }}>
            Tổng<b>{h.completed + h.failed}</b>
          </div>
        </div>
      )}
    </div>
  );
}

export function AssignmentsTable({ days }: { days: DailyAssignments[] }) {
  return (
    <div style={{ maxHeight: 230, overflow: 'auto' }}>
      <table className="dtable">
        <thead>
          <tr>
            <th>Ngày</th>
            <th style={{ textAlign: 'right' }}>Hoàn thành</th>
            <th style={{ textAlign: 'right' }}>Lỗi</th>
            <th style={{ textAlign: 'right' }}>Tổng</th>
          </tr>
        </thead>
        <tbody>
          {days
            .map((d, i) => (
              <tr key={d.date}>
                <td>{dayLabel(days, i)}</td>
                <td style={{ textAlign: 'right' }}>{d.completed}</td>
                <td style={{ textAlign: 'right' }}>{d.failed}</td>
                <td style={{ textAlign: 'right' }}>
                  <b>{d.completed + d.failed}</b>
                </td>
              </tr>
            ))
            .reverse()}
        </tbody>
      </table>
    </div>
  );
}
