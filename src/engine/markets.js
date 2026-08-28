// 三種市場的設定。所有標的均為虛構，僅供遊戲模擬使用。

export const MARKETS = {
  tw: {
    id: 'tw',
    name: '台股模擬盤',
    tagline: '漲跌停 ±10%、手續費 0.1425%、賣出課證交稅 0.3%，還會除息',
    icon: '🇹🇼',
    currency: 'NT$',
    numberStyle: 'cjk',
    unit: '股',
    tickName: '交易日',
    tickShort: '日',
    totalTicks: 250,
    ticksPerYear: 250,
    startCash: 1000000,
    priceLimit: 0.1, // 漲跌停
    upColor: 'red', // 華語圈習慣：紅漲綠跌
    fee: { buyRate: 0.001425, sellRate: 0.001425, minFee: 20, sellTax: 0.003 },
    dividend: { enabled: true, everyTicks: 60, exRights: true },
    marketDrift: 0.01,
    marketVol: 0.17,
    eventChance: 0.16,
    priceDecimals: 2,
    assets: [
      { symbol: '1216', name: '鴻運食品', sector: '食品', price: 78.5, mu: 0.05, sigma: 0.18, beta: 0.5, divYield: 0.035, volBase: 9000 },
      { symbol: '2002', name: '巨鋼工業', sector: '鋼鐵', price: 32.4, mu: 0.03, sigma: 0.28, beta: 1.0, divYield: 0.05, volBase: 26000 },
      { symbol: '2317', name: '富達精密', sector: '電子代工', price: 118, mu: 0.09, sigma: 0.3, beta: 1.1, divYield: 0.04, volBase: 45000 },
      { symbol: '2330', name: '晶元半導', sector: '半導體', price: 620, mu: 0.18, sigma: 0.34, beta: 1.25, divYield: 0.018, volBase: 38000 },
      { symbol: '2412', name: '全民電信', sector: '電信', price: 105, mu: 0.04, sigma: 0.13, beta: 0.4, divYield: 0.045, volBase: 12000 },
      { symbol: '2603', name: '遠洋航運', sector: '航運', price: 58.2, mu: 0.06, sigma: 0.55, beta: 1.4, divYield: 0.06, volBase: 90000 },
      { symbol: '3008', name: '光影精機', sector: '光學', price: 1850, mu: 0.12, sigma: 0.45, beta: 1.2, divYield: 0.02, volBase: 3000 },
      { symbol: '6446', name: '藥華新藥', sector: '生技', price: 243, mu: 0.1, sigma: 0.62, beta: 0.8, divYield: 0, volBase: 7000 },
      { symbol: '8069', name: '元晶太陽', sector: '綠能', price: 96.3, mu: 0.08, sigma: 0.5, beta: 1.15, divYield: 0.01, volBase: 21000 },
      { symbol: '0050', name: '台灣龍頭ETF', sector: 'ETF', price: 145.6, mu: 0.07, sigma: 0.16, beta: 1.0, divYield: 0.03, volBase: 30000 },
    ],
  },

  us: {
    id: 'us',
    name: '美股模擬盤',
    tagline: '沒有漲跌停，一則財報就能讓你一夜致富或畢業',
    icon: '🇺🇸',
    currency: '$',
    numberStyle: 'western',
    unit: '股',
    tickName: '交易日',
    tickShort: '日',
    totalTicks: 252,
    ticksPerYear: 252,
    startCash: 100000,
    priceLimit: null,
    upColor: 'green', // 美股習慣：綠漲紅跌
    fee: { buyRate: 0.0005, sellRate: 0.0005, minFee: 1, sellTax: 0 },
    dividend: { enabled: true, everyTicks: 63, exRights: true },
    marketDrift: 0.02,
    marketVol: 0.2,
    eventChance: 0.18,
    priceDecimals: 2,
    assets: [
      { symbol: 'APLX', name: 'Apollex Devices', sector: '消費電子', price: 214, mu: 0.12, sigma: 0.28, beta: 1.1, divYield: 0.006, volBase: 52000 },
      { symbol: 'NVDX', name: 'Novadyne AI', sector: '半導體', price: 486, mu: 0.3, sigma: 0.58, beta: 1.6, divYield: 0, volBase: 61000 },
      { symbol: 'SFTC', name: 'Softcore Systems', sector: '軟體', price: 321, mu: 0.14, sigma: 0.3, beta: 1.05, divYield: 0.008, volBase: 28000 },
      { symbol: 'RTLX', name: 'Retailix Group', sector: '零售', price: 88.4, mu: 0.06, sigma: 0.24, beta: 0.8, divYield: 0.02, volBase: 19000 },
      { symbol: 'BNKR', name: 'Bankor Financial', sector: '金融', price: 52.7, mu: 0.07, sigma: 0.26, beta: 1.1, divYield: 0.035, volBase: 34000 },
      { symbol: 'PHRM', name: 'Pharmagen Labs', sector: '製藥', price: 145.2, mu: 0.08, sigma: 0.32, beta: 0.6, divYield: 0.025, volBase: 16000 },
      { symbol: 'ENRG', name: 'Enerra Energy', sector: '能源', price: 66.1, mu: 0.05, sigma: 0.38, beta: 0.9, divYield: 0.045, volBase: 23000 },
      { symbol: 'MOOV', name: 'Moovel Motors', sector: '電動車', price: 190.5, mu: 0.15, sigma: 0.72, beta: 1.7, divYield: 0, volBase: 47000 },
      { symbol: 'AIRW', name: 'Airwave Telecom', sector: '電信', price: 33.8, mu: 0.03, sigma: 0.2, beta: 0.6, divYield: 0.06, volBase: 15000 },
      { symbol: 'SPX5', name: 'Index500 ETF', sector: 'ETF', price: 472, mu: 0.09, sigma: 0.18, beta: 1.0, divYield: 0.014, volBase: 40000 },
    ],
  },

  crypto: {
    id: 'crypto',
    name: '加密貨幣市場',
    tagline: '24 小時不休市、四小時一根 K 棒，沒有漲跌停也沒有人救你',
    icon: '₿',
    currency: '$',
    numberStyle: 'western',
    unit: '顆',
    tickName: '小時',
    tickShort: '根',
    tickHours: 4, // 一根 K 棒 = 4 小時
    totalTicks: 360, // 約 60 天
    ticksPerYear: 2190, // 365 * 6
    startCash: 50000,
    priceLimit: null,
    upColor: 'green',
    fee: { buyRate: 0.001, sellRate: 0.001, minFee: 0, sellTax: 0 },
    dividend: { enabled: false },
    marketDrift: 0.12,
    marketVol: 0.55,
    eventChance: 0.12,
    priceDecimals: 4,
    fractional: true, // 可買零碎單位
    assets: [
      { symbol: 'BTX', name: 'BitoraX', sector: '大市值', price: 42150, mu: 0.35, sigma: 0.5, beta: 1.0, divYield: 0, volBase: 8000 },
      { symbol: 'ETX', name: 'Etheron', sector: '智能合約', price: 2418, mu: 0.4, sigma: 0.62, beta: 1.15, divYield: 0, volBase: 14000 },
      { symbol: 'SOLR', name: 'Solaris Chain', sector: 'L1 公鏈', price: 118.4, mu: 0.5, sigma: 0.85, beta: 1.35, divYield: 0, volBase: 26000 },
      { symbol: 'LYR', name: 'Layerus', sector: 'L2 擴容', price: 8.42, mu: 0.45, sigma: 0.9, beta: 1.35, divYield: 0, volBase: 31000 },
      { symbol: 'AIQ', name: 'AIQuant', sector: 'AI 敘事', price: 3.24, mu: 0.55, sigma: 1.0, beta: 1.45, divYield: 0, volBase: 44000 },
      { symbol: 'LNKA', name: 'Linkara', sector: '預言機', price: 14.56, mu: 0.25, sigma: 0.72, beta: 1.2, divYield: 0, volBase: 18000 },
      { symbol: 'PRIV', name: 'PrivaCoin', sector: '隱私幣', price: 92.3, mu: 0.15, sigma: 0.78, beta: 1.05, divYield: 0, volBase: 9000 },
      { symbol: 'GMFI', name: 'GameFi Token', sector: '鏈遊', price: 0.652, mu: 0.15, sigma: 1.15, beta: 1.55, divYield: 0, volBase: 120000 },
      { symbol: 'DOGX', name: 'DogeMax', sector: '迷因幣', price: 0.1824, mu: 0.25, sigma: 1.3, beta: 1.7, divYield: 0, volBase: 380000 },
      { symbol: 'USDX', name: 'StableUSD', sector: '穩定幣', price: 1.0, mu: 0, sigma: 0.03, beta: 0, divYield: 0, volBase: 200000, stable: true, peg: 1 },
    ],
  },
}

export const MARKET_LIST = [MARKETS.tw, MARKETS.us, MARKETS.crypto]

export const DIFFICULTIES = {
  easy: {
    id: 'easy',
    name: '新手',
    desc: '波動較小、多頭偏多，適合先摸熟介面',
    volMult: 0.7,
    driftMult: 1.5,
    eventMult: 0.8,
    crashChance: 0.15,
  },
  normal: {
    id: 'normal',
    name: '標準',
    desc: '接近真實市場的波動與報酬',
    volMult: 1,
    driftMult: 1,
    eventMult: 1,
    crashChance: 0.4,
  },
  hard: {
    id: 'hard',
    name: '地獄',
    desc: '高波動、壞消息滿天飛，還可能遇上股災',
    volMult: 1.55,
    driftMult: 0.35,
    eventMult: 1.5,
    crashChance: 1,
  },
}

export const DIFFICULTY_LIST = [DIFFICULTIES.easy, DIFFICULTIES.normal, DIFFICULTIES.hard]

export function getMarket(id) {
  return MARKETS[id] || MARKETS.tw
}

export function getDifficulty(id) {
  return DIFFICULTIES[id] || DIFFICULTIES.normal
}
