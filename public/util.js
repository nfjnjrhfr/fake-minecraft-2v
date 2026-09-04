export const $ = (sel, root = document) => root.querySelector(sel);

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/** 把十六進位色調亮或調暗，用來生成圖示的漸層 */
export function shade(hex, percent) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const mix = (channel) => {
    const v = percent < 0 ? channel * (1 + percent) : channel + (255 - channel) * percent;
    return Math.max(0, Math.min(255, Math.round(v)));
  };
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export const tint = (app) => `--c1:${app.color};--c2:${shade(app.color, -0.42)}`;

export const fmtSize = (mb) =>
  mb >= 1024 ? `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB` : `${mb} MB`;

/** 讀一張圖片並縮到合理大小，避免整張原圖塞進裝置狀態 */
export function readImageAsDataUrl(file, maxSide = 1400) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) return reject(new Error('請選一個圖片檔'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('讀不到這個檔案'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('這個圖片無法解碼'));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export async function api(path, { method = 'GET', body } = {}) {
  // 網頁版沒有伺服器，改用打包進來的本機狀態層
  if (globalThis.__TIDE_LOCAL_API__) return globalThis.__TIDE_LOCAL_API__(path, { method, body });
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `請求失敗（${res.status}）`);
  return data;
}
