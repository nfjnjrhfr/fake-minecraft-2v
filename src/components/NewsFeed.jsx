import { formatMoney, formatPrice, formatQty, formatTick } from '../engine/format.js'

export default function NewsFeed({ state, market, tab, onTabChange, onSelect }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <div className="tabs">
          <button
            type="button"
            className={tab === 'news' ? 'active' : ''}
            onClick={() => onTabChange('news')}
          >
            市場快訊
          </button>
          <button
            type="button"
            className={tab === 'trades' ? 'active' : ''}
            onClick={() => onTabChange('trades')}
          >
            交易紀錄
          </button>
        </div>
      </div>

      {tab === 'news' ? (
        <div className="news-list">
          {state.news.length === 0 && <div className="empty">市場一片平靜，還沒有消息</div>}
          {state.news.map((item) => (
            <div
              key={item.id}
              className={`news-item ${item.tone}${item.major ? ' major' : ''}`}
              onClick={() => item.symbol && onSelect(item.symbol)}
              role={item.symbol ? 'button' : undefined}
              style={item.symbol ? { cursor: 'pointer' } : undefined}
            >
              <div className="news-time">{formatTick(market, item.tick)}</div>
              {item.text}
            </div>
          ))}
        </div>
      ) : (
        <div className="news-list">
          {state.trades.length === 0 && <div className="empty">還沒有下過單</div>}
          {state.trades.map((trade, i) => (
            <div className="trade-row" key={`${trade.tick}-${i}`}>
              <span>
                <span className={`tag ${trade.side}`}>{trade.side === 'buy' ? '買' : '賣'}</span>{' '}
                {trade.name}
              </span>
              <span>
                {formatQty(trade.qty)} @ {formatPrice(trade.price, market.priceDecimals)}
                {trade.pnl != null && (
                  <b className={trade.pnl >= 0 ? ' up' : ' down'}>
                    {' '}
                    {formatMoney(trade.pnl, '', 0)}
                  </b>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
