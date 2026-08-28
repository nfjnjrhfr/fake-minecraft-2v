import { netWorth, positionsValue, totalReturn, indexReturn } from '../engine/simulation.js'
import { formatCompact, formatPct, formatTick, tone } from '../engine/format.js'
import { SPEEDS } from '../hooks/useGame.js'

export default function TopBar({
  state,
  market,
  difficulty,
  autoPlay,
  onToggleAuto,
  speedId,
  onSpeedChange,
  onStep,
  onQuit,
}) {
  const total = netWorth(state)
  const ret = totalReturn(state)
  const bench = indexReturn(state)
  const playing = state.status === 'playing'
  const progress = Math.min(100, (state.tick / state.totalTicks) * 100)

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <span className="icon">{market.icon}</span>
        {market.name}
        <span className="badge">{difficulty.name}</span>
      </div>

      <div className="clock">
        <div className="clock-label">
          {formatTick(market, state.tick)}／共 {state.totalTicks} {market.tickShort}
        </div>
        <div className="progress">
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-label">總資產</div>
          <div className="stat-value num">{formatCompact(total, market)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">總報酬</div>
          <div className={`stat-value num ${tone(ret)}`}>{formatPct(ret)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">現金</div>
          <div className="stat-value num sm">{formatCompact(state.cash, market)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">持股市值</div>
          <div className="stat-value num sm">
            {formatCompact(positionsValue(state), market)}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">大盤</div>
          <div className={`stat-value num sm ${tone(bench)}`}>
            {formatPct(bench)}
          </div>
        </div>
      </div>

      <div className="controls">
        <button type="button" className="btn" disabled={!playing} onClick={() => onStep(1)}>
          下一{market.tickShort}
        </button>
        <button type="button" className="btn" disabled={!playing} onClick={() => onStep(5)}>
          快轉 5
        </button>
        <button
          type="button"
          className={`btn${autoPlay ? ' btn-primary' : ''}`}
          disabled={!playing}
          onClick={onToggleAuto}
        >
          {autoPlay ? '⏸ 暫停' : '▶ 自動'}
        </button>
        <div className="speed-group">
          {SPEEDS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={speedId === s.id ? 'active' : ''}
              onClick={() => onSpeedChange(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn" onClick={onQuit}>
          離開
        </button>
      </div>
    </header>
  )
}
