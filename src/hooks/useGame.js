import { useCallback, useEffect, useRef, useState } from 'react'
import { createGame, advance, advanceMany, netWorth, totalReturn, indexReturn } from '../engine/simulation.js'
import { buy as execBuy, sell as execSell } from '../engine/trading.js'
import { saveGame, loadGame, clearSave, addScore } from '../engine/persistence.js'
import { getMarket, getDifficulty } from '../engine/markets.js'

export const SPEEDS = [
  { id: 'slow', label: '慢', ms: 750 },
  { id: 'normal', label: '中', ms: 330 },
  { id: 'fast', label: '快', ms: 110 },
]

export function useGame() {
  const [state, setState] = useState(null)
  const [savedGame, setSavedGame] = useState(() => loadGame())
  const [toast, setToast] = useState(null)
  const [autoPlay, setAutoPlay] = useState(false)
  const [speedId, setSpeedId] = useState('normal')
  const toastTimer = useRef(null)
  const saveTimer = useRef(null)
  const scoredRef = useRef(null)

  const notify = useCallback((message, tone = 'info') => {
    setToast({ message, tone, id: Date.now() })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2600)
  }, [])

  const start = useCallback((options) => {
    setAutoPlay(false)
    scoredRef.current = null
    const fresh = createGame(options)
    setState(fresh)
    saveGame(fresh)
    setSavedGame(fresh)
  }, [])

  const resume = useCallback(() => {
    if (!savedGame) return
    scoredRef.current = savedGame.status === 'ended' ? savedGame.seed : null
    setState(savedGame)
  }, [savedGame])

  const quit = useCallback(() => {
    setAutoPlay(false)
    clearSave()
    setSavedGame(null)
    setState(null)
  }, [])

  const step = useCallback((count = 1) => {
    setState((prev) => (prev ? advanceMany(prev, count) : prev))
  }, [])

  const trade = useCallback(
    (side, symbol, qty) => {
      setState((prev) => {
        if (!prev) return prev
        const result = side === 'buy' ? execBuy(prev, symbol, qty) : execSell(prev, symbol, qty)
        if (result.error) {
          notify(result.error, 'bad')
          return prev
        }
        notify(result.message, side === 'buy' ? 'buy' : 'sell')
        return result.state
      })
    },
    [notify],
  )

  // 自動播放
  useEffect(() => {
    if (!autoPlay || !state || state.status !== 'playing') return undefined
    const ms = SPEEDS.find((s) => s.id === speedId)?.ms ?? 330
    const timer = setInterval(() => setState((prev) => (prev ? advance(prev) : prev)), ms)
    return () => clearInterval(timer)
  }, [autoPlay, speedId, state?.status, state === null])

  useEffect(() => {
    if (state && state.status !== 'playing') setAutoPlay(false)
  }, [state?.status])

  // 存檔（節流，避免每根 K 棒都寫一次 localStorage）
  useEffect(() => {
    if (!state) return undefined
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveGame(state)
      setSavedGame(state)
    }, 400)
    return () => clearTimeout(saveTimer.current)
  }, [state])

  // 結算時記錄成績
  useEffect(() => {
    if (!state || state.status !== 'ended') return
    if (scoredRef.current === state.seed) return
    scoredRef.current = state.seed
    addScore({
      marketId: state.marketId,
      marketName: getMarket(state.marketId).name,
      difficultyId: state.difficultyId,
      difficultyName: getDifficulty(state.difficultyId).name,
      returnPct: totalReturn(state),
      benchmarkPct: indexReturn(state),
      netWorth: netWorth(state),
      trades: state.stats.tradeCount,
      endReason: state.endReason,
      date: new Date().toISOString(),
    })
  }, [state?.status, state?.seed])

  useEffect(() => () => {
    clearTimeout(toastTimer.current)
    clearTimeout(saveTimer.current)
  }, [])

  return {
    state,
    savedGame,
    toast,
    autoPlay,
    speedId,
    setAutoPlay,
    setSpeedId,
    start,
    resume,
    quit,
    step,
    trade,
    notify,
  }
}
