import { useEffect, useState } from 'react'
import { maxBuyQty, quoteBuy, quoteSell, positionStats, roundQty } from '../engine/trading.js'
import { formatMoney, formatPrice, formatQty } from '../engine/format.js'

const FRACTIONS = [
  { label: '25%', value: 0.25 },
  { label: '50%', value: 0.5 },
  { label: '75%', value: 0.75 },
  { label: '全部', value: 1 },
]

function parseQty(text) {
  const value = Number(String(text).replace(/,/g, ''))
  return Number.isFinite(value) && value > 0 ? value : 0
}

export default function TradePanel({ state, market, asset, onTrade }) {
  const [buyText, setBuyText] = useState('')
  const [sellText, setSellText] = useState('')

  // 換標的或成交後就清空，免得舊數量留在框裡誤按
  useEffect(() => {
    setBuyText('')
    setSellText('')
  }, [asset.symbol, state.stats.tradeCount])

  const playing = state.status === 'playing'
  const pos = positionStats(state, asset)
  const maxBuy = maxBuyQty(market, asset.price, state.cash)
  const maxSell = pos ? pos.shares : 0

  const buyQty = roundQty(market, parseQty(buyText))
  const sellQty = roundQty(market, parseQty(sellText))
  const buyQuote = quoteBuy(market, asset.price, buyQty)
  const sellQuote = quoteSell(market, asset.price, sellQty)
  const sellPnl = pos && sellQty > 0 ? sellQuote.net - pos.avgPrice * sellQty : null

  const canBuy = playing && buyQty > 0 && buyQuote.total <= state.cash + 1e-9
  const canSell = playing && sellQty > 0 && sellQty <= maxSell + 1e-9
  const cur = market.currency

  return (
    <div className="panel">
      <div className="panel-head">
        <span>下單</span>
        <span>
          手續費 {(market.fee.buyRate * 100).toFixed(4)}%
          {market.fee.minFee > 0 && `（低消 ${cur}${market.fee.minFee}）`}
          {market.fee.sellTax > 0 && ` · 賣出交易稅 ${(market.fee.sellTax * 100).toFixed(1)}%`}
        </span>
      </div>
      <div className="trade">
        <div className="trade-side">
          <h3>買進</h3>
          <div className="qty-input">
            <input
              value={buyText}
              onChange={(e) => setBuyText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && canBuy && onTrade('buy', asset.symbol, buyQty)}
              placeholder={`最多 ${formatQty(maxBuy)}`}
              inputMode="decimal"
            />
            <span className="suffix">{market.unit}</span>
          </div>
          <div className="quick-row">
            {FRACTIONS.map((f) => (
              <button
                key={f.label}
                type="button"
                onClick={() => setBuyText(String(roundQty(market, maxBuy * f.value)))}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="trade-note">
            {buyQty > 0 ? (
              <>
                金額 {formatMoney(buyQuote.gross, cur, 0)} ＋ 手續費{' '}
                {formatMoney(buyQuote.fee, cur, 0)}
                <br />
                合計 {formatMoney(buyQuote.total, cur, 0)}
                {!canBuy && playing && <span className="down">（現金不足）</span>}
              </>
            ) : (
              <>
                現價 {formatPrice(asset.price, market.priceDecimals)}／可用現金{' '}
                {formatMoney(state.cash, cur, 0)}
              </>
            )}
          </div>
          <button
            type="button"
            className="btn-buy"
            disabled={!canBuy}
            onClick={() => onTrade('buy', asset.symbol, buyQty)}
          >
            買進 {asset.name}
          </button>
        </div>

        <div className="trade-side">
          <h3>賣出</h3>
          <div className="qty-input">
            <input
              value={sellText}
              onChange={(e) => setSellText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && canSell && onTrade('sell', asset.symbol, sellQty)}
              placeholder={pos ? `持有 ${formatQty(maxSell)}` : '目前沒有部位'}
              inputMode="decimal"
            />
            <span className="suffix">{market.unit}</span>
          </div>
          <div className="quick-row">
            {FRACTIONS.map((f) => (
              <button
                key={f.label}
                type="button"
                onClick={() => setSellText(String(roundQty(market, maxSell * f.value)))}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="trade-note">
            {sellQty > 0 ? (
              <>
                收入 {formatMoney(sellQuote.gross, cur, 0)} － 費用{' '}
                {formatMoney(sellQuote.fee + sellQuote.tax, cur, 0)}
                <br />
                淨得 {formatMoney(sellQuote.net, cur, 0)}
                {sellPnl != null && (
                  <span className={sellPnl >= 0 ? 'up' : 'down'}>
                    {' '}
                    損益 {formatMoney(sellPnl, cur, 0)}
                  </span>
                )}
              </>
            ) : pos ? (
              <>
                均價 {formatPrice(pos.avgPrice, market.priceDecimals)}／未實現{' '}
                <span className={pos.pnl >= 0 ? 'up' : 'down'}>{formatMoney(pos.pnl, cur, 0)}</span>
              </>
            ) : (
              <>買進後才能賣出</>
            )}
          </div>
          <button
            type="button"
            className="btn-sell"
            disabled={!canSell}
            onClick={() => onTrade('sell', asset.symbol, sellQty)}
          >
            賣出 {asset.name}
          </button>
        </div>
      </div>
    </div>
  )
}
