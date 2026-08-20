# fake-minecraft-2v · 游玩时间系统

一套「**30 分钟游玩 → 6 小时冷却 → 再领 30 分钟**」的限时游玩系统。
所有计时都基于**绝对时间戳**，页面切到后台、被浏览器节流、甚至整个关掉，时间照样在真实世界里流逝，
下次打开会自动结算到正确的状态。

## 状态机

```
        领取奖励                30 分钟用完               冷却满 6 小时
READY ─────────────► PLAYING ─────────────► COOLDOWN ─────────────► READY
 可领取               游玩中                  冷却中                   可领取
                        └───── 提前结束 ────────┘
```

| 状态 | 含义 | 能玩吗 | 能领取吗 |
| --- | --- | --- | --- |
| `READY` | 空闲，可以领取 30 分钟 | ❌ | ✅ |
| `PLAYING` | 游玩中，倒计时 30 分钟 | ✅ | ❌ |
| `COOLDOWN` | 冷却中，倒计时 6 小时 | ❌ | ❌ |

关键点：**冷却从「游玩实际结束的那一刻」起算，而不是从你下次打开页面被发现的那一刻起算。**
所以玩完 30 分钟直接关掉电脑，7 小时后回来就是 `READY`，不用再等。

## 跑起来看

```bash
npm run serve          # 打开 http://localhost:8080
npm test               # 26 项单元测试
```

演示界面右下角有「演示模式」开关，把 30 分钟 / 6 小时压缩成 30 秒 / 1 分钟，
一分半钟就能肉眼看完整个循环。

## 在代码里用

```js
import { PlaytimeTimer, formatDuration } from './src/index.js';
import { createBrowserStorage } from './src/storage.js';

const timer = new PlaytimeTimer({ storage: createBrowserStorage() });

// 领取 30 分钟
const res = timer.claim();
if (!res.ok) {
  console.log(res.reason === 'cooldown' ? '还在冷却中' : '本轮还没玩完');
}

// 每秒刷新倒计时
timer.startTicking(1000);
timer.on('tick', (s) => {
  console.log(s.phase, formatDuration(s.remainingMs));
});

// 状态迁移时的回调
timer.on('session-end', () => console.log('时间到，开始冷却'));
timer.on('cooldown-end', () => console.log('冷却结束，可以再领了'));
```

### 构造参数

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `storage` | 内存存储 | 与 `localStorage` 同接口（`getItem`/`setItem`）。浏览器传 `createBrowserStorage()`，Node 传 `createFileStorage(路径)` |
| `storageKey` | `'fake-minecraft:playtime:v1'` | 存储键名 |
| `now` | `() => Date.now()` | 时间源。**传服务器时间即可彻底防作弊** |
| `playDurationMs` | 30 分钟 | 单次游玩时长 |
| `cooldownDurationMs` | 6 小时 | 冷却时长 |

### 方法

| 方法 | 说明 |
| --- | --- |
| `claim()` / `startSession()` | 领取并开始游玩。返回 `{ok:true, snapshot}` 或 `{ok:false, reason:'playing'\|'cooldown'}` |
| `endSession()` | 提前结束。冷却立刻起算 6 小时，没用完的时间**不保留** |
| `refresh()` | 结算到此刻并触发应有的状态迁移，返回快照 |
| `getSnapshot()` | 纯读取当前状态，不触发迁移 |
| `on(event, fn)` | 订阅事件，返回取消订阅的函数 |
| `startTicking(ms)` / `stopTicking()` | 定时结算，只为了让 UI 秒数跳动 |
| `reset()` | 清空全部进度 |

### 快照字段

```js
{
  phase,                // 'ready' | 'playing' | 'cooldown'
  canPlay, canClaim,    // 布尔值，直接拿来控制 UI
  remainingMs,          // 当前阶段剩余毫秒
  remainingPlayMs,      // 本轮游玩剩余
  remainingCooldownMs,  // 冷却剩余
  progress,             // 当前阶段进度 0~1
  nextClaimAt,          // 下次可领取的时间戳，READY 时为 null
  sessionsCompleted,    // 已完成场次
  totalPlayedMs,        // 累计游玩时长
  clockAnomalies,       // 检测到系统时间被回拨的次数
}
```

### 事件

`tick`（每次结算）· `change`（状态变化）· `session-start` · `session-end` · `cooldown-end`

## 为什么后台计时是准的

- **不累加 tick，只比较时间戳。** 状态由 `sessionEndsAt` / `cooldownEndsAt` 两个绝对时间决定，
  浏览器把后台标签页的 `setInterval` 节流到几分钟一次也不会算少。
- **一次结算能跨多级。** 离线 10 小时后回来，一次 `refresh()` 直接把
  「游玩结束 → 冷却结束」两级迁移都补上。
- **从 bfcache 恢复也会重算。** `visibilitychange` / `focus` / `pageshow` 都会触发重新结算。
- **多标签页同步。** 监听 `storage` 事件，一个标签页领取后另一个立刻跟上。

## 防作弊

- **往回拨系统时间没用。** 检测到时钟回拨会把所有 deadline 按同样差值平移，剩余时间保持不变，
  并累计到 `clockAnomalies`。
- **往前拨时间**在纯客户端无法根治 —— 生产环境请把 `now` 换成服务器时间，
  或者干脆把 `PlaytimeTimer` 跑在服务端（它不依赖任何浏览器 API）。

## 目录

```
src/playtime-timer.js   核心状态机（浏览器 / Node 通用，零依赖）
src/storage.js          存储适配器：内存 / localStorage / 文件
web/                    演示界面
test/                   单元测试
scripts/serve.js        静态服务器
```
