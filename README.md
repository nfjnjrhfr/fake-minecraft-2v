# fake-minecraft-2v · 游玩时间系统

**学习换游玩时间**：第一个 30 分钟直接送，之后每学满 6 小时才能再登记一次 30 分钟。

计时全部基于**绝对时间戳**，所以你可以登记完就切到别的 App 去玩、也可以关掉 App 去学 ——
时间在真实世界里照走，到点了会**弹通知把你叫回来**，回来时状态一定是结算好的。

## 状态机

```
   第一次直接送
        │
        ▼
  ┌──────────┐    登记    ┌──────────┐   30 分钟用完   ┌─────────────────┐
  │  READY   │ ─────────► │ PLAYING  │ ──────────────► │ STUDY_REQUIRED  │
  │  可登记  │            │ 玩 30 分 │                 │  要学满 6 小时  │
  └──────────┘            └──────────┘                 └────────┬────────┘
        ▲                                                       │
        └───────────────── 学满 6 小时 ─────────────────────────┘
```

| 轮次 | 要付出什么 | 得到什么 |
| --- | --- | --- |
| 第 1 次 | 不用学，白送 | 30 分钟 |
| 第 2 次起 | 学满 6 小时 | 30 分钟 |

学习时长是**存款**：可以分几次学，中间暂停不会白学；一次多学也不浪费，
学 12 小时就存下两次登记的额度（`study.credits === 2`）。

默认**没有干等的冷却** —— 玩完立刻就能开始学下一轮，时间只靠学习换。
真想加干等，把 `cooldownDurationMs` 设成大于 0 即可，它是一道和学习互相独立的门槛。

## 后台计时：切到别的 App 会发生什么

| 你在干嘛 | 计时 | 提醒 |
| --- | --- | --- |
| 切到游戏 App 玩、或者锁屏去学习 | 照走 | ✅ 到点弹通知 |
| 页面被手机系统冻结 | 照走 | ⚠️ 尽力而为（Service Worker 没被回收就能弹） |
| 把 App 整个关掉 | 照走 | ❌ 弹不了，但**打开时状态一定是对的**，还会告诉你离开期间发生了什么 |

三层保险：

1. **页面里的定时器** —— 页面活着就一定响；
2. **Service Worker** —— 页面关了、SW 还没被系统回收时接着响；
3. **回来补发** —— 前两层都被杀掉了，回到页面时立刻补一条通知 + 顶部横幅说明。

第 3 层一定生效，因为状态只看时间戳，不依赖任何定时器活着。
想要 100% 准时的后台闹钟，只能上 Web Push（需要服务端）或原生 App —— 网页做不到，这是浏览器的限制，不是这里偷懒。

系统时间往回拨没用：所有时间锚点会按同样差值平移，剩余时间和已学时长都不变，
并计入 `clockAnomalies`。往前拨在纯前端治不了，把 `now` 换成服务器时间即可根治。

## 跑起来看

```bash
npm run serve          # 打开 http://localhost:8080
npm test               # 56 项单元测试
```

界面底部有「演示模式」开关，把 6 小时 / 30 分钟压成 30 秒 / 20 秒，一分钟看完整个循环。

页面是可安装的 PWA（有 manifest + Service Worker），手机上「添加到主屏幕」之后就是个独立 App，
通知也更容易活下来。

## 在代码里用

```js
import { PlaytimeTimer, Phase, formatDuration } from './src/index.js';
import { createBrowserStorage } from './src/storage.js';

const timer = new PlaytimeTimer({ storage: createBrowserStorage() });

// 第一次不用学, 直接登记
timer.claim();

// 之后要学满 6 小时(按真实时间走，可以锁屏去看书、关掉 App 也照算)
timer.startStudy();
// timer.pauseStudy();     // 暂停，已经学的会存进"存款"，不会白学

// 登记：扣掉 6 小时学习存款，换 30 分钟游玩
const res = timer.claim();
if (!res.ok) {
  console.log({
    'study-required': '学习时长不够',
    cooldown: '还在冷却中',
    playing: '本轮还没玩完',
  }[res.reason]);
}

timer.startTicking(1000);
timer.on('tick', (s) => console.log(s.phase, formatDuration(s.remainingMs)));
timer.on('session-end', () => console.log('时间到，开始冷却'));
timer.on('cooldown-end', () => console.log('冷却结束'));
timer.on('study-goal', () => console.log('学习达标'));
```

