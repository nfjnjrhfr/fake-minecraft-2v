import { useEffect, useRef, useState } from 'react'

// 資產淨值走勢：跟起始資金比，站在上面是賺、下面是賠
export default function EquityChart({ equity, startCash }) {
  const canvasRef = useRef(null)
  const [size, setSize] = useState({ w: 300, h: 116 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const observer = new ResizeObserver((entries) => {
      const box = entries[0].contentRect
      setSize({ w: Math.max(120, box.width), h: Math.max(60, box.height) })
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !equity.length) return
    const dpr = window.devicePixelRatio || 1
    const { w, h } = size
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const pad = 6
    const values = equity.map((e) => e.value)
    let min = Math.min(...values, startCash)
    let max = Math.max(...values, startCash)
    const span = max - min || Math.abs(max) * 0.02 || 1
    min -= span * 0.1
    max += span * 0.1

    const x = (i) => pad + (i / Math.max(1, equity.length - 1)) * (w - pad * 2)
    const y = (v) => pad + ((max - v) / (max - min)) * (h - pad * 2)
    const last = values[values.length - 1]
    const positive = last >= startCash
    const color = positive ? '#14c784' : '#ff4d4f'

    // 起始資金基準線
    const baseY = Math.round(y(startCash)) + 0.5
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(pad, baseY)
    ctx.lineTo(w - pad, baseY)
    ctx.stroke()
    ctx.setLineDash([])

    ctx.beginPath()
    equity.forEach((point, i) => {
      const px = x(i)
      const py = y(point.value)
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    })
    ctx.strokeStyle = color
    ctx.lineWidth = 1.6
    ctx.stroke()

    ctx.lineTo(x(equity.length - 1), y(min))
    ctx.lineTo(x(0), y(min))
    ctx.closePath()
    const gradient = ctx.createLinearGradient(0, 0, 0, h)
    gradient.addColorStop(0, positive ? 'rgba(20,199,132,0.28)' : 'rgba(255,77,79,0.28)')
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = gradient
    ctx.fill()
  }, [equity, size, startCash])

  return <canvas ref={canvasRef} className="equity-canvas" />
}
