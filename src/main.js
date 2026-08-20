import { PROVIDERS, DEFAULTS } from './config.js';
import { runSpeedTest } from './speedtest.js';
import { createGauge } from './gauge.js';
import { createChart } from './chart.js';

const $ = (id) => document.getElementById(id);

const els = {
  start: $('startBtn'),
  phase: $('phaseLabel'),
  live: $('liveValue'),
  ping: $('pingValue'),
  jitter: $('jitterValue'),
  download: $('downloadValue'),
  upload: $('uploadValue'),
  status: $('status'),
  server: $('serverSelect'),
  serverHint: $('serverHint'),
  duration: $('durationInput'),
  durationOut: $('durationOut'),
  streams: $('streamsInput'),
  streamsOut: $('streamsOut'),
  uploadToggle: $('uploadToggle'),
  historySection: $('historySection'),
  historyBody: $('historyBody'),
  clearHistory: $('clearHistory'),
};

const gauge = createGauge(document.querySelector('.gauge__svg'));
const chart = createChart($('chart'));

const PHASE_TEXT = {
  idle: '準備就緒',
  ping: '測量延遲',
  download: '下載中',
  upload: '上傳中',
  done: '完成',
};

const FAILURE_HINT = '請確認網路連線；若本頁是嵌在其他網站或平台裡，'
  + '對外的測速請求可能被該站的安全政策（CSP）擋下，'
  + '此時請把這個 HTML 檔下載到本機開啟，或放到自己的伺服器上使用。';

const SETTINGS_KEY = 'speedtest:settings';
const HISTORY_KEY = 'speedtest:history';

const readJSON = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const writeJSON = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 無痕模式等情況下寫不進去，忽略即可 */
  }
};

const fmtSpeed = (mbps) => {
  if (!Number.isFinite(mbps)) return '—';
  if (mbps >= 100) return mbps.toFixed(0);
  if (mbps >= 10) return mbps.toFixed(1);
  return mbps.toFixed(2);
};

const fmtMs = (ms) => (Number.isFinite(ms) ? ms.toFixed(ms < 10 ? 1 : 0) : '—');

function setStatus(text, kind = '') {
  els.status.textContent = text;
  els.status.dataset.kind = kind;
}

function setActiveCard(metric) {
  document.querySelectorAll('.card').forEach((card) => {
    card.dataset.active = String(card.dataset.metric === metric);
  });
}

/* ---------- 設定 ---------- */

const settings = { ...DEFAULTS, ...readJSON(SETTINGS_KEY, {}) };
if (!PROVIDERS[settings.provider]) settings.provider = DEFAULTS.provider;

// 直接用 file:// 開啟時沒有本機伺服器可用，預設改走 Cloudflare。
if (location.protocol === 'file:' && settings.provider === 'local') {
  settings.provider = 'cloudflare';
}

function applySettingsToUI() {
  els.server.value = settings.provider;
  els.duration.value = settings.duration;
  els.durationOut.textContent = settings.duration;
  els.streams.value = settings.streams;
  els.streamsOut.textContent = settings.streams;
  els.uploadToggle.checked = settings.includeUpload;
  els.serverHint.textContent = PROVIDERS[settings.provider].hint;
}

function saveSettings() {
  writeJSON(SETTINGS_KEY, {
    provider: settings.provider,
    duration: settings.duration,
    streams: settings.streams,
    includeUpload: settings.includeUpload,
  });
}

els.server.addEventListener('change', () => {
  settings.provider = els.server.value;
  els.serverHint.textContent = PROVIDERS[settings.provider].hint;
  saveSettings();
});

els.duration.addEventListener('input', () => {
  settings.duration = Number(els.duration.value);
  els.durationOut.textContent = settings.duration;
  saveSettings();
});

els.streams.addEventListener('input', () => {
  settings.streams = Number(els.streams.value);
  els.streamsOut.textContent = settings.streams;
  saveSettings();
});

els.uploadToggle.addEventListener('change', () => {
  settings.includeUpload = els.uploadToggle.checked;
  saveSettings();
});

/* ---------- 歷史紀錄 ---------- */

function renderHistory() {
  const history = readJSON(HISTORY_KEY, []);
  els.historySection.hidden = history.length === 0;
  els.historyBody.innerHTML = '';

  for (const entry of history) {
    const tr = document.createElement('tr');
    const cells = [
      new Date(entry.at).toLocaleString(),
      `${fmtSpeed(entry.download)} Mbps`,
      Number.isFinite(entry.upload) ? `${fmtSpeed(entry.upload)} Mbps` : '—',
      `${fmtMs(entry.ping)} ms`,
      PROVIDERS[entry.provider]?.label ?? entry.provider,
    ];
    for (const text of cells) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    els.historyBody.appendChild(tr);
  }
}

