import { PlaytimeTimer, Phase, formatDuration, formatElapsed, MINUTE, HOUR } from '../src/index.js';
import { createBrowserStorage } from '../src/storage.js';
import { AlarmScheduler } from '../src/alarms.js';

const $ = (id) => document.getElementById(id);
const el = {
  banner: $('banner'), notifyBanner: $('notifyBanner'), notifyText: $('notifyText'), notifyBtn: $('notifyBtn'),
  panel: $('panel'), badge: $('badge'), countdown: $('countdown'), countdownLabel: $('countdownLabel'),
  progressBar: $('progressBar'), claimBtn: $('claimBtn'), endBtn: $('endBtn'), hint: $('hint'),
  gateStudy: $('gateStudy'), gateStudyIcon: $('gateStudyIcon'), gateStudyValue: $('gateStudyValue'),
  gateCooldown: $('gateCooldown'), gateCooldownIcon: $('gateCooldownIcon'), gateCooldownValue: $('gateCooldownValue'),
  studyCard: $('studyCard'), studyCredits: $('studyCredits'), studyBanked: $('studyBanked'),
  studyNeed: $('studyNeed'), studyBar: $('studyBar'), studyBtn: $('studyBtn'), studyHint: $('studyHint'),
  gameLocked: $('gameLocked'), gameOpen: $('gameOpen'), lockedText: $('lockedText'),
  statSessions: $('statSessions'), statPlayed: $('statPlayed'), statStudied: $('statStudied'),
  resetBtn: $('resetBtn'), fastMode: $('fastMode'), pauseOnHide: $('pauseOnHide'),
};

const storage = createBrowserStorage();
const FAST_KEY = 'fake-minecraft:fast-mode';
const PAUSE_KEY = 'fake-minecraft:pause-on-hide';

const alarms = new AlarmScheduler({ storage });
alarms.init();

const isFast = () => storage.getItem(FAST_KEY) === '1';
const pausesOnHide = () => storage.getItem(PAUSE_KEY) === '1';

let timer;
let unbind = [];
/** 离开页面时记下当时的状态, 回来好告诉你这期间发生了什么 */
let phaseWhenHidden = null;

function buildTimer() {
  for (const off of unbind) off();
  unbind = [];
  timer?.stopTicking();

  const fast = isFast();
  timer = new PlaytimeTimer({
    storage,
    storageKey: fast ? 'fake-minecraft:playtime:demo' : 'fake-minecraft:playtime:v2',
    studyRequiredMs: fast ? 30 * 1000 : 6 * HOUR,
    playDurationMs: fast ? 20 * 1000 : 30 * MINUTE,
  });

  unbind.push(timer.on('tick', render));
  unbind.push(timer.on('change', (s) => { rememberPhase(s.phase); syncAlarms(); render(); }));

  // 页面还活着的时候, 通知直接由状态机事件发出。
  // 不能只靠 syncAlarms 排的定时器 —— 每秒 tick 一旦先结算出状态变化,
  // 重排闹钟会把那个还没来得及响的定时器一起清掉, 通知就丢了。
  // alarms.fire() 内部按 id+时间戳 去重, 所以和兜底闹钟同时存在也只会响一条。
  unbind.push(timer.on('session-end', (e) => alarms.fire({
    id: 'play-end', at: e.at,
    title: '游玩时间到了',
    body: timer.cooldownDurationMs > 0
      ? `本轮时间用完，接下来冷却 ${fmtDurationText(timer.cooldownDurationMs)}。`
      : `本轮时间用完，再学满 ${fmtDurationText(timer.studyRequiredMs)}就能再登记。`,
  })));
  unbind.push(timer.on('cooldown-end', (e) => alarms.fire({
    id: 'cooldown-end', at: e.at,
    title: '冷却结束',
    body: timer.getSnapshot().gates.study.passed ? '学习时长够了，现在就能登记。' : '再学一会儿就能登记了。',
  })));
  unbind.push(timer.on('study-goal', (e) => alarms.fire({
    id: 'study-goal', at: e.at,
    title: '学习目标达成',
    body: timer.getSnapshot().gates.cooldown.passed ? '可以登记游玩时间了。' : '等冷却结束就能登记。',
  })));

  // 每秒刷新只是为了让秒数跳动; 状态本身由时间戳决定,
  // 浏览器在后台把定时器节流到几分钟一次也不会算错。
  timer.startTicking(1000);
  syncAlarms();
  render();
  reportWhatHappenedWhileAway();
}

