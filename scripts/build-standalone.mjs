// 把 vite build 的產物壓成單一 HTML 檔（CSS 與 JS 全部內嵌），
// 方便直接用瀏覽器開啟或丟到任何靜態空間。
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const dist = 'dist'
const assets = readdirSync(join(dist, 'assets'))
const css = assets.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(dist, 'assets', f), 'utf8'))
const js = assets.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(dist, 'assets', f), 'utf8'))

if (!js.length) {
  console.error('找不到打包後的 JS，請先執行 npm run build')
  process.exit(1)
}

// 內嵌的字串裡若出現 </script> 會提早結束 script 標籤
const escape = (code) => code.replace(/<\/script/gi, '<\\/script')

const html = `<meta charset="utf-8" />
<title>三市場模擬炒股</title>
<style>
${css.join('\n')}
</style>
<div id="root"></div>
<script type="module">
${escape(js.join('\n'))}
</script>
`

writeFileSync(join(dist, 'standalone.html'), html)
console.log(`dist/standalone.html  ${(html.length / 1024).toFixed(0)} kB`)
