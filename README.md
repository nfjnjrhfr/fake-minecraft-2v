# veil

一個加密通道，設計目標是在會做深度封包檢測（DPI）與主動探測的網路環境下仍然可用。

連線在網路上看起來就是一次普通的 HTTPS 連線——因為它**本來就是**一次普通的 HTTPS 連線。
沒有前置握手、沒有自訂協定、沒有可辨識的位元組樣式。任何人連上這台伺服器的 443 埠而拿不出
正確憑證的，會被原封不動地交給一個真的網站。

```
應用程式 ──SOCKS5/HTTP──> veil-client ══TLS 1.3══> veil-server ────> 目標網站
  瀏覽器                     本機 1080          看起來是 HTTPS        伺服器代為解析 DNS
                                                       │
                                                       └─驗證失敗─> 誘餌網站（nginx）
```

---

## 這是什麼、不是什麼

| | |
|---|---|
| **是** | 應用層加密代理。瀏覽器與任何支援 SOCKS5/HTTP 代理的程式，流量全程加密。 |
| **不是** | 傳統的全裝置 VPN（不建立 TUN 虛擬網卡、不接管整台機器的路由）。 |

會做這個取捨是刻意的。WireGuard、OpenVPN 那類的 L3 VPN 在協定層有固定的握手特徵，
封鎖系統只要比對前幾個位元組就能認出來並丟棄——在有 DPI 的網路裡通常撐不了太久。
veil 走的是另一條路：**不去發明一個難以辨識的協定，而是直接用世界上最普遍的協定**。

如果你要的是「整台機器所有流量都走通道」，把 veil-client 搭配 tun2socks 這類工具即可，
但那不在這個 repo 的範圍內。

---

## 快速開始

需要：一個**你自己的網域**、一台境外 VPS、Go 1.24+。

### 伺服器端

```bash
git clone https://github.com/nfjnjrhfr/fake-minecraft-2v.git
cd fake-minecraft-2v
sudo ./scripts/install-server.sh
```

腳本會編譯、建立 `veil` 系統帳號、產生隨機密碼、寫好設定與 systemd unit，
然後告訴你**剩下三件必須自己完成的事**：申請憑證、架好誘餌網站、啟動服務。

腳本刻意不幫你做這三件事——它們都跟你的網域有關，不該由腳本替你決定。

手動版本：

```bash
# 1. 憑證（一定要用真憑證，理由見下方「為什麼一定要有網域」）
sudo certbot certonly --standalone -d your-domain.com

# 2. 誘餌網站，只聽 loopback
sudo cp deploy/nginx-decoy.conf /etc/nginx/conf.d/
sudo mkdir -p /var/www/decoy
# 放點像樣的東西進去，不要留預設頁

# 3. 設定
sudo cp examples/server.json /etc/veil/server.json
sudo vim /etc/veil/server.json          # 改密碼與憑證路徑
veil-server -c /etc/veil/server.json -check

# 4. 啟動
sudo systemctl enable --now veil-server
```

或者用 Docker，`docker-compose.yml` 已經把 veil、nginx 誘餌、憑證自動續期組好了：

```bash
cp examples/server.json server.json && vim server.json
docker compose run --rm certbot certonly --standalone -d your-domain.com
docker compose up -d
```

### 客戶端

```bash
make build
cp examples/client.json .
vim client.json                          # 填入伺服器位址與密碼
./bin/veil-client -c client.json
```

本機的 `127.0.0.1:1080` 會同時提供 **SOCKS5 與 HTTP 代理**（自動辨識），
所以不管程式要哪一種，填同一個位址就行。

瀏覽器建議用 SwitchyOmega 之類的擴充功能指向它。系統層設定：

```bash
export https_proxy=http://127.0.0.1:1080
export http_proxy=http://127.0.0.1:1080
export all_proxy=socks5://127.0.0.1:1080
```

---

## 抗封鎖是怎麼做到的

四件事，每一件都對應一種真實存在的偵測手法。

### 1. 流量就是 HTTPS，不是「像」HTTPS

第一個位元組開始就是標準的 TLS 1.3 ClientHello，沒有任何前置資料。認證權杖放在 TLS **裡面**，
不在外面。所以被動 DPI 看到的東西和看一般網站沒有差別。

同時只用 TLS 1.3：TLS 1.2 的握手會把憑證明文送出，等於直接把伺服器的網域告訴檢測系統。

### 2. TLS 指紋偽裝成瀏覽器

