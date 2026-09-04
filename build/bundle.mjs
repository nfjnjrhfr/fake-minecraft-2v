/**
 * 把整套系統打包成單一 HTML，給沒有伺服器的環境（例如 Artifact）使用。
 * 前端程式碼完全共用，差別只在 api() 會走 build/local-api.js 而不是 fetch。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/** 去掉 ES module 的 import／export，讓所有模組可以併在同一個作用域裡 */
function flatten(source) {
  return source
    .replace(/^import\s[^;]*;\s*$/gm, '')
    .replace(/^export\s*\{[^}]*\};?\s*$/gm, '')
    .replace(/^export\s+(const|let|var|function|async function|class)\s/gm, '$1 ')
    .trim();
}

const modules = ['public/util.js', 'server/catalog.js', 'build/local-api.js', 'public/mocks.js', 'public/apps.js', 'public/os.js'];
const script = modules.map((file) => `/* ===== ${file} ===== */\n${flatten(read(file))}`).join('\n\n');

const html = read('public/index.html');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/\s*<script[^>]*><\/script>/g, '')
  .trim();

const sidehintReplacements = [
  [
    /點畫面解鎖，點 App 圖示開啟/,
    '點畫面解鎖，點 App 圖示開啟',
  ],
  [
    /說明：這是一套可互動的系統原型[\s\S]*?真要做到那一步需要 ART、Win32、GTK 等實際執行環境。/,
    '說明：這是一套可互動的系統原型 —— 桌面、視窗、控制中心、商店與相容層的狀態都是真的，'
    + '存在你這台瀏覽器裡（localStorage），重新整理也還在。外來 App 的畫面是相容層的模擬渲染，'
    + '不是真的在執行 APK 或 PE 執行檔。這個網頁版跑在沙箱裡、沒有對外連線的權限，'
    + '所以內建的瀏覽器只能逛 omni.tide 那幾個內建頁面；要瀏覽真實網站，請跑本機版本（npm start），'
    + '那一版會由伺服端把網頁真的抓回來。',
  ],
];
let sidehint = body;
for (const [pattern, text] of sidehintReplacements) sidehint = sidehint.replace(pattern, text);

const out = `<title>潮汐 OS</title>
<style>
${read('public/os.css')}
</style>

${sidehint}

<script type="module">
${script}
</script>
`;

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/tide-os.html'), out);
console.log(`已產生 dist/tide-os.html（${(out.length / 1024).toFixed(0)} KB）`);
