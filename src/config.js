/**
 * 測速端點設定。
 *
 * local      使用本專案內附的 Node 伺服器（server.js），量到的是與該主機之間的速度。
 * cloudflare 使用 Cloudflare 公開的測速端點，量到的是對外網際網路速度。
 */
export const PROVIDERS = {
  local: {
    id: 'local',
    label: '本機伺服器',
    ping: () => `/api/ping?r=${Math.random()}`,
    download: (bytes) => `/api/download?bytes=${bytes}&r=${Math.random()}`,
    upload: () => '/api/upload',
    hint: '需要先執行 `node server.js`，並用它提供的網址開啟本頁面。量測的是你與該伺服器之間的速度。',
  },
  cloudflare: {
    id: 'cloudflare',
    label: 'Cloudflare',
    ping: () => `https://speed.cloudflare.com/__down?bytes=0&r=${Math.random()}`,
    download: (bytes) => `https://speed.cloudflare.com/__down?bytes=${bytes}&r=${Math.random()}`,
    upload: () => 'https://speed.cloudflare.com/__up',
    hint: '透過 Cloudflare 的公開測速端點量測對外網路速度，需要可連上網際網路。',
  },
};

export const DEFAULTS = {
  provider: 'local',
  duration: 8,       // 每個階段的秒數
  streams: 4,        // 並行連線數
  includeUpload: true,
  pingSamples: 12,
  pingTimeoutMs: 5000,   // 單次 ping 等多久就放棄
  maxPingFailures: 3,    // 連續失敗幾次就判定連不上
  sampleIntervalMs: 150,
  // 開頭這段時間不列入平均，避開 TCP 慢啟動造成的低估
  warmupRatio: 0.25,
  maxWarmupMs: 1500,
};
