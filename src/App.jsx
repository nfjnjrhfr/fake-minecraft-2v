import { useCallback, useEffect, useMemo, useState } from 'react'
import { useGame } from './hooks/useGame.js'
import { getMarket, getDifficulty } from './engine/markets.js'
import { getScores } from './engine/persistence.js'
import { positionStats } from './engine/trading.js'
import { formatPrice, formatPct } from './engine/format.js'
import StartScreen from './components/StartScreen.jsx'
import TopBar from './components/TopBar.jsx'
import MarketList from './components/MarketList.jsx'
import PriceChart from './components/PriceChart.jsx'
import TradePanel from './components/TradePanel.jsx'
import Portfolio from './components/Portfolio.jsx'
import NewsFeed from './components/NewsFeed.jsx'
import GameOverModal from './components/GameOverModal.jsx'

const RANGES = [
  { label: '30', value: 30 },
  { label: '60', value: 60 },
  { label: '120', value: 120 },
  { label: '全部', value: 9999 },
]

export default function App() {
  const game = useGame()
  const { state } = game
  const [selected, setSelected] = useState(null)
  const [range, setRange] = useState(60)
  const [tab, setTab] = useState('news')
  const [scores, setScores] = useState(() => getScores())

  // 回到選單時重新讀排行榜
  useEffect(() => {
    if (!state) setScores(getScores())
  }, [state])

  useEffect(() => {
    if (!state) return
    if (!selected || !state.assets.some((a) => a.symbol === selected)) {
      setSelected(state.assets[0].symbol)
    }
  }, [state, selected])

  const market = state ? getMarket(state.marketId) : null
  const asset = state && selected ? state.assets.find((a) => a.symbol === selected) : null

  const handleKey = useCallback(
    (event) => {
      if (!state || state.status !== 'playing') return
      const tag = event.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (event.code === 'Space') {
        event.preventDefault()
        game.step(1)
      } else if (event.key === 'a' || event.key === 'A') {
        game.setAutoPlay((v) => !v)
      }
    },
    [game, state],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleKey])

  const pos = useMemo(
    () => (state && asset ? positionStats(state, asset) : null),
    [state, asset],
  )

  if (!state || !asset) {
    return (
      <>
        <StartScreen
          onStart={game.start}
          savedGame={game.savedGame}
          onResume={game.resume}
          scores={scores}
        />
        {game.toast && <div className={`toast ${game.toast.tone}`}>{game.toast.message}</div>}
      </>
    )
  }

  const change = asset.prevClose ? asset.price / asset.prevClose - 1 : 0
  const dir = change > 0 ? 'up' : change < 0 ? 'down' : 'flat'

  return (
    <div className={`game market-${market.id}`}>
      <TopBar
        state={state}
        market={market}
        difficulty={getDifficulty(state.difficultyId)}
        autoPlay={game.autoPlay}
        onToggleAuto={() => game.setAutoPlay((v) => !v)}
        speedId={game.speedId}
        onSpeedChange={game.setSpeedId}
        onStep={game.step}
        onQuit={game.quit}
      />

      <div className="layout">
        <div className="col">
          <MarketList
            assets={state.assets}
            market={market}
            holdings={state.holdings}
            selected={selected}
            onSelect={setSelected}
          />
        </div>

        <div className="col">
          <div className="panel">
            <div className="chart-head">
              <div className="chart-title">
                <h2>{asset.name}</h2>
                <div className="sub">
                  <span className="num">{asset.symbol}</span>
                  <span className="badge">{asset.sector}</span>
                  {pos && (
                    <span>
                      持有 {pos.shares} {market.unit}／均價{' '}
                      {formatPrice(pos.avgPrice, market.priceDecimals)}
                    </span>
                  )}
                </div>
              </div>
              <div className="chart-price">
                <div className={`big num ${dir}`}>
                  {formatPrice(asset.price, market.priceDecimals)}
                </div>
                <div className={`delta num ${dir}`}>
                  {formatPct(change)}
                  {market.priceLimit && Math.abs(change) >= market.priceLimit - 0.0005 && (
                    <strong>{change > 0 ? ' 漲停' : ' 跌停'}</strong>
                  )}
                </div>
              </div>
              <div className="chart-tools">
                {RANGES.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    className={`chip${range === r.value ? ' active' : ''}`}
                    onClick={() => setRange(r.value)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            <PriceChart
              asset={asset}
              market={market}
              range={range}
              avgPrice={pos ? pos.avgPrice : null}
            />
          </div>

          <TradePanel state={state} market={market} asset={asset} onTrade={game.trade} />
        </div>

        <div className="col side-col">
          <Portfolio state={state} market={market} onSelect={setSelected} />
          <NewsFeed
            state={state}
            market={market}
            tab={tab}
            onTabChange={setTab}
            onSelect={setSelected}
          />
        </div>
      </div>

      {game.toast && <div className={`toast ${game.toast.tone}`}>{game.toast.message}</div>}

      {state.status === 'ended' && (
        <GameOverModal
          state={state}
          market={market}
          onRestart={() =>
            game.start({ marketId: state.marketId, difficultyId: state.difficultyId })
          }
          onQuit={game.quit}
        />
      )}
    </div>
  )
}
