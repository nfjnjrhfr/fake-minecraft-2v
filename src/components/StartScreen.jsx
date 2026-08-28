import { useState } from 'react'
import { MARKET_LIST, DIFFICULTY_LIST, getMarket } from '../engine/markets.js'
import { formatCompact, formatPct, tone } from '../engine/format.js'

export default function StartScreen({ onStart, savedGame, onResume, scores }) {
  const [marketId, setMarketId] = useState('tw')
  const [difficultyId, setDifficultyId] = useState('normal')

  const savedMarket = savedGame ? getMarket(savedGame.marketId) : null

  return (
    <div className={`start market-${marketId}`}>
      <div className="start-inner">
        <div className="start-head">
          <h1>模擬炒股遊戲</h1>
          <p>台股、美股、加密貨幣三種市場，用假錢體驗真實的心跳。</p>
        </div>

        {savedGame && savedGame.status === 'playing' && (
          <div className="start-section">
            <h2>未完成的牌局</h2>
            <div className="pick-card active" style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <div>
                <div className="title">
                  {savedMarket.icon} {savedMarket.name}
                </div>
                <div className="desc">
                  進行到 {savedGame.tick}／{savedGame.totalTicks} {savedMarket.tickShort}
                  ，總資產{' '}
                  {formatCompact(
                    savedGame.cash +
                      savedGame.assets.reduce(
                        (sum, a) => sum + (savedGame.holdings[a.symbol]?.shares || 0) * a.price,
                        0,
                      ),
                    savedMarket,
                  )}
                </div>
              </div>
              <button type="button" className="btn btn-primary" onClick={onResume}>
                繼續遊戲
              </button>
            </div>
          </div>
        )}

        <div className="start-section">
          <h2>選擇市場</h2>
          <div className="card-grid">
            {MARKET_LIST.map((market) => (
              <button
                key={market.id}
                type="button"
                className={`pick-card${marketId === market.id ? ' active' : ''}`}
                onClick={() => setMarketId(market.id)}
              >
                <div className="icon">{market.icon}</div>
                <div className="title">{market.name}</div>
                <div className="desc">{market.tagline}</div>
                <div className="meta">
                  <span>起始資金 {formatCompact(market.startCash, market)}</span>
                  <span>
                    {market.totalTicks} {market.tickShort}
                  </span>
                  <span>{market.assets.length} 檔標的</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="start-section">
          <h2>選擇難度</h2>
          <div className="card-grid">
            {DIFFICULTY_LIST.map((difficulty) => (
              <button
                key={difficulty.id}
                type="button"
                className={`pick-card${difficultyId === difficulty.id ? ' active' : ''}`}
                onClick={() => setDifficultyId(difficulty.id)}
              >
                <div className="title">{difficulty.name}</div>
                <div className="desc">{difficulty.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="start-actions">
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={() => onStart({ marketId, difficultyId })}
          >
            開始交易
          </button>
          <span className="hint">
            提示：空白鍵下一根 K 棒、A 鍵切換自動播放，進度會自動存在瀏覽器裡。
          </span>
        </div>

        {scores.length > 0 && (
          <div className="start-section" style={{ marginTop: 34 }}>
            <h2>最佳戰績</h2>
            <div className="scores">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>市場／難度</th>
                    <th>報酬率</th>
                    <th>大盤</th>
                    <th>結算資產</th>
                    <th>交易次數</th>
                  </tr>
                </thead>
                <tbody>
                  {scores.slice(0, 8).map((score, i) => {
                    const market = getMarket(score.marketId)
                    return (
                      <tr key={`${score.date}-${i}`}>
                        <td>{i + 1}</td>
                        <td>
                          {market.icon} {score.marketName} · {score.difficultyName}
                        </td>
                        <td className={`num ${tone(score.returnPct)}`}>
                          {formatPct(score.returnPct)}
                        </td>
                        <td className="num flat">{formatPct(score.benchmarkPct ?? 0)}</td>
                        <td className="num">{formatCompact(score.netWorth, market)}</td>
                        <td className="num">{score.trades}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
