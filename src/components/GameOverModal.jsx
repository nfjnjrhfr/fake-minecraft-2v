import { netWorth, totalReturn, indexReturn } from '../engine/simulation.js'
import { formatCompact, formatMoney, formatPct, tone } from '../engine/format.js'

const RANKS = [
  { min: 1.0, rank: 'S', title: '股神再世', desc: '資產翻倍，這種手氣建議去買樂透（誤）。' },
  { min: 0.5, rank: 'A', title: '操盤高手', desc: '大賺一筆，節奏抓得非常準。' },
  { min: 0.2, rank: 'B', title: '績優投資人', desc: '穩穩獲利，勝過大多數人。' },
  { min: 0.05, rank: 'C', title: '小有斬獲', desc: '有賺就是好事，繼續磨。' },
  { min: -0.05, rank: 'D', title: '原地踏步', desc: '扣掉手續費，忙了一場空。' },
  { min: -0.25, rank: 'E', title: '學費繳了', desc: '賠錢的經驗通常比賺錢更值錢。' },
  { min: -Infinity, rank: 'F', title: '韭菜之王', desc: '幸好這是模擬的。' },
]

export default function GameOverModal({ state, market, onRestart, onQuit }) {
  const ret = totalReturn(state)
  const bench = indexReturn(state)
  const bankrupt = state.endReason === 'bankrupt'
  const rank = bankrupt
    ? { rank: 'F', title: '畢業了', desc: '資產幾乎歸零，這局提前結束。' }
    : RANKS.find((r) => ret >= r.min)
  const alpha = ret - bench
  const cur = market.currency
  const best = state.stats.bestTrade && state.stats.bestTrade.pnl > 0 ? state.stats.bestTrade : null
  const worst = state.stats.worstTrade && state.stats.worstTrade.pnl < 0 ? state.stats.worstTrade : null

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>{bankrupt ? '爆倉出場' : '結算時間到'}</h2>
        <div className={`rank ${ret >= 0 ? 'up' : 'down'}`}>{rank.rank}</div>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>{rank.title}</div>
        <div className="verdict">
          {rank.desc}
          <br />
          {alpha >= 0
            ? `你比大盤多賺了 ${formatPct(alpha)}，確實有打敗市場。`
            : `你輸給大盤 ${(Math.abs(alpha) * 100).toFixed(2)}%，早知道就抱著不動。`}
        </div>

        <div className="result-grid">
          <div>
            <span>最終資產</span>
            <b>{formatCompact(netWorth(state), market)}</b>
          </div>
          <div>
            <span>總報酬率</span>
            <b className={ret >= 0 ? 'up' : 'down'}>{formatPct(ret)}</b>
          </div>
          <div>
            <span>大盤報酬</span>
            <b className={bench >= 0 ? 'up' : 'down'}>{formatPct(bench)}</b>
          </div>
          <div>
            <span>交易次數</span>
            <b>{state.stats.tradeCount}</b>
          </div>
          <div>
            <span>手續費／稅</span>
            <b className="flat">{formatCompact(state.stats.fees, market)}</b>
          </div>
          <div>
            <span>已實現損益</span>
            <b className={tone(state.stats.realized)}>
              {formatCompact(state.stats.realized, market)}
            </b>
          </div>
        </div>

        {(best || worst) && (
          <div className="verdict" style={{ marginBottom: 20 }}>
            {best && (
              <div>
                最賺的一筆：{best.name}{' '}
                <span className="up num">{formatMoney(best.pnl, cur, 0)}</span>
              </div>
            )}
            {worst && (
              <div>
                最痛的一筆：{worst.name}{' '}
                <span className="down num">{formatMoney(worst.pnl, cur, 0)}</span>
              </div>
            )}
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={onRestart}>
            同樣條件再來一局
          </button>
          <button type="button" className="btn" onClick={onQuit}>
            回到選單
          </button>
        </div>
      </div>
    </div>
  )
}