/**
 * 记住上次看到的状态。整个 App 被关掉再打开时, 状态机会在构造函数里
 * 静默结算完(那时还没挂监听器), 靠这个才能告诉你离开期间发生了什么。
 */
const LAST_PHASE_KEY = 'fake-minecraft:last-phase';

function rememberPhase(phase) {
  try { storage.setItem(LAST_PHASE_KEY, phase); } catch { /* 存储不可用就算了 */ }
}

function reportWhatHappenedWhileAway() {
  const before = storage.getItem(LAST_PHASE_KEY);
  const now = timer.getSnapshot().phase;
  if (before && before !== now) {
    const message = {
      [Phase.PLAYING]: '你离开的这段时间，本轮游玩时间用完了。',
      [Phase.COOLDOWN]: '冷却结束了。',
      // 关掉 App 去学, 学满了回来
      [Phase.STUDY_REQUIRED]: now === Phase.READY ? '学习时长够了，可以登记了。' : '',
    }[before];
    if (message) showBanner(message);
  }
  rememberPhase(now);
}

/**
 * 根据当前状态排闹钟。真正会把你从别的 App 里叫回来的就是这几条。
 */
function syncAlarms() {
  const s = timer.getSnapshot();
  const list = [];

  if (s.phase === Phase.PLAYING) {
    list.push({
      id: 'play-end',
      at: s.sessionEndsAt,
      title: '游玩时间到了',
      body: '本轮时间用完，学满之后就能再登记。',
    });
  }

  if (s.cooldownEndsAt !== null) {
    list.push({
      id: 'cooldown-end',
      at: s.cooldownEndsAt,
      title: '冷却结束',
      body: s.gates.study.passed ? '学习时长够了，现在就能登记。' : '还差一点学习时长，学完就能登记。',
    });
  }

  if (s.study.running && !s.study.passed) {
    list.push({
      id: 'study-goal',
      at: s.now + s.study.remainingMs,
      title: '学习目标达成',
      body: '可以回来登记游玩时间了。',
    });
  }

  alarms.set(list);
}

const PHASE_TEXT = {
  [Phase.STUDY_REQUIRED]: {
    badge: '需要学习', label: '还要学这么久才能登记', locked: '先学满才能玩',
  },
  [Phase.READY]: {
    badge: '可以登记', label: '点击下方按钮登记本轮游玩时间', locked: '登记之后才能玩',
  },
  [Phase.PLAYING]: {
    badge: '游玩中', label: '本轮剩余时间', locked: '',
  },
  [Phase.COOLDOWN]: {
    badge: '冷却中', label: '距离冷却结束还有', locked: '冷却中，时间到了才能再玩',
  },
};

