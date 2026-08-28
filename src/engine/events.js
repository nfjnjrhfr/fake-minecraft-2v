// 新聞事件池。事件會對個股 / 類股 / 大盤造成：
//   shock：當根 K 棒的立即衝擊（對數報酬）
//   drift：接下來 ticks 根 K 棒的年化額外漂移
// 文字中的 {name}、{symbol}、{sector} 會被替換成實際標的。

const COMMON_ASSET = [
  { text: '{name}（{symbol}）法說會釋出樂觀展望，外資喊進', tone: 'good', shock: 0.035, drift: 0.5, ticks: 8, weight: 10 },
  { text: '{name} 單季獲利大幅超越市場預期', tone: 'good', shock: 0.06, drift: 0.6, ticks: 10, weight: 8 },
  { text: '{name} 拿下大單，產能傳將滿載到年底', tone: 'good', shock: 0.045, drift: 0.55, ticks: 12, weight: 7 },
  { text: '{name} 宣布庫藏股買回計畫', tone: 'good', shock: 0.025, drift: 0.3, ticks: 6, weight: 6 },
  { text: '{name} 財報不如預期，法人調降目標價', tone: 'bad', shock: -0.055, drift: -0.6, ticks: 10, weight: 9 },
  { text: '{name} 遭爆內控問題，主管機關已介入了解', tone: 'bad', shock: -0.075, drift: -0.8, ticks: 12, weight: 5 },
  { text: '{name} 大股東申報轉讓持股，市場解讀偏空', tone: 'bad', shock: -0.03, drift: -0.35, ticks: 8, weight: 7 },
  { text: '{name} 產品傳出瑕疵，恐面臨大規模退貨', tone: 'bad', shock: -0.05, drift: -0.5, ticks: 9, weight: 5 },
]

const COMMON_SECTOR = [
  { text: '{sector} 類股需求回溫，供應鏈同步受惠', tone: 'good', shock: 0.02, drift: 0.45, ticks: 14, weight: 8 },
  { text: '{sector} 庫存去化不如預期，類股一片慘綠', tone: 'bad', shock: -0.025, drift: -0.5, ticks: 14, weight: 8 },
]

