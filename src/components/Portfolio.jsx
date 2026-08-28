import EquityChart from './EquityChart.jsx'
import { positionStats } from '../engine/trading.js'
import { netWorth, positionsValue, totalReturn } from '../engine/simulation.js'
import { formatCompact, formatMoney, formatPct, formatPrice, formatQty, tone } from '../engine/format.js'

export default function Portfolio({ state, market, onSelect }) {
  const invested = positionsValue(state)
  const total = netWorth(state)
  const holdings = state.assets
    .map((asset) => ({ asset, stats: positionStats(state, asset) }))
    .filter((row) => row.stats)
    .sort((a, b) => b.stats.value - a.stats.value)
  const unrealized = holdings.reduce((sum, row) => sum + row.stats.pnl, 0)

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <span>資產總覽</span>
          <span className={tone(totalReturn(state))}>
            {formatPct(totalReturn(state))}
          </span>
        </div>
        <EquityChart equity={state.equity} startCash={state.startCash} />
        <div className="summary">
          <div>
            <span>總資產</span>
            <b>{formatCompact(total, market)}</b>
          </div>
          <div>
            <span>現金</span>
            <b>{formatCompact(state.cash, market)}</b>
          </div>
          <div>
            <span>持股市值</span>
            <b>{formatCompact(invested, market)}</b>
          </div>
          <div>
            <span>未實現損益</span>
            <b className={tone(unrealized)}>
              {formatCompact(unrealized, market)}
            </b>
          </div>
          <div>
            <span>已實現損益</span>
            <b className={tone(state.stats.realized)}>
              {formatCompact(state.stats.realized, market)}
            </b>
          </div>
          <div>
            <span>累計手續費／稅</span>
            <b className="flat">{formatCompact(state.stats.fees, market)}</b>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span>我的持股</span>
          <span>{holdings.length} 檔</span>
        </div>
        {holdings.length === 0 && <div className="empty">目前空手，選一檔標的開始交易</div>}
        {holdings.map(({ asset, stats }) => (
          <button
            type="button"
            className="holding"
            key={asset.symbol}
            onClick={() => onSelect(asset.symbol)}
          >
            <div className="h-name">{asset.name}</div>
            <div className="h-value">{formatMoney(stats.value, market.currency, 0)}</div>
            <div className="h-sub">
              {formatQty(stats.shares)} {market.unit} · 均價{' '}
              {formatPrice(stats.avgPrice, market.priceDecimals)}
            </div>
            <div className={`h-pnl ${tone(stats.pnl)}`}>
              {formatMoney(stats.pnl, '', 0)} ({formatPct(stats.pnlPct)})
            </div>
          </button>
        ))}
      </div>
    </>
  )
}