Go 標準函式庫的 ClientHello 有很獨特的形狀（擴充順序、密碼套件組合），
有些網路直接對這個指紋做封鎖。veil 客戶端用 [uTLS](https://github.com/refraction-networking/utls)
把 ClientHello 做成 Chrome 的樣子。

```json
"fingerprint": "chrome"    // 也可以 firefox / safari / ios / edge / android / random
```

### 3. 主動探測防禦——最關鍵的一環

封鎖系統的常見做法不只是被動看，還會**主動連上可疑伺服器戳一戳**：
送一個 HTTP 請求、送一段亂數、重放剛才錄到的封包，看看反應。
早年 Shadowsocks 大量被封就是敗在這裡——它對亂數輸入的反應和真網站不一樣。

veil 的答案是：**驗證失敗的連線，一個位元組都不由自己回答**，
而是把對方送來的內容原封不動轉給後面那個真的網站，之後純轉發。

探測者看到的就是一個網站。沒有時間差可以量，沒有特殊的拒絕訊息可以比對。

這一點在測試裡是用**差分比對**驗證的，而不是比對某個預期字串——
同一份探測內容分別送給 veil 伺服器和誘餌網站，兩邊的回應必須完全一致：

```go
throughVeil  := probeAndRead(t, dialTLS(h.serverAddr),   probe)
throughDecoy := probeAndRead(t, dialPlain(h.fallbackAddr), probe)
if !bytes.Equal(throughVeil, throughDecoy) { /* 可被辨識，測試失敗 */ }
```

開發過程中這個測試抓到兩個真的問題，兩個都會導致伺服器被辨識出來：

- **短的 HTTP 探測會讓伺服器卡住。** 原本的實作會死等滿 66 位元組的認證標頭，
  而真的 nginx 收到一個完整的請求行就會立刻回應。「卡住不回」本身就是特徵。
  現在只要出現不可能屬於認證權杖的換行，就立刻走 fallback。
- **ALPN 承諾了做不到的事。** 伺服器原本宣告支援 `h2`，但後面的誘餌只會講 HTTP/1.1。
  於是任何瀏覽器或 curl 連上來都會協商成 HTTP/2，然後連線以一種「真網站不會有的方式」壞掉。
  現在 ALPN 預設只宣告 `http/1.1`，並且可設定——**宣告的必須是誘餌真的做得到的**。

### 4. 埠與憑證要合理

伺服器聽 443。聽 8443 的話，「完美的 HTTPS 流量出現在奇怪的埠上」反而更醒目——
所以不是 443 時程式會主動警告你。

### 為什麼一定要有網域

自簽憑證等於在網路上舉手：全世界的 HTTPS 伺服器都有 CA 簽發的憑證，你沒有。
掃描器只要對著整個 IP 段掃一遍憑證，自簽的立刻就被挑出來。

沒有網域又非用不可時，請務必在客戶端設 `pin`（憑證的 SHA-256），
這樣仍然有完整驗證，只是驗的是你自己的金鑰：

```bash
./scripts/gen-cert.sh your-ip-or-name    # 會直接印出要填的 pin
```

`allow_insecure` 也存在，但它會關掉所有驗證、讓連線可以被中間人解密，
程式啟動時會警告。除了本機除錯之外不要用。

---

## 分流

全部流量都走通道既慢又反效果——通道流量太大本身就是特徵。所以按目的地決定走法：

```json
"route": {
  "bypass_private": true,
  "direct": ["cn", "baidu.com", "bilibili.com", "10.20.0.0/16"],
  "block":  ["doubleclick.net"],
  "final":  "proxy"
}
```

規則寫法：

| 寫法 | 意思 |
|---|---|
| `example.com` | 這個網域與其所有子網域 |
| `full:example.com` | 只有這個網域，不含子網域 |
| `cn` | 整個 `.cn` 頂級網域 |
| `10.0.0.0/8` | CIDR 網段 |
| `1.2.3.4` | 單一 IP |

優先序：`block` > `direct` > `final`。`bypass_private` 預設開啟，
會讓 loopback、區網、link-local（含雲端 metadata 位址 `169.254.169.254`）直連——
關掉它等於把你家印表機的位址送到地球另一端。

**網域規則不會觸發 DNS 查詢。** 這是刻意的：如果比對前先解析，
等於替每一個被封鎖的網域在本地網路上發一個 DNS 查詢，通道就白做了。
走代理的目的地是把網域名送到伺服器端才解析（`socks5h` 的行為）。

---

## 設定

### 伺服器 `server.json`

| 欄位 | 預設 | 說明 |
|---|---|---|
| `listen` | `:443` | 監聽位址。不是 443 會警告。 |
| `users[]` | 必填 | `name` 與 `password`。密碼至少 8 字元，不同使用者不得重複。 |
| `tls.cert` / `tls.key` | 必填 | 憑證與私鑰路徑。更新後送 `SIGHUP` 或等自動偵測，不用重啟。 |
| `fallback` | 必填 | 誘餌網站的 `host:port`。**沒有它伺服器一戳就破**，所以列為必填。 |
| `alpn` | `["http/1.1"]` | TLS 宣告的協定。必須是 `fallback` 真的講得出來的。 |
| `allow_private` | `false` | 是否允許客戶端經由本伺服器連往私有網段。 |
| `handshake_timeout` | `15s` | 客戶端送出請求標頭的時限。 |
| `idle_timeout` | `5m` | 閒置連線回收時間。 |
| `log_level` | `info` | `error` / `warn` / `info` / `debug` / `none`。 |

### 客戶端 `client.json`

| 欄位 | 預設 | 說明 |
|---|---|---|
| `listen` | `127.0.0.1:1080` | 本機 SOCKS5 + HTTP 代理。非 loopback 會警告。 |
| `server.address` | 必填 | 伺服器 `host:port`。 |
| `server.password` | 必填 | 密碼。 |
| `server.sni` | 取自 address | TLS SNI。 |
| `server.fingerprint` | `chrome` | TLS 指紋偽裝對象。 |
| `server.pin` | — | 憑證 SHA-256（hex 或 base64）。自簽憑證時使用。 |
| `server.allow_insecure` | `false` | 關閉憑證驗證。**不要用。** |
| `udp` | `true` | SOCKS5 UDP association（DNS、QUIC 需要）。 |

設定檔不接受未知欄位——設定打錯字會直接報錯，而不是被無聲忽略採用預設值。

---

## 安全性上的取捨

寫在這裡是因為這些是真的限制，不是行銷詞。

- **本機代理沒有認證。** 它預期只綁在 loopback。綁到 `0.0.0.0` 等於開了一個任何人都能用的
  開放代理，而且那些流量都算在你頭上——程式會警告，但不會阻止你。
- **伺服器預設拒絕連往私有網段。** 否則任何拿到密碼的人都能透過它讀取雲端 metadata
  服務（`169.254.169.254`），也就是這台機器的憑證。要當內網跳板才開 `allow_private`。
- **預設不記錄連線目的地。** `info` 等級不會留下任何瀏覽紀錄；目的地只在 `debug` 出現。
  一個抗審查工具最安全的日誌就是沒有日誌。
- **流量分析仍然可行。** 封包大小與時序在這裡沒有被完全掩蓋。對手若有能力做長期的
  統計相關性分析，這個設計擋不住——它擋的是 DPI 特徵比對與主動探測。
- **已知的可辨識點：** 送出**正確**權杖後就不再送任何東西的連線，伺服器會等待，
  而誘餌網站會立刻回應。要走到這一步必須先有密碼，而有密碼的人不需要探測就知道這是什麼，
  所以評估為可接受。這一點在測試裡有明確註記，不是被忽略。

---

## 開發

```bash
make build      # 編譯兩個執行檔
make test       # 測試
make race       # 競態檢測（CI 跑的是這個）
make lint       # gofmt + go vet
make release    # 交叉編譯 linux/darwin/windows × amd64/arm64
```

專案結構：

```
cmd/veil-server        伺服器進入點
cmd/veil-client        客戶端進入點
internal/protocol      線路格式：認證、請求標頭、資料包框架
internal/server        TLS 終結、認證、fallback、轉發
internal/client        撥號、uTLS 指紋、憑證釘選、分流
internal/proxy         本機入口：SOCKS5 + HTTP（同一個埠）
internal/route         目的地比對規則
internal/relay         雙向轉發與閒置逾時
internal/e2e           端對端測試：完整的伺服器 + 客戶端 + TLS
```

### 線路格式

TLS 握手完成後，客戶端立刻送出：

```
+------------+------+-----+------+------+------+--------+---------+------+
| auth (64B) | CRLF | cmd | atyp | addr | port | padlen | padding | CRLF |
+------------+------+-----+------+------+------+--------+---------+------+
```

之後就是承載資料。伺服器**成功時不回任何東西**——它送回的第一個位元組就是目標的真實資料；
失敗則直接關閉。

- `auth` = `hex(SHA-256("veil-auth-v1|" + password))`，加了 domain separation，
  避免和其他地方外洩的密碼雜湊直接通用。
- `padding` 是隨機長度，讓每次連線的第一個 TLS record 長度不固定——
  否則長度會只跟目的地位址有關，本身就是可比對的樣式。
- 位址編碼刻意與 SOCKS5 相同，本機入口收到的位址可以直接送進通道，不必重新編碼。

UDP 則以 `addr | length | CRLF | payload` 的框架在同一條串流上傳送。

---

## 授權與使用

這是隱私與資訊近用工具。請在你所在司法管轄區的法律範圍內使用。
