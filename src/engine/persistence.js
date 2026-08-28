// localStorage 讀寫。瀏覽器可能停用儲存空間，所以每個操作都包 try/catch，
// 失敗時遊戲照常能玩，只是不會留下紀錄。

const SAVE_KEY = 'stock-sim:save:v1'
const SCORE_KEY = 'stock-sim:scores:v1'
const MAX_SCORES = 20

export function saveGame(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !parsed.assets || !parsed.rng) return null
    return parsed
  } catch {
    return null
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY)
  } catch {
    /* 沒得存就算了 */
  }
}

export function getScores() {
  try {
    const raw = localStorage.getItem(SCORE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function addScore(entry) {
  try {
    const scores = [...getScores(), entry]
      .sort((a, b) => b.returnPct - a.returnPct)
      .slice(0, MAX_SCORES)
    localStorage.setItem(SCORE_KEY, JSON.stringify(scores))
    return scores
  } catch {
    return getScores()
  }
}
