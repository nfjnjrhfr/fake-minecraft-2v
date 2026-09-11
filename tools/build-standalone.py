#!/usr/bin/env python3
"""把 index.html + css + js 打包成單一個 HTML 檔。

產出兩份：
  standalone/pet-word-game.html  完整文件，存下來雙擊就能離線玩
  standalone/artifact-body.html  同樣內容，但去掉 <!doctype>/<html>/<head>/<body>
                                 外殼，給會自行補上外殼的環境用
"""
import base64, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'standalone'
SCRIPTS = ['js/words.js', 'js/store.js', 'js/util.js', 'js/net.js', 'js/game.js']


def read(rel):
    return (ROOT / rel).read_text(encoding='utf-8')


def data_uri(rel, mime):
    return 'data:%s;base64,%s' % (mime, base64.b64encode((ROOT / rel).read_bytes()).decode())


def build():
    html = read('index.html')
    css = read('css/style.css')

    # 內嵌樣式
    html = html.replace('<link rel="stylesheet" href="css/style.css">',
                        '<style>\n' + css + '\n</style>')

    # 圖示改成 data URI，manifest 拿掉（單檔沒有外部檔案可指）
    icon = data_uri('icons/icon-192.png', 'image/png')
    html = html.replace('<link rel="manifest" href="manifest.webmanifest">\n', '')
    html = html.replace('href="icons/icon-192.png"', 'href="' + icon + '"')

    # 內嵌所有 JS，順序照原本的 <script> 標籤
    bundle = []
    for rel in SCRIPTS:
        bundle.append('/* ===== ' + rel + ' ===== */\n' + read(rel))
    tags = ''.join('<script src="%s"></script>\n' % s for s in SCRIPTS)
    assert tags in html, '找不到原本的 script 標籤'
    html = html.replace(tags, '<script>\n' + '\n\n'.join(bundle) + '\n</script>\n')

    # 單檔版沒有 Service Worker 可註冊，拿掉那段避免多餘的網路請求
    html = re.sub(
        r"\n *// PWA：[^\n]*\n *if \('serviceWorker' in global\.navigator[^\n]*\n[^\n]*\n *\}\n",
        '\n', html)
    assert 'serviceWorker' not in html, 'Service Worker 那段沒有清乾淨'

    OUT.mkdir(exist_ok=True)
    full = OUT / 'pet-word-game.html'
    full.write_text(html, encoding='utf-8')

    # 去外殼版：留下 <title>、<style> 與內容，丟掉 doctype/html/head/body 與 meta/link
    head = re.search(r'<head>(.*?)</head>', html, re.S).group(1)
    body = re.search(r'<body>(.*?)</body>', html, re.S).group(1)
    keep = []
    # 去外殼的環境用短標題（長標題留給存檔用的完整版）
    keep.append('<title>PET 單詞連線</title>')
    keep.append(re.search(r'<style>.*?</style>', head, re.S).group(0))
    inner = OUT / 'artifact-body.html'
    inner.write_text('\n'.join(keep) + '\n' + body.strip() + '\n', encoding='utf-8')

    for f in (full, inner):
        print('%-42s %6.1f KB' % (f.relative_to(ROOT), f.stat().st_size / 1024))


if __name__ == '__main__':
    sys.exit(build())
