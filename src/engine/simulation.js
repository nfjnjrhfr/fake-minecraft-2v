import { createRng, rand, gauss, weightedPick, randomSeed } from './rng.js'
import { getMarket, getDifficulty } from './markets.js'
import { EVENT_POOLS, REGIME_EVENTS, formatEventText } from './events.js'

export const SAVE_VERSION = 1
const WARMUP = 80 // 開局前先跑出來的歷史 K 棒，讓圖表一開始就有東西看
const MAX_NEWS = 80

// ---------------------------------------------------------------- 建立新遊戲

export function createGame({ marketId = 'tw', difficultyId = 'normal', seed } = {}) {
  const market = getMarket(marketId)
  const difficulty = getDifficulty(difficultyId)
  const actualSeed = seed ?? randomSeed()

  const state = {
    version: SAVE_VERSION,
    marketId: market.id,
    difficultyId: difficulty.id,
    seed: actualSeed,
    rng: createRng(actualSeed),
    tick: 0,
    totalTicks: market.totalTicks,
    startCash: market.startCash,
    cash: market.startCash,
    holdings: {},
    assets: market.assets.map((def) => ({
      symbol: def.symbol,
      name: def.name,
      sector: def.sector,
      initialPrice: def.price,
      price: def.price,
      prevClose: def.price,
      mu: def.mu,
      sigma: def.sigma,
      beta: def.beta,
      divYield: def.divYield,
      volBase: def.volBase,
      stable: !!def.stable,
      peg: def.peg ?? null,
      history: [],
    })),
    activeEvents: [],
    news: [],
    trades: [],
    equity: [],
    index: [],
    regime: { crashes: 0, booms: 0 },
    stats: { realized: 0, fees: 0, tradeCount: 0, bestTrade: null, worstTrade: null },
    status: 'playing', // playing | ended
    endReason: null,
    newsCounter: 0,
  }

  // 暖身：先產生歷史 K 棒（不產生新聞，也不影響玩家資產）
  for (let i = 0; i < WARMUP; i += 1) {
    stepPrices(state, market, difficulty, i - WARMUP + 1)
  }

  state.assets.forEach((a) => {
    a.openingPrice = a.price
  })
  pushIndex(state)
  state.equity.push({ tick: 0, value: state.cash, cash: state.cash, invested: 0 })
  return state
}

// ---------------------------------------------------------------- 推進一根 K 棒

export function advance(state) {
  if (state.status !== 'playing') return state
  const next = cloneState(state)
  const market = getMarket(next.marketId)
  const difficulty = getDifficulty(next.difficultyId)

  next.tick += 1
  maybeSpawnEvent(next, market, difficulty)
  maybeSpawnRegime(next, market, difficulty)
  stepPrices(next, market, difficulty, next.tick)
  decayEvents(next)
  payDividends(next, market)
  pushIndex(next)

  const invested = positionsValue(next)
  next.equity.push({ tick: next.tick, value: next.cash + invested, cash: next.cash, invested })

  if (netWorth(next) <= next.startCash * 0.02) {
    next.status = 'ended'
    next.endReason = 'bankrupt'
  } else if (next.tick >= next.totalTicks) {
    next.status = 'ended'
    next.endReason = 'finished'
  }
  return next
}

export function advanceMany(state, count) {
  let s = state
  for (let i = 0; i < count && s.status === 'playing'; i += 1) s = advance(s)
  return s
}

// ---------------------------------------------------------------- 價格模擬

