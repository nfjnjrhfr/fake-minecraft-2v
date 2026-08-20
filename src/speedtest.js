/**
 * 測速核心：延遲/抖動、下載、上傳。
 * 不依賴任何外部套件，只用 fetch / XMLHttpRequest。
 */
import { DEFAULTS } from './config.js';

const MiB = 1024 * 1024;

export const toMbps = (bytesPerSecond) => (bytesPerSecond * 8) / 1e6;

/** 累積位元組計數器，並記錄取樣點以便事後計算平均值。 */
class ByteCounter {
  constructor() {
    this.total = 0;
    this.samples = [];              // {t, total}
    this.startedAt = performance.now();
    this.samples.push({ t: 0, total: 0 });
  }

  add(n) {
    this.total += n;
  }

  /** 記錄一個取樣點，回傳這段期間的瞬時速度（bytes/s）。 */
  tick() {
    const t = performance.now() - this.startedAt;
    const prev = this.samples[this.samples.length - 1];
    const dt = t - prev.t;
    this.samples.push({ t, total: this.total });
    if (dt <= 0) return 0;
    return ((this.total - prev.total) / dt) * 1000;
  }

  /** 忽略暖機期後的平均速度（bytes/s）。 */
  average(warmupMs) {
    const last = this.samples[this.samples.length - 1];
    let base = this.samples[0];
    for (const s of this.samples) {
      if (s.t <= warmupMs) base = s;
      else break;
    }
    const dt = last.t - base.t;
    if (dt <= 0) return 0;
    return ((last.total - base.total) / dt) * 1000;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function abortError(signal) {
  return signal?.aborted ? new DOMException('測試已取消', 'AbortError') : null;
}

/** 送一次 ping，並在 timeoutMs 之後放棄，避免端點沒回應時整個測試卡住。 */
async function pingOnce(url, signal, timeoutMs) {
  const ctrl = new AbortController();
  const relay = () => ctrl.abort();
  if (signal?.aborted) ctrl.abort();
  else signal?.addEventListener('abort', relay, { once: true });
  const timer = setTimeout(relay, timeoutMs);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok && res.status !== 204) throw new Error(`測速端點回應 ${res.status}`);
    // 讀完 body 才算一次完整往返，否則量到的只是 header 抵達時間。
    await res.arrayBuffer();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
  }
}

/**
 * 量測延遲與抖動。
 * ping   取樣中位數（比平均值更不受單次尖峰影響）
 * jitter 相鄰兩次延遲差的平均值，即 RFC 3550 的概念
 */
export async function measureLatency(provider, { samples = DEFAULTS.pingSamples, signal, onSample } = {}) {
  const values = [];
  let failures = 0;
  for (let i = 0; i < samples; i += 1) {
    const err = abortError(signal);
    if (err) throw err;

    const started = performance.now();
    try {
      await pingOnce(provider.ping(), signal, DEFAULTS.pingTimeoutMs);
    } catch (error) {
      // 使用者按停止才算取消，逾時造成的 AbortError 只是這次取樣失敗。
      if (signal?.aborted) throw error;
      failures += 1;
      // 連續失敗代表端點根本連不上，不必把剩下的取樣跑完。
      if (failures >= DEFAULTS.maxPingFailures) throw new Error('無法連上測速伺服器');
      continue;
    }
    const rtt = performance.now() - started;

    // 第一次包含 DNS / TCP / TLS 建線成本，不列入統計。
    if (i > 0) {
      values.push(rtt);
      onSample?.(rtt);
    }
    await sleep(40);
  }

  if (!values.length) {
    throw new Error('無法連上測速伺服器');
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const ping = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  let jitter = 0;
  if (values.length > 1) {
    let sum = 0;
    for (let i = 1; i < values.length; i += 1) sum += Math.abs(values[i] - values[i - 1]);
    jitter = sum / (values.length - 1);
  }

  return { ping, jitter, min: sorted[0], samples: values };
}

/** 依照上一塊傳輸花費的時間調整下一塊大小，讓快線路不會卡在建線成本上。 */
function nextChunkSize(current, elapsedMs, { min, max }) {
  if (elapsedMs < 1500) return Math.min(current * 2, max);
  if (elapsedMs > 6000) return Math.max(Math.floor(current / 2), min);
  return current;
}

async function downloadWorker(provider, counter, deadline, signal) {
  let chunk = 8 * MiB;
  while (performance.now() < deadline && !signal.aborted) {
    const started = performance.now();
    const res = await fetch(provider.download(chunk), { cache: 'no-store', signal });
    if (!res.ok) throw new Error(`下載端點回應 ${res.status}`);

    if (res.body?.getReader) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        counter.add(value.byteLength);
        if (performance.now() >= deadline) {
          await reader.cancel().catch(() => {});
          return;
        }
      }
    } else {
      // 沒有串流 API 時的退路：整塊讀完再計數。
      const buf = await res.arrayBuffer();
      counter.add(buf.byteLength);
    }

    chunk = nextChunkSize(chunk, performance.now() - started, { min: MiB, max: 128 * MiB });
  }
}

/**
 * 產生一塊隨機資料當作上傳負載。
 * 隨機是為了避免資料被中途壓縮而虛報速度；包成 Blob 則是因為直接送
 * TypedArray 時瀏覽器每次都會整塊複製一份，實測會讓上傳速度低估一個量級。
 */
function makePayload(bytes) {
  const buf = new Uint8Array(bytes);
  const view = new Uint8Array(65536);
  for (let offset = 0; offset < bytes; offset += view.length) {
    crypto.getRandomValues(view);
    buf.set(view.subarray(0, Math.min(view.length, bytes - offset)), offset);
  }
  return new Blob([buf], { type: 'application/octet-stream' });
}

