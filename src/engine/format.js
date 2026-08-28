export function formatMoney(value, currency = '', digits = 0) {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  const text = abs.toLocaleString('zh-TW', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  return `${value < 0 ? '-' : ''}${currency}${text}`
}

// 大數字縮寫。台股用「萬／億」，美股與加密貨幣用 K／M／B。
export function formatCompact(value, market = {}) {
  if (!Number.isFinite(value)) return '—'
  const currency = market.currency ?? ''
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (market.numberStyle === 'western') {
    if (abs >= 1e9) return `${sign}${currency}${(abs / 1e9).toFixed(2)}B`
    if (abs >= 1e6) return `${sign}${currency}${(abs / 1e6).toFixed(2)}M`
    if (abs >= 1e3) return `${sign}${currency}${(abs / 1e3).toFixed(1)}K`
    return `${sign}${currency}${Math.round(abs).toLocaleString('zh-TW')}`
  }
  if (abs >= 1e8) return `${sign}${currency}${(abs / 1e8).toFixed(2)} 億`
  if (abs >= 1e4) return `${sign}${currency}${(abs / 1e4).toFixed(1)} 萬`
  return `${sign}${currency}${Math.round(abs).toLocaleString('zh-TW')}`
}

// 漲跌配色用的樣式名，0 不算漲也不算跌
export function tone(value) {
  return value > 0 ? 'up' : value < 0 ? 'down' : 'flat'
}

export function formatPrice(value, decimals = 2) {
  if (!Number.isFinite(value)) return '—'
  // 便宜的幣種需要更多小數位才看得出變化
  const digits = value < 1 ? Math.min(decimals + 2, 6) : value < 100 ? decimals : 2
  return value.toLocaleString('zh-TW', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function formatPct(value, digits = 2) {
  if (!Number.isFinite(value)) return '—'
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`
}

export function formatQty(value) {
  if (!Number.isFinite(value)) return '—'
  if (Number.isInteger(value)) return value.toLocaleString('zh-TW')
  // 零碎單位很多時就不用秀到小數第六位了
  const digits = Math.abs(value) >= 1000 ? 2 : Math.abs(value) >= 1 ? 4 : 6
  return value.toLocaleString('zh-TW', { maximumFractionDigits: digits })
}

// 把 tick 轉成看得懂的時間標籤。tick <= 0 是開局前的歷史 K 棒。
export function formatTick(market, tick) {
  if (tick <= 0) return '開盤前'
  if (market.tickHours) {
    const totalHours = tick * market.tickHours
    const day = Math.floor(totalHours / 24) + 1
    const hour = totalHours % 24
    return `第 ${day} 天 ${String(hour).padStart(2, '0')}:00`
  }
  return `第 ${tick} 個交易日`
}

// 圖表座標軸用的短標籤
export function tickAxisLabel(market, tick) {
  if (tick <= 0) return `T${tick}`
  if (market.tickHours) return `D${Math.floor((tick * market.tickHours) / 24) + 1}`
  return String(tick)
}
