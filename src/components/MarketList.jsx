import { formatPrice, formatPct } from '../engine/format.js'

export default function MarketList({ assets, market, holdings, selected, onSelect }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span>報價</span>
        <span>{assets.length} 檔</span>
      </div>
      <div className="market-list">
        {assets.map((asset) => {
          const change = asset.prevClose ? asset.price / asset.prevClose - 1 : 0
          const dir = change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
          const held = holdings[asset.symbol]?.shares > 0
          return (
            <button
              key={asset.symbol}
              className={`quote-row${selected === asset.symbol ? ' active' : ''}`}
              onClick={() => onSelect(asset.symbol)}
              type="button"
            >
              <div className="quote-name">
                {held && <i className="hold-dot" title="持有中" />}
                {asset.name}
              </div>
              <div className={`quote-price num ${dir}`}>
                {formatPrice(asset.price, market.priceDecimals)}
              </div>
              <div className="quote-symbol">
                {asset.symbol} · {asset.sector}
              </div>
              <div className={`quote-change num ${dir}`}>{formatPct(change)}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