export const EVENT_POOLS = {
  tw: {
    asset: [
      ...COMMON_ASSET,
      { text: '{name} 董事會決議提高現金股利，殖利率題材發酵', tone: 'good', shock: 0.03, drift: 0.4, ticks: 10, weight: 6 },
      { text: '{name} 連續三日獲外資買超，融資餘額同步攀升', tone: 'good', shock: 0.02, drift: 0.35, ticks: 6, weight: 8 },
      { text: '{name} 遭調降至「賣出」評等，早盤跳空摜破月線', tone: 'bad', shock: -0.06, drift: -0.55, ticks: 9, weight: 6 },
      { text: '{name} 廠區傳意外停工，出貨恐遞延一季', tone: 'bad', shock: -0.07, drift: -0.6, ticks: 10, weight: 4 },
    ],
    sector: [
      ...COMMON_SECTOR,
      { text: '政府加碼補助 {sector} 產業，題材點火', tone: 'good', shock: 0.03, drift: 0.55, ticks: 16, weight: 6 },
      { text: '{sector} 報價鬆動，市場擔憂殺價競爭', tone: 'bad', shock: -0.03, drift: -0.45, ticks: 15, weight: 6 },
    ],
    market: [
      { text: '央行意外升息半碼，資金面轉緊', tone: 'bad', shock: -0.018, drift: -0.35, ticks: 15, weight: 8 },
      { text: '外資連續大買台股，加權指數創波段新高', tone: 'good', shock: 0.02, drift: 0.5, ticks: 15, weight: 8 },
      { text: '新台幣急貶，出口族群獲利有望提升', tone: 'good', shock: 0.012, drift: 0.3, ticks: 12, weight: 6 },
      { text: '國際股市重挫，台股早盤開低走低', tone: 'bad', shock: -0.03, drift: -0.4, ticks: 10, weight: 7 },
      { text: '通膨數據高於預期，市場觀望氣氛濃厚', tone: 'bad', shock: -0.012, drift: -0.25, ticks: 12, weight: 7 },
      { text: '政府宣布擴大公共建設投資，內需股領漲', tone: 'good', shock: 0.015, drift: 0.35, ticks: 14, weight: 6 },
    ],
  },

  us: {
    asset: [
      ...COMMON_ASSET,
      { text: '{name} 財報電話會議上調全年財測，盤後大漲', tone: 'good', shock: 0.08, drift: 0.7, ticks: 12, weight: 7 },
      { text: '{name} 宣布分拆事業體並啟動買回', tone: 'good', shock: 0.04, drift: 0.4, ticks: 10, weight: 5 },
      { text: '{name} 執行長無預警請辭，市場信心動搖', tone: 'bad', shock: -0.07, drift: -0.6, ticks: 12, weight: 5 },
      { text: '{name} 遭集體訴訟，法律風險升溫', tone: 'bad', shock: -0.06, drift: -0.55, ticks: 14, weight: 5 },
      { text: '{name} 獲納入主要指數成分股，被動資金將流入', tone: 'good', shock: 0.05, drift: 0.45, ticks: 8, weight: 4 },
    ],
    sector: [
      ...COMMON_SECTOR,
      { text: '{sector} 板塊獲大型基金加碼，資金明顯輪動進場', tone: 'good', shock: 0.025, drift: 0.5, ticks: 15, weight: 6 },
      { text: '監管單位擬對 {sector} 加強審查，估值遭壓縮', tone: 'bad', shock: -0.035, drift: -0.55, ticks: 16, weight: 6 },
    ],
    market: [
      { text: 'Fed 放鷹：點陣圖暗示今年不降息', tone: 'bad', shock: -0.022, drift: -0.4, ticks: 16, weight: 8 },
      { text: 'CPI 降溫超乎預期，市場押注提前降息', tone: 'good', shock: 0.025, drift: 0.55, ticks: 16, weight: 8 },
      { text: '就業數據強勁，殖利率飆升壓抑成長股', tone: 'bad', shock: -0.018, drift: -0.35, ticks: 12, weight: 7 },
      { text: '財報季開局亮眼，指數改寫歷史新高', tone: 'good', shock: 0.02, drift: 0.45, ticks: 14, weight: 7 },
      { text: '地緣衝突升溫，避險情緒主導盤面', tone: 'bad', shock: -0.03, drift: -0.4, ticks: 10, weight: 6 },
      { text: '油價回落，市場通膨預期降溫', tone: 'good', shock: 0.012, drift: 0.3, ticks: 12, weight: 6 },
    ],
  },

  crypto: {
    asset: [
      { text: '{name}（{symbol}）完成主網升級，鏈上活躍地址暴增', tone: 'good', shock: 0.08, drift: 1.2, ticks: 20, weight: 9 },
      { text: '大型交易所宣布上架 {name}，流動性大增', tone: 'good', shock: 0.12, drift: 1.0, ticks: 14, weight: 7 },
      { text: '知名創投宣布重倉 {name}', tone: 'good', shock: 0.09, drift: 0.9, ticks: 18, weight: 7 },
      { text: '{name} 生態基金啟動流動性挖礦，TVL 快速攀升', tone: 'good', shock: 0.06, drift: 0.8, ticks: 16, weight: 7 },
      { text: '{name} 合約傳出漏洞，資金外流中', tone: 'bad', shock: -0.14, drift: -1.3, ticks: 18, weight: 7 },
      { text: '{name} 早期投資人錢包異動，市場擔心出貨', tone: 'bad', shock: -0.09, drift: -0.9, ticks: 14, weight: 8 },
      { text: '{name} 遭交易所列入觀察名單，恐面臨下架', tone: 'bad', shock: -0.16, drift: -1.4, ticks: 20, weight: 5 },
      { text: '{name} 團隊解散傳聞四起，社群一片混亂', tone: 'bad', shock: -0.11, drift: -1.1, ticks: 16, weight: 5 },
      { text: '網紅在社群喊單 {name}，散戶蜂擁進場', tone: 'good', shock: 0.15, drift: 0.6, ticks: 6, weight: 6 },
    ],
    sector: [
      { text: '{sector} 賽道成為本輪資金焦點', tone: 'good', shock: 0.05, drift: 1.0, ticks: 18, weight: 8 },
      { text: '{sector} 敘事退燒，資金快速撤離', tone: 'bad', shock: -0.06, drift: -1.0, ticks: 18, weight: 8 },
    ],
    market: [
      { text: '現貨 ETF 單日淨流入創新高，市場全面噴出', tone: 'good', shock: 0.05, drift: 1.2, ticks: 20, weight: 8 },
      { text: '監管單位傳將收緊交易所牌照，市場全面回檔', tone: 'bad', shock: -0.06, drift: -1.1, ticks: 20, weight: 8 },
      { text: '大型交易所傳出提領異常，恐慌情緒蔓延', tone: 'bad', shock: -0.09, drift: -1.4, ticks: 16, weight: 6 },
      { text: '減半行情提前發動，市場情緒轉為極度貪婪', tone: 'good', shock: 0.06, drift: 1.3, ticks: 22, weight: 7 },
      { text: '全網合約爆倉逾十億美元，槓桿多頭被清洗', tone: 'bad', shock: -0.08, drift: -0.9, ticks: 12, weight: 7 },
      { text: '傳統機構宣布配置加密資產，市場信心回溫', tone: 'good', shock: 0.04, drift: 0.9, ticks: 18, weight: 7 },
    ],
  },
}

// 大盤級別的極端行情（股災 / 資金行情），一場遊戲最多各發生有限次數
export const REGIME_EVENTS = {
  crash: {
    tw: { text: '⚠️ 系統性風險爆發：台股單日重挫，融資斷頭賣壓湧現', shock: -0.055, drift: -1.1, ticks: 22 },
    us: { text: '⚠️ 市場崩跌：恐慌指數飆破 40，資金無差別撤出', shock: -0.06, drift: -1.2, ticks: 22 },
    crypto: { text: '⚠️ 加密市場閃崩：連環清算讓深度瞬間消失', shock: -0.16, drift: -2.0, ticks: 24 },
  },
  boom: {
    tw: { text: '🚀 資金行情啟動：台股量價齊揚，全民瘋股票', shock: 0.04, drift: 1.0, ticks: 24 },
    us: { text: '🚀 軟著陸交易主導盤面，指數連日創高', shock: 0.045, drift: 1.1, ticks: 24 },
    crypto: { text: '🚀 牛市確立：市場情緒進入 FOMO 階段', shock: 0.12, drift: 2.2, ticks: 26 },
  },
}

export function formatEventText(template, asset) {
  if (!asset) return template
  return template
    .replace(/\{name\}/g, asset.name)
    .replace(/\{symbol\}/g, asset.symbol)
    .replace(/\{sector\}/g, asset.sector)
}
