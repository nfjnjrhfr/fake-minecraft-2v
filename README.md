# 潮汐 OS（TideOS）· 萬象相容層

一台電子產品的行動作業系統原型。系統本身只有一套原生介面層 **OmniUI**，
真正的主角是 **萬象相容層（OmniLayer）**：它把 iOS、Android、HarmonyOS、
Windows、macOS、Linux、Web 七套作業系統的 App **全部撈進同一個桌面**。

零第三方依賴 —— 只用 Node.js 內建模組與原生前端，`npm start` 之後直接就能玩。

```bash
npm start          # 啟動，預設 http://localhost:3000
npm test           # 16 個測試
PORT=8080 npm start
DB_FILE=/path/device.json npm start   # 指定裝置狀態檔位置
```

## 這台裝置能做什麼

**萬象相容層**
- 七套來源作業系統，共 59 個 App（含 12 款遊戲），每套都有自己的執行期轉譯方案（runtime adapter）
- 商店裡按一下**「一鍵撈取全部」**，把所有系統的 App 一次全裝到桌面
- 也能只撈某一套系統、只撈某一個分類，或單獨撈某一個 App
- 例如：iOS 分頁 → 遊戲分類 →「撈取 iOS 的全部 10 個遊戲」，
  或不選來源直接「一鍵撈取全部遊戲」把各系統的遊戲一次收齊
- 遊戲在相容層裡會依類型（競速／益智／角色扮演／音樂節奏／模擬經營…）呈現不同的畫面
- 撈進來的 App 圖示右下角有來源系統的角標，開啟時頂端會顯示是哪個 runtime 在轉譯
- 相容層可以逐套開關；**關掉不會刪 App，只會讓它在桌面上「暫停」**，點了會提示去設定開啟

| 來源系統 | 執行期轉譯方案 |
| --- | --- |
| iOS | DarwinBridge · UIKit 轉譯層 |
| Android | ArtVM · ART 位元碼相容層 |
| HarmonyOS | ArkBridge · ArkTS 執行環境 |
| Windows | Win32Layer · PE 載入器 + 視窗轉譯 |
| macOS | DarwinBridge · AppKit 轉譯層 |
| Linux | ElfBox · GTK/Qt 轉譯 |
| Web / PWA | OmniWeb · 內建瀏覽器核心 |

**系統外殼**
- 鎖定畫面（時間、日期、備忘錄預覽）、分頁桌面、Dock、App 開關動畫
- 動態島、狀態列、通知橫幅、控制中心（Wi‑Fi／藍牙／勿擾／深色模式／亮度／音量）
- App 切換器、Home 條手勢（點一下回桌面、連點兩下開切換器）
- 真正的深色／淺色主題切換、六款桌布、亮度會實際調暗螢幕

**內建 App**（都是能真的操作的）
- **萬象商店** — 相容層的入口，分來源瀏覽、搜尋、一鍵撈取
- **設定** — 相容層開關、外觀、顯示與聲音、連線、儲存空間、回復原廠
- **備忘錄** — 新增／修改／刪除，存在伺服器上
- **計算機** — 完整四則運算
- **終端機** — `apps`／`sources`／`ls <os> [分類]`／`install`／`fetch <os|all> [分類]`／`uninstall`／`open`／`df`／`uname`
  （例如 `fetch ios 遊戲` 就是把 iOS 遊戲全部撈進來）
- **相片**、**時鐘**（即時世界時鐘）

裝置狀態（設定、已撈取的 App、備忘錄）都寫進 JSON 檔，重開機後還在。

## 操作

| 動作 | 方式 |
| --- | --- |
| 解鎖／鎖定 | 點鎖定畫面 · <kbd>空白鍵</kbd> |
| 回桌面 | 點底部白條 · <kbd>Esc</kbd> |
| App 切換器 | 連點兩下底部白條 |
| 控制中心 | 點右上角狀態列 |
| 換頁 | 左右拖曳桌面，或點頁面圓點 |

## 專案結構

```
server/
  index.js     HTTP 服務：路由、靜態資源（含路徑穿越防護）
  api.js       系統狀態、相容層安裝規則、設定、備忘錄
  catalog.js   七套來源作業系統與 49 個 App 的目錄、內建 App 定義
  db.js        JSON 檔案儲存，寫入時原子替換
public/
  index.html   裝置外框與系統外殼
  os.css       外殼樣式 + 深／淺色主題變數
  os.js        桌面、視窗、控制中心、切換器、通知
  apps.js      七個原生 App 的實作
  mocks.js     相容層執行畫面（依 App 介面型態渲染）
  util.js      共用小工具
test/os.test.js
data/device.json   裝置狀態（已在 .gitignore，首次啟動自動生成）
```

## API

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| GET | `/api/state` | 裝置狀態、相容層、已安裝 App、儲存空間、備忘錄 |
| GET | `/api/catalog?os=&category=&q=` | App 目錄，可依來源系統、分類與關鍵字查詢 |
| POST | `/api/apps/install` | 撈取單一 App |
| POST | `/api/apps/install-all` | 一鍵撈取；帶 `os` 只撈那一套，帶 `category` 只撈那個分類，兩個都不帶就撈全部 |
| POST | `/api/apps/uninstall` | 移除 App |
| PATCH | `/api/device` | 桌布、深色模式、亮度、音量、連線 |
| PATCH | `/api/runtimes` | 開關某一套相容層 |
| GET／POST／PATCH／DELETE | `/api/notes` | 備忘錄 |
| POST | `/api/reset` | 回復原廠設定 |

規則都有測試覆蓋：相容層沒啟用不能撈該系統的 App、重複撈會被擋、內建 App 不可移除、
關閉相容層只暫停不刪除、一鍵撈取會略過未啟用的來源、按分類撈取只會裝到該分類的 App、
不存在的分類會被拒絕、設定值會夾在合法範圍內、狀態重開機後保留。

## 說明

這是一套**可互動的系統原型**：桌面、視窗、控制中心、商店與相容層的狀態都是真的，
而且存在伺服器上。但外來 App 的畫面是相容層依 App 型態做的**模擬渲染** ——
瀏覽器裡沒有在真的執行 APK 或 PE 執行檔。真要做到那一步，需要的是 ART 虛擬機、
Win32 API 實作（WINE 那條路）、GTK/Qt 後端這些實際的執行環境，
以及各平台的系統呼叫轉接表；這個專案把那層架構設計出來並跑通了它的狀態機，
執行引擎本身則留白。

App 名稱全部是虛構的，不對應任何真實產品。