function stepPrices(state, market, difficulty, tick) {
  const rng = state.rng
  const dt = 1 / market.ticksPerYear
  const sqdt = Math.sqrt(dt)
  const volMult = difficulty.volMult
  const driftMult = difficulty.driftMult

  // 共同的市場因子：所有標的都會被它拖著走
  const marketShock = state.pendingMarketShock || 0
  state.pendingMarketShock = 0
  const marketDrift = (market.marketDrift * driftMult + extraDrift(state, null, null)) * dt
  const marketRet = marketDrift + market.marketVol * volMult * sqdt * gauss(rng) + marketShock

  for (const asset of state.assets) {
    const shock = (state.pendingShocks && state.pendingShocks[asset.symbol]) || 0
    let ret
    if (asset.stable) {
      // 穩定幣：向錨定價格均值回歸，市場行情與新聞都影響不了它
      ret = 0.25 * Math.log(asset.peg / asset.price) + asset.sigma * sqdt * gauss(rng)
    } else {
      const alpha = (asset.mu * driftMult + extraDrift(state, asset.symbol, asset.sector)) * dt
      const noise = asset.sigma * volMult * sqdt * gauss(rng)
      ret = alpha + asset.beta * marketRet + noise + shock
    }

    const prev = asset.price
    let close = prev * Math.exp(ret)
    const limit = market.priceLimit
    const cap = limit ? prev * (1 + limit) : Infinity
    const floorLimit = limit ? prev * (1 - limit) : 0
    close = clamp(close, floorLimit, cap)

    let open = prev * Math.exp(0.35 * asset.sigma * volMult * sqdt * gauss(rng))
    open = clamp(open, floorLimit, cap)

    const wick = Math.abs(gauss(rng)) * 0.6 * asset.sigma * volMult * sqdt
    let high = Math.max(open, close) * (1 + wick)
    let low = Math.min(open, close) * (1 - Math.abs(gauss(rng)) * 0.6 * asset.sigma * volMult * sqdt)
    high = clamp(high, Math.max(open, close), cap)
    low = clamp(low, Math.max(floorLimit, asset.initialPrice * 0.002), Math.min(open, close))

    const move = Math.abs(close / prev - 1)
    const volume = Math.round(asset.volBase * (0.55 + rand(rng) * 0.9) * (1 + 9 * move))

    asset.prevClose = prev
    asset.price = Math.max(close, asset.initialPrice * 0.002)
    asset.history.push({
      t: tick,
      o: round(open, 6),
      h: round(high, 6),
      l: round(low, 6),
      c: round(asset.price, 6),
      v: volume,
    })
    if (asset.history.length > WARMUP + market.totalTicks + 10) asset.history.shift()
  }
  state.pendingShocks = {}
}

function extraDrift(state, symbol, sector) {
  let sum = 0
  for (const ev of state.activeEvents) {
    if (ev.scope === 'market' && symbol === null) sum += ev.drift
    else if (ev.scope === 'asset' && ev.target === symbol) sum += ev.drift
    else if (ev.scope === 'sector' && ev.target === sector) sum += ev.drift
  }
  return sum
}

function decayEvents(state) {
  state.activeEvents = state.activeEvents
    .map((ev) => ({ ...ev, remaining: ev.remaining - 1 }))
    .filter((ev) => ev.remaining > 0)
}

// ---------------------------------------------------------------- 新聞事件

function maybeSpawnEvent(state, market, difficulty) {
  const rng = state.rng
  if (rand(rng) > market.eventChance * difficulty.eventMult) return

  const pool = EVENT_POOLS[market.id]
  const roll = rand(rng)
  const scope = roll < 0.55 ? 'asset' : roll < 0.8 ? 'sector' : 'market'
  const template = weightedPick(rng, pool[scope])

  let target = null
  let asset = null
  if (scope === 'asset' || scope === 'sector') {
    const pickable = state.assets.filter((a) => !a.stable)
    asset = pickable[Math.floor(rand(rng) * pickable.length)]
    target = scope === 'asset' ? asset.symbol : asset.sector
  }

  applyEvent(state, {
    scope,
    target,
    text: formatEventText(template.text, asset),
    tone: template.tone,
    drift: template.drift,
    shock: template.shock,
    ticks: template.ticks,
    symbol: scope === 'asset' ? target : null,
  })
}

function maybeSpawnRegime(state, market, difficulty) {
  const rng = state.rng
  if (state.tick < 15) return
  const crashRate = difficulty.crashChance / market.totalTicks
  const boomRate = (difficulty.driftMult * 0.5) / market.totalTicks

  if (state.regime.crashes < 2 && rand(rng) < crashRate) {
    const def = REGIME_EVENTS.crash[market.id]
    state.regime.crashes += 1
    applyEvent(state, { scope: 'market', target: null, text: def.text, tone: 'bad', drift: def.drift, shock: def.shock, ticks: def.ticks, symbol: null, major: true })
  } else if (state.regime.booms < 2 && rand(rng) < boomRate) {
    const def = REGIME_EVENTS.boom[market.id]
    state.regime.booms += 1
    applyEvent(state, { scope: 'market', target: null, text: def.text, tone: 'good', drift: def.drift, shock: def.shock, ticks: def.ticks, symbol: null, major: true })
  }
}