function uploadOnce(url, payload, counter, signal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let lastLoaded = 0;

    const onAbort = () => xhr.abort();
    signal.addEventListener('abort', onAbort, { once: true });

    const cleanup = () => signal.removeEventListener('abort', onAbort);

    // 只有 XHR 能回報上傳進度，fetch 目前沒有等價的 API。
    xhr.upload.onprogress = (event) => {
      counter.add(event.loaded - lastLoaded);
      lastLoaded = event.loaded;
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 400) resolve();
      else reject(new Error(`上傳端點回應 ${xhr.status}`));
    };
    xhr.onerror = () => { cleanup(); reject(new Error('上傳連線失敗')); };
    xhr.onabort = () => { cleanup(); reject(new DOMException('測試已取消', 'AbortError')); };

    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.send(payload);
  });
}

async function uploadWorker(provider, counter, deadline, signal) {
  let size = 2 * MiB;
  let payload = makePayload(size);
  while (performance.now() < deadline && !signal.aborted) {
    const started = performance.now();
    await uploadOnce(provider.upload(), payload, counter, signal);
    const next = nextChunkSize(size, performance.now() - started, { min: MiB, max: 32 * MiB });
    if (next !== size) {
      size = next;
      payload = makePayload(size);
    }
  }
}

/**
 * 跑一個吞吐量階段（下載或上傳），期間持續回報瞬時速度。
 * @returns {{average:number, peak:number, series:number[]}} 單位皆為 bytes/s
 */
async function measureThroughput(worker, { streams, durationMs, signal, onSample }) {
  const counter = new ByteCounter();
  const deadline = performance.now() + durationMs;
  const series = [];
  let peak = 0;

  // 階段用的 signal：時間到就中斷還在傳輸中的請求，
  // 否則慢速線路上一塊資料可能遠遠拖過設定的秒數。使用者按停止時也會連動。
  const phase = new AbortController();
  const stopPhase = () => phase.abort();
  const phaseTimer = setTimeout(stopPhase, durationMs);
  if (signal.aborted) stopPhase();
  else signal.addEventListener('abort', stopPhase, { once: true });

  const timer = setInterval(() => {
    const speed = counter.tick();
    series.push(speed);
    if (speed > peak) peak = speed;
    onSample?.(speed, Math.min(1, (performance.now() - (deadline - durationMs)) / durationMs));
  }, DEFAULTS.sampleIntervalMs);

  try {
    const workers = [];
    for (let i = 0; i < streams; i += 1) {
      workers.push(worker(counter, deadline, phase.signal));
      // 稍微錯開各連線的起始時間，避免同時建線互相排擠。
      if (i < streams - 1) await sleep(60);
    }
    await Promise.all(workers);
  } catch (error) {
    if (error?.name !== 'AbortError') throw error;
  } finally {
    clearTimeout(phaseTimer);
    signal.removeEventListener('abort', stopPhase);
    clearInterval(timer);
    counter.tick();
  }

  const err = abortError(signal);
  if (err) throw err;

  const warmup = Math.min(DEFAULTS.maxWarmupMs, durationMs * DEFAULTS.warmupRatio);
  const elapsed = counter.samples[counter.samples.length - 1].t;
  return { average: counter.average(warmup), peak, series, bytes: counter.total, elapsed };
}

/**
 * 依序執行完整測速流程。
 * @param {object} options
 * @param {object} options.provider  端點設定（見 config.js）
 * @param {number} options.duration  每階段秒數
 * @param {number} options.streams   並行連線數
 * @param {boolean} options.includeUpload
 * @param {AbortSignal} options.signal
 * @param {(phase: string) => void} options.onPhase
 * @param {(phase: string, mbps: number, progress: number) => void} options.onSample
 */
export async function runSpeedTest({
  provider,
  duration = DEFAULTS.duration,
  streams = DEFAULTS.streams,
  includeUpload = DEFAULTS.includeUpload,
  signal = new AbortController().signal,
  onPhase,
  onSample,
  onPhaseDone,
}) {
  const durationMs = duration * 1000;
  const result = { provider: provider.id, at: Date.now() };

  onPhase?.('ping');
  const latency = await measureLatency(provider, { signal });
  result.ping = latency.ping;
  result.jitter = latency.jitter;
  onPhaseDone?.('ping', result);

  onPhase?.('download');
  const dl = await measureThroughput(
    (counter, deadline, phaseSignal) => downloadWorker(provider, counter, deadline, phaseSignal),
    { streams, durationMs, signal, onSample: (bps, p) => onSample?.('download', toMbps(bps), p) },
  );
  if (!dl.bytes) throw new Error('下載測試沒有收到任何資料');
  result.download = toMbps(dl.average);
  result.downloadPeak = toMbps(dl.peak);
  result.downloadBytes = dl.bytes;
  result.downloadSeconds = dl.elapsed / 1000;
  onPhaseDone?.('download', result);

  if (includeUpload) {
    onPhase?.('upload');
    const ul = await measureThroughput(
      (counter, deadline, phaseSignal) => uploadWorker(provider, counter, deadline, phaseSignal),
      { streams, durationMs, signal, onSample: (bps, p) => onSample?.('upload', toMbps(bps), p) },
    );
    if (!ul.bytes) throw new Error('上傳測試沒有送出任何資料');
    result.upload = toMbps(ul.average);
    result.uploadPeak = toMbps(ul.peak);
    result.uploadBytes = ul.bytes;
    result.uploadSeconds = ul.elapsed / 1000;
    onPhaseDone?.('upload', result);
  }

  onPhase?.('done');
  return result;
}
