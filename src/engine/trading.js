import { getMarket } from './markets.js'
import { getAsset } from './simulation.js'

const QTY_PRECISION = 6

export function roundQty(market, qty) {
  if (!market.fractional) return Math.floor(qty)
  const f = 10 ** QTY_PRECISION
  return Math.floor(qty * f) / f
}

export function quoteBuy(market, price, qty) {
  const gross = price * qty
  const fee = qty > 0 ? Math.max(gross * market.fee.buyRate, market.fee.minFee) : 0
  return { gross, fee, tax: 0, total: gross + fee }
}

export function quoteSell(market, price, qty) {
  const gross = price * qty
  const fee = qty > 0 ? Math.max(gross * market.fee.sellRate, market.fee.minFee) : 0
  const tax = gross * (market.fee.sellTax || 0)
  return { gross, fee, tax, net: gross - fee - tax }
}

// 現金最多能買幾單位（已把手續費算進去）
export function maxBuyQty(market, price, cash) {
  if (price <= 0) return 0
  const rate = market.fee.buyRate
  let qty = roundQty(market, Math.max(0, (cash - market.fee.minFee) / (price * (1 + rate))))
  // 手續費有低消，直接算可能差一點點，往下修到真的買得起為止
  let guard = 0
  while (qty > 0 && quoteBuy(market, price, qty).total > cash && guard < 64) {
    qty = roundQty(market, qty * 0.999 - (market.fractional ? 1e-6 : 1))
    guard += 1
  }
  return Math.max(0, qty)
}

export function buy(state, symbol, rawQty) {
  const market = getMarket(state.marketId)
  const asset = getAsset(state, symbol)
  if (!asset) return { error: '找不到這檔標的' }
  if (state.status !== 'playing') return { error: '這局已經結束了' }

  const qty = roundQty(market, rawQty)
  if (!(qty > 0)) return { error: '數量要大於 0' }

  const quote = quoteBuy(market, asset.price, qty)
  if (quote.total > state.cash + 1e-9) return { error: '現金不足' }

  const next = shallowUpdate(state)
  const pos = next.holdings[symbol] || { shares: 0, cost: 0 }
  next.holdings[symbol] = { shares: pos.shares + qty, cost: pos.cost + quote.total }
  next.cash -= quote.total
  next.stats = {
    ...next.stats,
    fees: next.stats.fees + quote.fee,
    tradeCount: next.stats.tradeCount + 1,
  }
  next.trades = [
    { tick: next.tick, symbol, name: asset.name, side: 'buy', qty, price: asset.price, fee: quote.fee, tax: 0, amount: quote.total, pnl: null },
    ...next.trades,
  ].slice(0, 200)

  return { state: next, message: `買進 ${asset.name} ${formatQty(qty)} ${market.unit}` }
}

export function sell(state, symbol, rawQty) {
  const market = getMarket(state.marketId)
  const asset = getAsset(state, symbol)
  if (!asset) return { error: '找不到這檔標的' }
  if (state.status !== 'playing') return { error: '這局已經結束了' }

  const pos = state.holdings[symbol]
  if (!pos || pos.shares <= 0) return { error: '手上沒有這檔部位' }

  const qty = Math.min(roundQty(market, rawQty), pos.shares)
  if (!(qty > 0)) return { error: '數量要大於 0' }

  const quote = quoteSell(market, asset.price, qty)
  const costPortion = pos.cost * (qty / pos.shares)
  const pnl = quote.net - costPortion

  const next = shallowUpdate(state)
  const remaining = roundQty(market, pos.shares - qty)
  if (remaining > 0) {
    next.holdings[symbol] = { shares: remaining, cost: pos.cost - costPortion }
  } else {
    delete next.holdings[symbol]
  }
  next.cash += quote.net
  next.stats = {
    ...next.stats,
    realized: next.stats.realized + pnl,
    fees: next.stats.fees + quote.fee + quote.tax,
    tradeCount: next.stats.tradeCount + 1,
    bestTrade: pickBest(next.stats.bestTrade, { symbol, name: asset.name, pnl }, 1),
    worstTrade: pickBest(next.stats.worstTrade, { symbol, name: asset.name, pnl }, -1),
  }
  next.trades = [
    { tick: next.tick, symbol, name: asset.name, side: 'sell', qty, price: asset.price, fee: quote.fee, tax: quote.tax, amount: quote.net, pnl },
    ...next.trades,
  ].slice(0, 200)

  return { state: next, message: `賣出 ${asset.name} ${formatQty(qty)} ${market.unit}` }
}

export function positionOf(state, symbol) {
  return state.holdings[symbol] || null
}

export function positionStats(state, asset) {
  const pos = state.holdings[asset.symbol]
  if (!pos || pos.shares <= 0) return null
  const value = pos.shares * asset.price
  const pnl = value - pos.cost
  return {
    shares: pos.shares,
    cost: pos.cost,
    avgPrice: pos.cost / pos.shares,
    value,
    pnl,
    pnlPct: pos.cost > 0 ? pnl / pos.cost : 0,
  }
}

function pickBest(current, candidate, sign) {
  if (!current) return candidate
  return candidate.pnl * sign > current.pnl * sign ? candidate : current
}

function shallowUpdate(state) {
  const holdings = {}
  for (const [symbol, pos] of Object.entries(state.holdings)) holdings[symbol] = { ...pos }
  return { ...state, holdings }
}

function formatQty(qty) {
  return Number.isInteger(qty) ? qty.toLocaleString('zh-TW') : String(qty)
}
