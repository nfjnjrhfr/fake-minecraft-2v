import { PlaytimeTimer, Phase, formatDuration, MINUTE, HOUR } from '../src/index.js';
import { createBrowserStorage } from '../src/storage.js';

const $ = (id) => document.getElementById(id);
const el = {
  panel: $('panel'), badge: $('badge'), countdown: $('countdown'), countdownLabel: $('countdownLabel'),
  progressBar: $('progressBar'), claimBtn: $('claimBtn'), endBtn: $('endBtn'), hint: $('hint'),
  gameLocked: $('gameLocked'), gameOpen: $('gameOpen'), lockedText: $('lockedText'),
  statSessions: $('statSessions'), statTotal: $('statTotal'), statNext: $('statNext'),
  resetBtn: $('resetBtn'), fastMode: $('fastMode'),
};

const storage = createBrowserStorage();
const FAST_KEY = 'fake-minecraft:fast-mode';

/** 演示模式把 30 分钟 / 6 小时压缩成 30 秒 / 1 分钟, 方便肉眼看完整个循环 */
function isFast() {
  return storage.getItem(FAST_KEY) === '1';
}

let timer;
let unbind = [];

function buildTimer() {
  for (const off of unbind) off();
  unbind = [];
  timer?.stopTicking();

  const fast = isFast();
  timer = new PlaytimeTimer({
    storage,
    storageKey: fast ? 'fake-minecraft:playtime:demo' : 'fake-minecraft:playtime:v1',
    playDurationMs: fast ? 30 * 1000 : 30 * MINUTE,
    cooldownDurationMs: fast ? 60 * 1000 : 6 * HOUR,
  });

  unbind.push(timer.on('tick', render));
  unbind.push(timer.on('change', render));
  unbind.push(timer.on('cooldown-end', () => notify('冷却结束', '可以再领取一轮游玩时间了')));
  unbind.push(timer.on('session-end', () => notify('时间到', '本轮 30 分钟已用完，开始冷却')));

  // 每秒刷新只是为了让秒数跳动; 状态本身由时间戳决定,
  // 浏览器在后台把定时器节流到几分钟一次也不会算错。
  timer.startTicking(1000);
  render();
}

function notify(title, body) {
  document.title = `${title} · 游玩时间系统`;
  setTimeout(() => { document.title = '游玩时间系统 · fake-minecraft-2v'; }, 8000);
  if (globalThis.Notification?.permission === 'granted') {
    new Notification(title, { body });
  }
}

const PHASE_TEXT = {
  [Phase.READY]: { badge: '可以领取', label: '点击下方按钮领取本轮游玩时间', locked: '游玩区域已锁定，先领取时间' },
  [Phase.PLAYING]: { badge: '游玩中', label: '本轮剩余时间', locked: '' },
  [Phase.COOLDOWN]: { badge: '冷却中', label: '距离下次可领取还有', locked: '冷却中，时间到了才能再玩' },
};

function render() {
  const s = timer.getSnapshot();
  const text = PHASE_TEXT[s.phase];

  el.panel.dataset.phase = s.phase;
  el.badge.textContent = text.badge;
  el.countdownLabel.textContent = text.label;
  el.countdown.textContent =
    s.phase === Phase.READY ? formatDuration(timer.playDurationMs) : formatDuration(s.remainingMs);

  el.progressBar.style.width = `${Math.min(100, Math.max(0, s.progress * 100))}%`;

  el.claimBtn.disabled = !s.canClaim;
  el.claimBtn.textContent = s.canClaim
    ? `领取 ${Math.round(timer.playDurationMs / MINUTE) || 1} 分钟`
    : s.phase === Phase.PLAYING ? '游玩中' : '冷却中';
  el.endBtn.hidden = !s.canPlay;

  el.gameOpen.hidden = !s.canPlay;
  el.gameLocked.hidden = s.canPlay;
  el.lockedText.textContent = text.locked;

  el.statSessions.textContent = String(s.sessionsCompleted);
  el.statTotal.textContent = `${Math.floor(s.totalPlayedMs / MINUTE)} 分钟`;
  el.statNext.textContent = s.nextClaimAt ? new Date(s.nextClaimAt).toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : '现在';

  el.hint.textContent = s.clockAnomalies > 0
    ? '检测到系统时间被往回调整，剩余时间已按真实流逝校正。'
    : s.phase === Phase.COOLDOWN
      ? '冷却在后台继续走，可以关掉页面，到点再回来。'
      : '';
}

// ---------------------------------------------------------------- 交互

el.claimBtn.addEventListener('click', () => {
  const res = timer.claim();
  if (res.ok) {
    globalThis.Notification?.requestPermission?.().catch(() => {});
  } else {
    el.hint.textContent = res.reason === 'playing' ? '本轮还在进行中。' : '还在冷却中，时间到了才能领取。';
  }
});

el.endBtn.addEventListener('click', () => {
  if (confirm('提前结束会立刻进入冷却，没用完的时间不会保留。确定吗？')) timer.endSession();
});

el.resetBtn.addEventListener('click', () => {
  if (confirm('清空全部进度？')) timer.reset();
});

el.fastMode.checked = isFast();
el.fastMode.addEventListener('change', () => {
  storage.setItem(FAST_KEY, el.fastMode.checked ? '1' : '0');
  buildTimer();
});

// 从后台切回来 / 从 bfcache 恢复时立刻重新结算, 避免看到停在旧数值上的倒计时
for (const evt of ['visibilitychange', 'focus', 'pageshow']) {
  globalThis.addEventListener(evt, () => {
    if (document.visibilityState === 'visible') timer.refresh();
  });
}

// 多标签页同步: 另一个标签页领取后, 这边也立刻跟上
globalThis.addEventListener('storage', (e) => {
  if (e.key && e.key.startsWith('fake-minecraft:playtime')) buildTimer();
});

buildTimer();