### 构造参数

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `storage` | 内存存储 | 与 `localStorage` 同接口。浏览器传 `createBrowserStorage()`，Node 传 `createFileStorage(路径)` |
| `storageKey` | `'fake-minecraft:playtime:v2'` | 存储键名 |
| `now` | `() => Date.now()` | 时间源。**传服务器时间即可彻底防作弊** |
| `studyRequiredMs` | **6 小时** | 登记一次需要的学习时长，设为 `0` 就退化成"纯冷却"模式 |
| `playDurationMs` | 30 分钟 | 单次游玩时长 |
| `cooldownDurationMs` | **0** | 额外的干等冷却，默认没有 |
| `freeFirstClaim` | `true` | 第一次登记免学习（白送的那 30 分钟），设 `false` 则第一次也要学满 |

### 方法

| 方法 | 说明 |
| --- | --- |
| `startStudy()` | 开始/继续计学习时间。游玩中不能学习（`reason: 'playing'`） |
| `pauseStudy()` | 暂停，已学时长存进存款 |
| `claim()` / `startSession()` | 登记。第一次免学习；失败返回 `reason: 'study-required' \| 'cooldown' \| 'playing'` |
| `endSession()` | 提前结束。冷却立刻起算，没用完的时间**不保留** |
| `refresh()` | 结算到此刻并触发应有的状态迁移 |
| `getSnapshot()` | 纯读取当前状态，不触发迁移 |
| `on(event, fn)` | 订阅事件，返回取消订阅的函数 |
| `startTicking(ms)` / `stopTicking()` | 定时结算，只为了让 UI 秒数跳动 |
| `reset()` | 清空全部进度（含学习存款） |

### 快照字段

```js
{
  phase,                // 'study_required' | 'ready' | 'playing' | 'cooldown'
  canPlay, canClaim, canStudy,
  freeClaimAvailable,   // 这次登记用的是不是白送的名额
  remainingPlayMs, remainingCooldownMs, remainingMs, progress,
  gates: {
    study:    { passed, remainingMs, waived },  // waived: 学习没达标但白送名额顶上了
    cooldown: { passed, remainingMs },          // 默认恒为 passed(没有干等冷却)
  },
  study: {
    running,        // 是否正在计学习时间
    bankedMs,       // 学习存款
    requiredMs,     // 登记一次要多少(默认 6 小时)
    remainingMs,    // 还差多久
    progress,       // 0~1
    passed,         // 够不够登记一次
    credits,        // 存款够登记几次
  },
  sessionsCompleted, totalPlayedMs, totalStudiedMs, clockAnomalies,
}
```

### 事件

`tick`（每次结算）· `change`（状态变化）· `study-start` · `study-pause` · `study-goal` ·
`session-start` · `session-end` · `cooldown-end`

### 闹钟层（浏览器）

```js
import { AlarmScheduler } from './src/alarms.js';

const alarms = new AlarmScheduler({ storage: localStorage });
await alarms.init();               // 注册 Service Worker
await alarms.requestPermission();  // 必须由用户点击触发

alarms.set([{ id: 'play-end', at: Date.now() + 30 * 60_000, title: '时间到', body: '快回来' }]);
alarms.checkMissed();              // 回到页面时补发错过的
```

同一条闹钟按 `id + 时间戳` 去重，通知用同 `tag`，所以页面和 Service Worker 同时响也只会看到一条。

> ⚠️ **别只靠 `set()` 排的定时器。** 页面活着的时候，请直接在 `session-end` / `cooldown-end` /
> `study-goal` 事件里调 `alarms.fire()`（`web/app.js` 就是这么做的）。
> 因为每秒的 tick 一旦先结算出状态变化，重排闹钟会把那个还没来得及响的定时器一起清掉，通知就丢了。

## 目录

```
src/playtime-timer.js   核心状态机（浏览器 / Node 通用，零依赖）
src/storage.js          存储适配器：内存 / localStorage / 文件
src/alarms.js           闹钟层：三层保险的通知调度
web/                    可安装的 PWA 界面
web/sw.js               Service Worker：第二层闹钟 + 离线可用
test/                   56 项单元测试
scripts/serve.js        静态服务器
```