function pushHistory(result) {
  const history = readJSON(HISTORY_KEY, []);
  history.unshift(result);
  writeJSON(HISTORY_KEY, history.slice(0, 10));
  renderHistory();
}

els.clearHistory.addEventListener('click', () => {
  writeJSON(HISTORY_KEY, []);
  renderHistory();
});

/* ---------- 測試流程 ---------- */

let controller = null;

function resetDisplay() {
  gauge.reset();
  chart.reset();
  els.live.textContent = '0.0';
  els.ping.textContent = '—';
  els.jitter.textContent = '—';
  els.download.textContent = '—';
  els.upload.textContent = '—';
  setStatus('');
}

function finish(label) {
  controller = null;
  els.start.disabled = false;
  els.start.dataset.state = 'idle';
  els.start.textContent = '重新測速';
  els.phase.textContent = label;
  setActiveCard(null);
}

async function start() {
  if (controller) {
    controller.abort();
    return;
  }

  controller = new AbortController();
  resetDisplay();
  els.start.dataset.state = 'running';
  els.start.textContent = '停止';

  const runWith = (provider, notice = '') => runSpeedTest({
    provider,
    duration: settings.duration,
    streams: settings.streams,
    includeUpload: settings.includeUpload,
    signal: controller.signal,
    onPhase: (phase) => {
      els.phase.textContent = PHASE_TEXT[phase] ?? phase;
      setActiveCard(phase === 'ping' ? 'ping' : phase);
      if (phase === 'ping') setStatus(`${notice}正在測量往返延遲…`);
      if (phase === 'download') setStatus(`${notice}使用 ${settings.streams} 條連線下載測試中…`);
      if (phase === 'upload') setStatus(`${notice}使用 ${settings.streams} 條連線上傳測試中…`);
    },
    onSample: (phase, mbps) => {
      els.live.textContent = fmtSpeed(mbps);
      gauge.set(mbps);
      chart.push(phase, mbps);
      els[phase].textContent = fmtSpeed(mbps);
    },
    onPhaseDone: (phase, partial) => {
      if (phase === 'ping') {
        els.ping.textContent = fmtMs(partial.ping);
        els.jitter.textContent = fmtMs(partial.jitter);
      }
      if (phase === 'download') els.download.textContent = fmtSpeed(partial.download);
      if (phase === 'upload') els.upload.textContent = fmtSpeed(partial.upload);
    },
  });

  let provider = PROVIDERS[settings.provider];

  try {
    let result;
    try {
      result = await runWith(provider);
    } catch (error) {
      // 單檔版或放在沒有測速 API 的靜態主機上時，本機端點不存在，直接改用 Cloudflare。
      if (error?.name === 'AbortError' || provider.id !== 'local') throw error;
      provider = PROVIDERS.cloudflare;
      resetDisplay();
      result = await runWith(provider, '找不到本機測速伺服器，改用 Cloudflare：');
    }

    gauge.set(result.download);
    els.live.textContent = fmtSpeed(result.download);
    setStatus(
      `完成：下載 ${fmtSpeed(result.download)} Mbps`
      + (Number.isFinite(result.upload) ? `，上傳 ${fmtSpeed(result.upload)} Mbps` : '')
      + `，延遲 ${fmtMs(result.ping)} ms（${provider.label}）`,
    );
    pushHistory(result);
    finish(PHASE_TEXT.done);
  } catch (error) {
    if (error?.name === 'AbortError') {
      setStatus('測試已取消');
      finish('已取消');
    } else {
      setStatus(`${error.message}。${FAILURE_HINT}`, 'error');
      finish('發生錯誤');
      gauge.reset();
    }
  }
}

els.start.addEventListener('click', start);

document.addEventListener('keydown', (event) => {
  if (event.key === ' ' && event.target === document.body) {
    event.preventDefault();
    start();
  }
});

/**
 * 使用者沒自己選過時，開頁先探測同源有沒有測速 API：
 * 有就用本機伺服器，沒有（例如單檔放在一般靜態主機上）就直接用 Cloudflare，
 * 免得每次測速都要先白等本機端點逾時。
 */
async function autoSelectProvider() {
  if (readJSON(SETTINGS_KEY, null)) return;          // 尊重使用者存過的選擇
  if (location.protocol === 'file:') return;         // 已在上面切成 Cloudflare

  let available = false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(PROVIDERS.local.ping(), { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(timer);
    available = res.ok || res.status === 204;
  } catch {
    available = false;
  }

  if (!available) {
    settings.provider = 'cloudflare';
    applySettingsToUI();
  }
}

applySettingsToUI();
renderHistory();
autoSelectProvider();
