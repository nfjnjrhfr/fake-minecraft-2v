/** 即時速度曲線圖（下載與上傳各一條）。 */
const COLORS = { download: '--accent', upload: '--up' };

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function createChart(canvas) {
  const ctx = canvas.getContext('2d');
  const series = { download: [], upload: [] };

  const fit = () => {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const draw = () => {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (!w || !h) return;

    ctx.clearRect(0, 0, w, h);

    const all = [...series.download, ...series.upload];
    const peak = Math.max(1, ...all);
    const top = peak * 1.15;
    const padding = { left: 44, right: 10, top: 12, bottom: 18 };
    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;
    const count = Math.max(series.download.length, series.upload.length, 2);

    ctx.strokeStyle = cssVar('--line');
    ctx.fillStyle = cssVar('--muted');
    ctx.lineWidth = 1;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= 4; i += 1) {
      const y = padding.top + (plotH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();
      const label = (top * (1 - i / 4));
      ctx.fillText(label >= 100 ? label.toFixed(0) : label.toFixed(1), padding.left - 8, y);
    }

    for (const key of ['download', 'upload']) {
      const data = series[key];
      if (data.length < 2) continue;
      ctx.strokeStyle = cssVar(COLORS[key]);
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      data.forEach((v, i) => {
        const x = padding.left + (plotW * i) / (count - 1);
        const y = padding.top + plotH * (1 - Math.min(v, top) / top);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  };

  fit();
  draw();
  window.addEventListener('resize', () => { fit(); draw(); });

  return {
    push(key, mbps) {
      series[key].push(mbps);
      draw();
    },
    reset() {
      series.download = [];
      series.upload = [];
      fit();
      draw();
    },
  };
}
