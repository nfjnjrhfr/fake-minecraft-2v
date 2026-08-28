import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatPrice, formatQty, formatPct, formatTick, tickAxisLabel } from '../engine/format.js'

const MA_LINES = [
  { period: 5, color: '#f5c542', label: 'MA5' },
  { period: 10, color: '#b48cff', label: 'MA10' },
  { period: 20, color: '#4d8dff', label: 'MA20' },
]

const PAD = { left: 8, right: 68, top: 12, bottom: 20 }

function movingAverage(history, period) {
  const out = new Array(history.length).fill(null)
  let sum = 0
  for (let i = 0; i < history.length; i += 1) {
    sum += history[i].c
    if (i >= period) sum -= history[i - period].c
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

function cssVar(el, name, fallback) {
  const value = getComputedStyle(el).getPropertyValue(name).trim()
  return value || fallback
}

export default function PriceChart({ asset, market, range, avgPrice }) {
  const canvasRef = useRef(null)
  const [size, setSize] = useState({ w: 800, h: 340 })
  const [hoverIndex, setHoverIndex] = useState(null)

  const { candles, mas } = useMemo(() => {
    const history = asset.history
    const all = MA_LINES.map((m) => movingAverage(history, m.period))
    const from = Math.max(0, history.length - range)
    return {
      candles: history.slice(from),
      mas: all.map((series) => series.slice(from)),
    }
  }, [asset.history, asset.symbol, range])

  // 跟著容器寬度走，縮放視窗也不會糊掉
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const observer = new ResizeObserver((entries) => {
      const box = entries[0].contentRect
      setSize({ w: Math.max(240, box.width), h: Math.max(180, box.height) })
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || candles.length === 0) return
    const dpr = window.devicePixelRatio || 1
    const { w, h } = size
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const upColor = cssVar(canvas, '--up', '#ff4d4f')
    const downColor = cssVar(canvas, '--down', '#14c784')
    const gridColor = 'rgba(255,255,255,0.05)'
    const dimColor = '#5d6982'

    const plotW = w - PAD.left - PAD.right
    const plotH = h - PAD.top - PAD.bottom
    const priceH = plotH * 0.74
    const volTop = PAD.top + priceH + 12
    const volH = h - PAD.bottom - volTop

    let min = Infinity
    let max = -Infinity
    for (const c of candles) {
      if (c.l < min) min = c.l
      if (c.h > max) max = c.h
    }
    for (const series of mas) {
      for (const v of series) {
        if (v == null) continue
        if (v < min) min = v
        if (v > max) max = v
      }
    }
    if (avgPrice) {
      min = Math.min(min, avgPrice)
      max = Math.max(max, avgPrice)
    }
    const span = max - min || max * 0.02 || 1
    min -= span * 0.06
    max += span * 0.06

    const n = candles.length
    const cw = plotW / n
    const bodyW = Math.max(1, Math.min(14, cw * 0.68))
    const x = (i) => PAD.left + (i + 0.5) * cw
    const y = (p) => PAD.top + ((max - p) / (max - min)) * priceH

    let maxVol = 0
    for (const c of candles) if (c.v > maxVol) maxVol = c.v
    const vy = (v) => volTop + volH - (v / (maxVol || 1)) * volH

    // 價格格線與右側刻度
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.textBaseline = 'middle'
    for (let i = 0; i <= 4; i += 1) {
      const price = max - ((max - min) / 4) * i
      const py = Math.round(y(price)) + 0.5
      ctx.strokeStyle = gridColor
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(PAD.left, py)
      ctx.lineTo(PAD.left + plotW, py)
      ctx.stroke()
      ctx.fillStyle = dimColor
      ctx.textAlign = 'left'
      ctx.fillText(formatPrice(price, market.priceDecimals), PAD.left + plotW + 8, py)
    }

    // 成交量
    for (let i = 0; i < n; i += 1) {
      const c = candles[i]
      const rising = c.c >= c.o
      ctx.fillStyle = rising ? upColor : downColor
      ctx.globalAlpha = 0.35
      const top = vy(c.v)
      ctx.fillRect(x(i) - bodyW / 2, top, bodyW, volTop + volH - top)
      ctx.globalAlpha = 1
    }

    // K 棒
    for (let i = 0; i < n; i += 1) {
      const c = candles[i]
      const rising = c.c >= c.o
      const color = rising ? upColor : downColor
      const cx = Math.round(x(i)) + 0.5
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(cx, y(c.h))
      ctx.lineTo(cx, y(c.l))
      ctx.stroke()
      const yo = y(c.o)
      const yc = y(c.c)
      const top = Math.min(yo, yc)
      const height = Math.max(1, Math.abs(yc - yo))
      ctx.fillStyle = color
      ctx.fillRect(x(i) - bodyW / 2, top, bodyW, height)
    }

    // 均線
    mas.forEach((series, idx) => {
      ctx.strokeStyle = MA_LINES[idx].color
      ctx.lineWidth = 1.2
      ctx.beginPath()
      let started = false
      for (let i = 0; i < n; i += 1) {
        const v = series[i]
        if (v == null) continue
        const px = x(i)
        const py = y(v)
        if (started) ctx.lineTo(px, py)
        else {
          ctx.moveTo(px, py)
          started = true
        }
      }
      ctx.stroke()
    })

    // 持股成本線
    if (avgPrice) {
      const py = Math.round(y(avgPrice)) + 0.5
      ctx.strokeStyle = '#4d8dff'
      ctx.setLineDash([4, 4])
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(PAD.left, py)
      ctx.lineTo(PAD.left + plotW, py)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#4d8dff'
      ctx.textAlign = 'right'
      ctx.fillText('持股成本', PAD.left + plotW - 4, py - 8)
    }

    // 時間軸
    ctx.fillStyle = dimColor
    ctx.textAlign = 'center'
    const labelStep = Math.max(1, Math.ceil(n / 8))
    for (let i = 0; i < n; i += labelStep) {
      ctx.fillText(tickAxisLabel(market, candles[i].t), x(i), h - PAD.bottom / 2)
    }

    // 十字準星
    if (hoverIndex != null && hoverIndex >= 0 && hoverIndex < n) {
      const c = candles[hoverIndex]
      const cx = Math.round(x(hoverIndex)) + 0.5
      ctx.strokeStyle = 'rgba(255,255,255,0.28)'
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(cx, PAD.top)
      ctx.lineTo(cx, volTop + volH)
      ctx.stroke()
      const py = Math.round(y(c.c)) + 0.5
      ctx.beginPath()
      ctx.moveTo(PAD.left, py)
      ctx.lineTo(PAD.left + plotW, py)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#232c40'
      ctx.fillRect(PAD.left + plotW + 2, py - 9, PAD.right - 6, 18)
      ctx.fillStyle = '#e8edf7'
      ctx.textAlign = 'left'
      ctx.fillText(formatPrice(c.c, market.priceDecimals), PAD.left + plotW + 8, py)
    }
  }, [candles, mas, size, hoverIndex, avgPrice, market, asset.symbol])

  const handleMove = useCallback(
    (event) => {
      const canvas = canvasRef.current
      if (!canvas || candles.length === 0) return
      const rect = canvas.getBoundingClientRect()
      const plotW = rect.width - PAD.left - PAD.right
      const cw = plotW / candles.length
      const idx = Math.floor((event.clientX - rect.left - PAD.left) / cw)
      setHoverIndex(idx >= 0 && idx < candles.length ? idx : null)
    },
    [candles.length],
  )

  const active = hoverIndex != null ? candles[hoverIndex] : candles[candles.length - 1]
  const prev = hoverIndex != null ? candles[hoverIndex - 1] : candles[candles.length - 2]
  const change = active && prev ? active.c / prev.c - 1 : 0
  const dir = change > 0 ? 'up' : change < 0 ? 'down' : 'flat'

  return (
    <div className="chart-wrap">
      <canvas
        ref={canvasRef}
        className="chart-canvas"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
      />
      <div className="ohlc-bar">
        {active && (
          <>
            <span>{formatTick(market, active.t)}</span>
            <span>
              開<b>{formatPrice(active.o, market.priceDecimals)}</b>
            </span>
            <span>
              高<b>{formatPrice(active.h, market.priceDecimals)}</b>
            </span>
            <span>
              低<b>{formatPrice(active.l, market.priceDecimals)}</b>
            </span>
            <span>
              收<b className={dir}>{formatPrice(active.c, market.priceDecimals)}</b>
            </span>
            <span className={dir}>{formatPct(change)}</span>
            <span>
              量<b>{formatQty(active.v)}</b>
            </span>
            <span className="legend">
              {MA_LINES.map((m) => (
                <span key={m.period}>
                  <i style={{ background: m.color }} />
                  {m.label}
                </span>
              ))}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