function render() {
  const s = timer.getSnapshot();
  const text = PHASE_TEXT[s.phase];

  el.panel.dataset.phase = s.phase;
  el.badge.textContent = s.freeClaimAvailable ? '首次赠送' : text.badge;
  el.countdownLabel.textContent = s.freeClaimAvailable ? '第一次不用学，直接登记' : text.label;

  el.countdown.textContent =
    s.phase === Phase.PLAYING ? formatDuration(s.remainingPlayMs)
      : s.phase === Phase.COOLDOWN ? formatDuration(s.remainingCooldownMs)
        : s.phase === Phase.STUDY_REQUIRED ? formatDuration(s.study.remainingMs)
          : formatDuration(timer.playDurationMs);

  el.progressBar.style.width = `${Math.min(100, Math.max(0, s.progress * 100))}%`;

  // 主按钮
  el.claimBtn.disabled = !s.canClaim;
  el.claimBtn.textContent = s.canClaim
    ? s.freeClaimAvailable ? `领取赠送的 ${fmtDurationText(timer.playDurationMs)}` : `登记 ${fmtDurationText(timer.playDurationMs)}`
    : s.phase === Phase.PLAYING ? '游玩中'
      : s.phase === Phase.COOLDOWN ? '冷却中'
        : '学习未达标';
  el.endBtn.hidden = !s.canPlay;

  // 两道门槛
  setGate(el.gateStudy, el.gateStudyIcon, el.gateStudyValue,
    s.gates.study.passed || s.gates.study.waived,
    s.gates.study.passed ? '已达标'
      : s.gates.study.waived ? '首次赠送'
        : `还差 ${formatDuration(s.gates.study.remainingMs)}`);

  // 默认没有干等的冷却, 那就别占地方
  el.gateCooldown.hidden = timer.cooldownDurationMs === 0;
  setGate(el.gateCooldown, el.gateCooldownIcon, el.gateCooldownValue, s.gates.cooldown.passed,
    s.gates.cooldown.passed ? '已结束' : formatDuration(s.gates.cooldown.remainingMs));

  // 学习卡片
  el.studyCard.dataset.running = String(s.study.running);
  el.studyBanked.textContent = formatElapsed(s.study.bankedMs);
  el.studyNeed.textContent = `/ ${formatDuration(s.study.requiredMs)}`;
  el.studyBar.style.width = `${Math.min(100, s.study.progress * 100)}%`;
  el.studyBtn.disabled = !s.canStudy;
  el.studyBtn.textContent = s.study.running ? '暂停学习' : s.study.bankedMs > 0 ? '继续学习' : '开始学习';
  el.studyCredits.textContent = s.study.credits > 0 ? `存款可登记 ${s.study.credits} 次` : '';
  el.studyHint.textContent = s.canStudy
    ? s.study.running ? '正在计时，可以锁屏去看书，回来再暂停。' : '学习时间也按真实时间走。'
    : '游玩中不计学习时间。';

  // 游玩区域
  el.gameOpen.hidden = !s.canPlay;
  el.gameLocked.hidden = s.canPlay;
  el.lockedText.textContent = text.locked;

  el.statSessions.textContent = String(s.sessionsCompleted);
  el.statPlayed.textContent = fmtMinutes(s.totalPlayedMs);
  el.statStudied.textContent = fmtMinutes(s.totalStudiedMs);

  el.hint.textContent = s.clockAnomalies > 0
    ? '检测到系统时间被往回调整，剩余时间已按真实流逝校正。'
    : '';

  renderNotifyBanner();
}

function setGate(node, icon, value, passed, textValue) {
  node.dataset.passed = String(passed);
  icon.textContent = passed ? '✓' : '○';
  value.textContent = textValue;
}

function fmtMinutes(ms) {
  const min = Math.floor(ms / MINUTE);
  if (min >= 60) return `${Math.floor(min / 60)} 小时 ${min % 60} 分`;
  return `${min} 分钟`;
}

/** 按钮和通知里用的时长文案, 不足 1 分钟时按秒显示 */
function fmtDurationText(ms) {
  if (ms < MINUTE) return `${Math.round(ms / 1000)} 秒`;
  return fmtMinutes(ms);
}

