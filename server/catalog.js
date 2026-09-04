/**
 * 萬象相容層（OmniLayer）的 App 來源目錄。
 *
 * 每個來源作業系統對應一套執行期轉譯方案（runtime adapter）：潮汐 OS 本身只有一套
 * 原生介面層 OmniUI，外來 App 由各自的 runtime 把它的介面與系統呼叫轉譯過來。
 */

export const SOURCES = [
  {
    os: 'tide',
    name: '潮汐 OS',
    short: '原生',
    glyph: '🌊',
    accent: '#2f8fff',
    runtime: 'OmniUI · 原生執行',
    detail: '系統內建 App，直接以原生介面層執行，不經過任何轉譯。',
    builtin: true,
  },
  {
    os: 'ios',
    name: 'iOS',
    short: 'iOS',
    glyph: '📱',
    accent: '#0a84ff',
    runtime: 'DarwinBridge · UIKit 轉譯層',
    detail: 'UIKit 的畫面樹會被即時映射成 OmniUI 節點，手勢與動畫曲線一併轉換。',
  },
  {
    os: 'android',
    name: 'Android',
    short: 'Android',
    glyph: '🤖',
    accent: '#3ddc84',
    runtime: 'ArtVM · ART 位元碼相容層',
    detail: 'dex 位元碼在沙箱內由 ArtVM 直譯，View 階層轉為 OmniUI，權限逐項對映。',
  },
  {
    os: 'harmony',
    name: 'HarmonyOS',
    short: 'Harmony',
    glyph: '🪷',
    accent: '#ff6b5b',
    runtime: 'ArkBridge · ArkTS 執行環境',
    detail: 'ArkTS 宣告式 UI 與潮汐 OS 的組件模型高度相近，轉譯成本最低。',
  },
  {
    os: 'windows',
    name: 'Windows',
    short: 'Win',
    glyph: '🪟',
    accent: '#4aa3ff',
    runtime: 'Win32Layer · PE 載入器 + 視窗轉譯',
    detail: '桌面視窗會被摺疊成單一全螢幕頁面，選單改以長按喚出。',
  },
  {
    os: 'macos',
    name: 'macOS',
    short: 'macOS',
    glyph: '💻',
    accent: '#9aa0a6',
    runtime: 'DarwinBridge · AppKit 轉譯層',
    detail: 'AppKit 與 UIKit 共用同一組 Darwin 系統呼叫轉接表。',
  },
  {
    os: 'linux',
    name: 'Linux',
    short: 'Linux',
    glyph: '🐧',
    accent: '#f2a33c',
    runtime: 'ElfBox · GTK/Qt 轉譯',
    detail: 'ELF 執行檔在使用者態沙箱執行，GTK/Qt 繪製指令改走 OmniUI 後端。',
  },
  {
    os: 'web',
    name: 'Web / PWA',
    short: 'Web',
    glyph: '🌐',
    accent: '#7c6cf0',
    runtime: 'OmniWeb · 內建瀏覽器核心',
    detail: '安裝後與原生 App 同級：可離線、可推播、可放上桌面。',
  },
];

