/**
 * 半圓儀表。刻度採非線性（各刻度等距排列），
 * 這樣 5 Mbps 和 500 Mbps 才能在同一個表面上都看得清楚。
 */
const START_DEG = -135;
const SWEEP_DEG = 270;
const RADIUS = 118;
const CENTER = 150;
const TICKS = [0, 1, 5, 10, 25, 50, 100, 250, 500, 1000];

const polar = (deg, r) => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [CENTER + r * Math.cos(rad), CENTER + r * Math.sin(rad)];
};

const arcPath = (fromDeg, toDeg, r) => {
  const [x0, y0] = polar(fromDeg, r);
  const [x1, y1] = polar(toDeg, r);
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

/** 把速度換算成 0~1 的表面位置（在刻度之間線性內插）。 */
export function scalePosition(value) {
  const v = Math.max(0, value);
  const last = TICKS.length - 1;
  if (v >= TICKS[last]) return 1;
  for (let i = 0; i < last; i += 1) {
    const lo = TICKS[i];
    const hi = TICKS[i + 1];
    if (v <= hi) return (i + (v - lo) / (hi - lo)) / last;
  }
  return 1;
}

export function createGauge(svg) {
  const track = svg.querySelector('.gauge__track');
  const value = svg.querySelector('.gauge__value');
  const ticks = svg.querySelector('.gauge__ticks');
  const path = arcPath(START_DEG, START_DEG + SWEEP_DEG, RADIUS);

  track.setAttribute('d', path);
  value.setAttribute('d', path);

  const total = track.getTotalLength();
  value.style.strokeDasharray = `0 ${total}`;

  const ns = 'http://www.w3.org/2000/svg';
  TICKS.forEach((tick, i) => {
    const deg = START_DEG + (SWEEP_DEG * i) / (TICKS.length - 1);
    const [x1, y1] = polar(deg, RADIUS - 13);
    const [x2, y2] = polar(deg, RADIUS - 20);
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', x1.toFixed(2));
    line.setAttribute('y1', y1.toFixed(2));
    line.setAttribute('x2', x2.toFixed(2));
    line.setAttribute('y2', y2.toFixed(2));
    ticks.appendChild(line);

    const [tx, ty] = polar(deg, RADIUS - 33);
    const label = document.createElementNS(ns, 'text');
    label.setAttribute('x', tx.toFixed(2));
    label.setAttribute('y', ty.toFixed(2));
    label.textContent = String(tick);
    ticks.appendChild(label);
  });

  return {
    set(mbps) {
      const filled = total * scalePosition(mbps);
      value.style.strokeDasharray = `${filled.toFixed(2)} ${total}`;
    },
    reset() {
      value.style.strokeDasharray = `0 ${total}`;
    },
  };
}