function renderNotifyBanner() {
  const perm = alarms.permission;
  if (perm === 'granted') {
    el.notifyBanner.hidden = true;
    return;
  }
  el.notifyBanner.hidden = false;
  if (perm === 'denied') {
    el.notifyText.textContent = '通知被浏览器拒绝了，切走之后没法叫醒你（回到页面仍会看到正确状态）。';
    el.notifyBtn.hidden = true;
  } else if (perm === 'unsupported') {
    el.notifyText.textContent = '这个浏览器不支持通知，回到页面时会补一条提醒。';
    el.notifyBtn.hidden = true;
  } else {
    el.notifyText.textContent = '开启通知，切到别的 App 时间到了才能叫醒你';
    el.notifyBtn.hidden = false;
  }
}

function showBanner(message) {
  el.banner.textContent = message;
  el.banner.hidden = false;
  setTimeout(() => { el.banner.hidden = true; }, 12000);
}

// ---------------------------------------------------------------- 交互

el.claimBtn.addEventListener('click', () => {
  const res = timer.claim();
  if (res.ok) {
    alarms.requestPermission().then(renderNotifyBanner);
    showBanner('登记成功，可以切到游戏 App 了，时间到会通知你。');
  } else {
    el.hint.textContent = {
      playing: '本轮还在进行中。',
      cooldown: '还在冷却中，冷却结束才能登记。',
      'study-required': `还差 ${formatDuration(res.snapshot.gates.study.remainingMs)} 学习时长。`,
    }[res.reason] ?? '';
  }
});

el.studyBtn.addEventListener('click', () => {
  const s = timer.getSnapshot();
  if (s.study.running) {
    timer.pauseStudy();
  } else {
    timer.startStudy();
    alarms.requestPermission().then(renderNotifyBanner);
  }
});

el.endBtn.addEventListener('click', () => {
  if (confirm('提前结束会立刻进入冷却，没用完的时间不会保留。确定吗？')) timer.endSession();
});

el.resetBtn.addEventListener('click', () => {
  if (confirm('清空全部进度（含学习存款）？')) {
    timer.reset();
    alarms.clear();
  }
});

el.notifyBtn.addEventListener('click', async () => {
  await alarms.requestPermission();
  renderNotifyBanner();
  syncAlarms();
});

el.fastMode.checked = isFast();
el.fastMode.addEventListener('change', () => {
  storage.setItem(FAST_KEY, el.fastMode.checked ? '1' : '0');
  buildTimer();
});

el.pauseOnHide.checked = pausesOnHide();
el.pauseOnHide.addEventListener('change', () => {
  storage.setItem(PAUSE_KEY, el.pauseOnHide.checked ? '1' : '0');
});

// ------------------------------------------------- 切走 / 切回来的处理

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    phaseWhenHidden = timer.getSnapshot().phase;
    // 勾了"离开页面暂停学习"就在这里停掉, 不然离开也照算
    if (pausesOnHide() && timer.getSnapshot().study.running) timer.pauseStudy();
    return;
  }
  onReturn();
});

for (const evt of ['focus', 'pageshow']) {
  globalThis.addEventListener(evt, () => {
    if (document.visibilityState === 'visible') onReturn();
  });
}

/** 回到页面: 立刻结算 + 补发离开期间错过的闹钟 + 告诉你发生了什么 */
function onReturn() {
  const before = phaseWhenHidden;
  const s = timer.refresh();
  alarms.checkMissed();

  if (before && before !== s.phase) {
    const message = {
      [Phase.PLAYING]: '你离开的这段时间，本轮游玩时间用完了。',
      [Phase.COOLDOWN]: '冷却结束了。',
      [Phase.READY]: '学习达标，可以登记了。',
      [Phase.STUDY_REQUIRED]: '',
    }[before];
    if (message) showBanner(message);
  }
  phaseWhenHidden = null;
  syncAlarms();
}

// 多标签页同步: 另一个标签页登记后, 这边也立刻跟上
globalThis.addEventListener('storage', (e) => {
  if (e.key && e.key.startsWith('fake-minecraft:playtime')) buildTimer();
});

buildTimer();