// [id, 名稱, 英文名, 分類, 圖示, 主色, 介面型態, 體積(MB)]
const APPS = {
  ios: [
    ['lumo', '光影', 'Lumo', '攝影修圖', '📷', '#ff7a59', 'photo', 186],
    ['verse', '晨誦', 'Verse', '閱讀', '📖', '#c98a4b', 'doc', 74],
    ['pulse', '節拍', 'Pulse', '健身紀錄', '🏃', '#ff4d6d', 'stats', 112],
    ['ledger', '帳本', 'Ledger', '記帳理財', '💰', '#2fbf71', 'stats', 58],
    ['cloudmap', '雲圖', 'Cloudmap', '地圖導航', '🗺', '#3aa7ff', 'map', 240],
    ['calmly', '靜心', 'Calmly', '冥想放鬆', '🧘', '#6c8cff', 'player', 96],
    ['snapcut', '快剪', 'SnapCut', '影片剪輯', '🎬', '#8b5cf6', 'tool', 318],
  ],
  android: [
    ['linkr', '訊聯', 'Linkr', '即時通訊', '💬', '#22c55e', 'chat', 148],
    ['podbox', '播客盒', 'PodBox', '播客', '🎧', '#f97316', 'player', 88],
    ['scanpro', '掃描王', 'ScanPro', '文件掃描', '🖨', '#0ea5e9', 'tool', 64],
    ['transly', '譯言', 'Transly', '翻譯', '🌐', '#14b8a6', 'tool', 132],
    ['lanego', '車道', 'LaneGo', '車機導航', '🚗', '#4f7cff', 'map', 276],
    ['grain', '米粒', 'Grain', '短影音', '📱', '#ec4899', 'feed', 194],
    ['keepr', '存物', 'Keepr', '雲端備份', '☁️', '#64748b', 'tool', 52],
  ],
  harmony: [
    ['homehub', '智家', 'HomeHub', '智慧家庭', '🏠', '#ff6b5b', 'panel', 96],
    ['traveler', '隨行', 'Traveler', '出行票務', '🎫', '#f59e0b', 'doc', 78],
    ['skyworks', '天工', 'Skyworks', '雲端文件', '📁', '#3b82f6', 'doc', 124],
    ['dandelion', '蒲公英', 'Dandelion', '跨裝置流轉', '🔗', '#10b981', 'panel', 42],
    ['vitaring', '健康圈', 'VitaRing', '健康監測', '❤️', '#ef4444', 'stats', 88],
    ['autolink', '車機互聯', 'AutoLink', '車聯網', '🚙', '#0891b2', 'panel', 156],
    ['metapen', '元筆', 'MetaPen', '手寫筆記', '✍️', '#8b5cf6', 'doc', 110],
  ],
  windows: [
    ['craftdraw', '匠圖', 'CraftDraw', '向量繪圖', '🎨', '#e11d48', 'tool', 640],
    ['finsheet', '財報通', 'FinSheet', '試算表', '📊', '#16a34a', 'stats', 420],
    ['codekeep', '代碼堡', 'CodeKeep', '程式編輯', '⌨️', '#475569', 'code', 580],
    ['screensmith', '錄屏師', 'ScreenSmith', '螢幕錄影', '🎥', '#7c3aed', 'tool', 210],
    ['datakey', '資料鍵', 'DataKey', '資料庫工具', '🗄', '#0f766e', 'code', 336],
    ['starfront', '星際爭鋒', 'StarFront', '策略遊戲', '🎮', '#1d4ed8', 'game', 1840],
    ['flowchartx', '流程圖 X', 'FlowchartX', '圖表繪製', '🧩', '#ea580c', 'tool', 288],
  ],
  macos: [
    ['tracklab', '音軌', 'TrackLab', '音訊工作站', '🎚', '#f43f5e', 'player', 920],
    ['typeset', '排版局', 'TypeSet', '專業排版', '📐', '#0284c7', 'doc', 480],
    ['pixelforge', '影像坊', 'PixelForge', '影像處理', '🖼', '#9333ea', 'photo', 760],
    ['mailbox', '郵匣', 'MailBox', '郵件', '✉️', '#2563eb', 'feed', 96],
    ['timeline', '時間線', 'Timeline', '專案管理', '📅', '#059669', 'stats', 168],
    ['termplus', '終端加', 'TermPlus', '終端機', '🖥️', '#334155', 'code', 44],
    ['lexica', '詞海', 'Lexica', '辭典', '📚', '#b45309', 'doc', 302],
  ],
  linux: [
    ['syswatch', '監控台', 'SysWatch', '系統監控', '📈', '#22d3ee', 'stats', 28],
    ['poddeck', '容器艙', 'PodDeck', '容器管理', '📦', '#3b82f6', 'code', 96],
    ['netprobe', '網探', 'NetProbe', '網路分析', '🛰', '#a3e635', 'stats', 54],
    ['openwrite', '文書坊', 'OpenWrite', '文書處理', '📝', '#f97316', 'doc', 268],
    ['renderfarm', '圖形機', 'RenderFarm', '3D 渲染', '🧊', '#8b5cf6', 'tool', 1240],
    ['keyvault', '密庫', 'KeyVault', '密碼管理', '🔐', '#eab308', 'panel', 36],
    ['mailfetch', '郵遞員', 'MailFetch', '郵件收發', '📮', '#dc2626', 'feed', 22],
  ],
  web: [
    ['boardly', '白板', 'Boardly', '協作白板', '🪄', '#6366f1', 'tool', 6],
    ['formkit', '表單集', 'FormKit', '表單問卷', '🧾', '#0ea5e9', 'doc', 4],
    ['kanflow', '看板', 'KanFlow', '任務看板', '🗂', '#f59e0b', 'panel', 5],
    ['radiowave', '電台', 'RadioWave', '網路電台', '📻', '#ef4444', 'player', 3],
    ['chartwiz', '圖表師', 'ChartWiz', '資料圖表', '📉', '#14b8a6', 'stats', 7],
    ['stickywall', '便籤牆', 'StickyWall', '便籤', '🟨', '#eab308', 'panel', 2],
    ['goplay', '棋道', 'GoPlay', '圍棋對弈', '⚫', '#57534e', 'game', 9],
  ],
};

/** 系統內建 App：永遠已安裝、不可移除 */
export const BUILTIN_APPS = [
  { id: 'store', name: '萬象商店', en: 'OmniStore', category: '應用商店', glyph: '🧭', color: '#2f8fff', kind: 'native', size: 0, os: 'tide', dock: 0 },
  { id: 'notes', name: '備忘錄', en: 'Notes', category: '效率', glyph: '📒', color: '#f6b93b', kind: 'native', size: 0, os: 'tide', dock: 1 },
  { id: 'calculator', name: '計算機', en: 'Calculator', category: '工具', glyph: '🧮', color: '#4b5563', kind: 'native', size: 0, os: 'tide' },
  { id: 'terminal', name: '終端機', en: 'Terminal', category: '開發', glyph: '⌘', color: '#1f2937', kind: 'native', size: 0, os: 'tide', dock: 2 },
  { id: 'photos', name: '相片', en: 'Photos', category: '媒體', glyph: '🌄', color: '#ec4899', kind: 'native', size: 0, os: 'tide' },
  { id: 'clock', name: '時鐘', en: 'Clock', category: '工具', glyph: '⏰', color: '#111827', kind: 'native', size: 0, os: 'tide' },
  { id: 'settings', name: '設定', en: 'Settings', category: '系統', glyph: '⚙️', color: '#6b7280', kind: 'native', size: 0, os: 'tide', dock: 3 },
];

export const CATALOG = Object.entries(APPS).flatMap(([os, rows]) =>
  rows.map(([id, name, en, category, glyph, color, kind, size]) => ({
    id: `${os}.${id}`,
    os,
    name,
    en,
    category,
    glyph,
    color,
    kind,
    size,
  })),
);

const byId = new Map([
  ...CATALOG.map((app) => [app.id, app]),
  ...BUILTIN_APPS.map((app) => [app.id, app]),
]);

export const findApp = (id) => byId.get(id) ?? null;
export const findSource = (os) => SOURCES.find((s) => s.os === os) ?? null;
export const catalogFor = (os) => CATALOG.filter((app) => app.os === os);