function applyEvent(state, ev) {
  state.newsCounter += 1
  const id = `${state.tick}-${state.newsCounter}`

  if (ev.ticks > 0 && ev.drift) {
    state.activeEvents.push({ id, scope: ev.scope, target: ev.target, drift: ev.drift, remaining: ev.ticks })
  }
  if (ev.shock) {
    if (ev.scope === 'market') {
      state.pendingMarketShock = (state.pendingMarketShock || 0) + ev.shock
    } else {
      if (!state.pendingShocks) state.pendingShocks = {}
      const targets = ev.scope === 'asset'
        ? state.assets.filter((a) => a.symbol === ev.target)
        : state.assets.filter((a) => a.sector === ev.target && !a.stable)
      for (const a of targets) {
        state.pendingShocks[a.symbol] = (state.pendingShocks[a.symbol] || 0) + ev.shock
      }
    }
  }
  state.news.unshift({
    id,
    tick: state.tick,
    text: ev.text,
    tone: ev.tone,
    scope: ev.scope,
    symbol: ev.symbol || null,
    major: !!ev.major,
  })
  if (state.news.length > MAX_NEWS) state.news.pop()
}

// ---------------------------------------------------------------- 配息 / 除息

function payDividends(state, market) {
  const cfg = market.dividend
  if (!cfg?.enabled) return
  if (state.tick === 0 || state.tick % cfg.everyTicks !== 0) return

  const ratio = cfg.everyTicks / market.ticksPerYear
  let received = 0
  for (const asset of state.assets) {
    if (!asset.divYield) continue
    const perShare = asset.price * asset.divYield * ratio
    const pos = state.holdings[asset.symbol]
    if (pos && pos.shares > 0) {
      const amount = pos.shares * perShare
      received += amount
      state.cash += amount
      // 領到的股利同時降低持股成本，計算報酬率才不會失真
      pos.cost = Math.max(0, pos.cost - amount)
    }
    if (cfg.exRights) {
      asset.price = Math.max(asset.price - perShare, asset.initialPrice * 0.002)
      const idx = asset.history.length - 1
      const last = asset.history[idx]
      if (last) asset.history[idx] = { ...last, c: round(asset.price, 6) }
    }
  }
  if (received > 0) {
    state.newsCounter += 1
    state.news.unshift({
      id: `${state.tick}-div-${state.newsCounter}`,
      tick: state.tick,
      text: `💰 除息入帳：本次共領到現金股利 ${Math.round(received).toLocaleString('zh-TW')}`,
      tone: 'good',
      scope: 'market',
      symbol: null,
    })
    if (state.news.length > MAX_NEWS) state.news.pop()
  }
}

// ---------------------------------------------------------------- 選擇器

export function positionsValue(state) {
  let sum = 0
  for (const asset of state.assets) {
    const pos = state.holdings[asset.symbol]
    if (pos && pos.shares > 0) sum += pos.shares * asset.price
  }
  return sum
}

export function netWorth(state) {
  return state.cash + positionsValue(state)
}

export function totalReturn(state) {
  return netWorth(state) / state.startCash - 1
}

export function getAsset(state, symbol) {
  return state.assets.find((a) => a.symbol === symbol)
}

export function indexValue(state) {
  const arr = state.index
  return arr.length ? arr[arr.length - 1].value : 100
}

export function indexReturn(state) {
  const arr = state.index
  if (arr.length < 2) return 0
  return arr[arr.length - 1].value / arr[0].value - 1
}

function pushIndex(state) {
  let sum = 0
  for (const a of state.assets) sum += a.price / a.initialPrice
  const value = round((sum / state.assets.length) * 100, 4)
  state.index.push({ tick: state.tick, value })
}

// ---------------------------------------------------------------- 小工具

// K 棒、新聞、交易紀錄產生後就不再變動，因此只需淺拷貝陣列，
// 不必整包深拷貝 —— 自動播放時每根 K 棒都要複製一次，這裡的差別很有感。
function cloneState(state) {
  const holdings = {}
  for (const [symbol, pos] of Object.entries(state.holdings)) holdings[symbol] = { ...pos }
  return {
    ...state,
    rng: { s: state.rng.s },
    holdings,
    assets: state.assets.map((a) => ({ ...a, history: a.history.slice() })),
    activeEvents: state.activeEvents.map((e) => ({ ...e })),
    news: state.news.slice(),
    trades: state.trades.slice(),
    equity: state.equity.slice(),
    index: state.index.slice(),
    regime: { ...state.regime },
    stats: { ...state.stats },
    pendingShocks: { ...(state.pendingShocks || {}) },
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function round(value, digits) {
  const f = 10 ** digits
  return Math.round(value * f) / f
}
