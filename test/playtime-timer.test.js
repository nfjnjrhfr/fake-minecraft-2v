import test from 'node:test';
import assert from 'node:assert/strict';

import { PlaytimeTimer, Phase, formatDuration, formatElapsed, MINUTE, HOUR } from '../src/index.js';
import { createMemoryStorage } from '../src/storage.js';

/** 可控时钟 */
function fakeClock(start = 1_700_000_000_000) {
  let t = start;
  return {
    now: () => t,
    advance(ms) { t += ms; return t; },
    set(ms) { t = ms; return t; },
  };
}

/**
 * 只关心游玩/冷却机制时用: 关掉学习门槛和首次赠送, 打开干等冷却。
 * 这些参数都显式写死, 不受默认值改动影响。
 */
function makeTimer(clock, storage = createMemoryStorage(), extra = {}) {
  return new PlaytimeTimer({
    storage, now: clock.now,
    studyRequiredMs: 0, cooldownDurationMs: 6 * HOUR, freeFirstClaim: false,
    ...extra,
  });
}

/** 只关心学习机制时用: 学满 30 分钟 + 6 小时冷却, 不送首次 */
function makeStudyTimer(clock, storage = createMemoryStorage(), extra = {}) {
  return new PlaytimeTimer({
    storage, now: clock.now,
    studyRequiredMs: 30 * MINUTE, cooldownDurationMs: 6 * HOUR, freeFirstClaim: false,
    ...extra,
  });
}

/** 产品实际默认值: 首个 30 分钟白拿, 之后学满 6 小时换一次, 没有干等冷却 */
function makeDefaultTimer(clock, storage = createMemoryStorage(), extra = {}) {
  return new PlaytimeTimer({ storage, now: clock.now, ...extra });
}

test('初始状态是 READY, 可以领取', () => {
  const clock = fakeClock();
  const timer = makeTimer(clock);
  const s = timer.getSnapshot();
  assert.equal(s.phase, Phase.READY);
  assert.equal(s.canClaim, true);
  assert.equal(s.canPlay, false);
});

test('领取后获得 30 分钟游玩时间', () => {
  const clock = fakeClock();
  const timer = makeTimer(clock);
  const res = timer.claim();
  assert.equal(res.ok, true);
  assert.equal(res.snapshot.phase, Phase.PLAYING);
  assert.equal(res.snapshot.remainingPlayMs, 30 * MINUTE);
  assert.equal(res.snapshot.canPlay, true);
});

test('游玩中剩余时间随真实时间递减', () => {
  const clock = fakeClock();
  const timer = makeTimer(clock);
  timer.claim();
  clock.advance(10 * MINUTE);
  const s = timer.refresh();
  assert.equal(s.phase, Phase.PLAYING);
  assert.equal(s.remainingPlayMs, 20 * MINUTE);
  assert.ok(Math.abs(s.progress - 1 / 3) < 1e-9);
});

test('游玩中不能重复领取', () => {
  const clock = fakeClock();
  const timer = makeTimer(clock);
  timer.claim();
  const res = timer.claim();
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'playing');
});

test('30 分钟用完自动进入 6 小时冷却', () => {
  const clock = fakeClock();
  const timer = makeTimer(clock);
  timer.claim();
  clock.advance(30 * MINUTE);
  const s = timer.refresh();
  assert.equal(s.phase, Phase.COOLDOWN);
  assert.equal(s.remainingCooldownMs, 6 * HOUR);
  assert.equal(s.canPlay, false);
  assert.equal(s.canClaim, false);
  assert.equal(s.sessionsCompleted, 1);
});

test('冷却期间不能领取', () => {
  const clock = fakeClock();
  const timer = makeTimer(clock);
  timer.claim();
  clock.advance(30 * MINUTE + 5 * HOUR);
  const res = timer.claim();
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'cooldown');
  assert.equal(res.snapshot.remainingCooldownMs, 1 * HOUR);
});

test('冷却满 6 小时后可以再次领取 30 分钟', () => {
  const clock = fakeClock();
  const timer = makeTimer(clock);
  timer.claim();
  clock.advance(30 * MINUTE + 6 * HOUR);
  assert.equal(timer.refresh().phase, Phase.READY);

  const res = timer.claim();
  assert.equal(res.ok, true);
  assert.equal(res.snapshot.remainingPlayMs, 30 * MINUTE);
  assert.equal(res.snapshot.phase, Phase.PLAYING);
});

test('冷却从游玩结束那一刻起算, 不是从被发现的那一刻', () => {
  const clock = fakeClock();
  const timer = makeTimer(clock);
  timer.claim();
  // 玩 10 分钟后关掉页面, 3 小时后才回来
  clock.advance(3 * HOUR);
  const s = timer.refresh();
  assert.equal(s.phase, Phase.COOLDOWN);
  // 游玩在第 30 分钟结束, 冷却到第 6.5 小时结束 => 还剩 3.5 小时
  assert.equal(s.remainingCooldownMs, 3.5 * HOUR);
});

test('离线超过 6.5 小时, 回来直接是 READY(一次结算两级跳)', () => {
  const clock = fakeClock();
  const timer = makeTimer(clock);
  timer.claim();
  clock.advance(10 * HOUR);
  const s = timer.refresh();
  assert.equal(s.phase, Phase.READY);
  assert.equal(s.canClaim, true);
  assert.equal(s.sessionsCompleted, 1);
});

test('进度在重启后保留: 关掉进程再新建实例, 时间照走', () => {
  const clock = fakeClock();
  const storage = createMemoryStorage();

  const first = makeTimer(clock, storage);
  first.claim();
  clock.advance(12 * MINUTE);

  // 模拟刷新页面 / 重启进程
  const second = makeTimer(clock, storage);
  const s = second.getSnapshot();
  assert.equal(s.phase, Phase.PLAYING);
  assert.equal(s.remainingPlayMs, 18 * MINUTE);
});

test('后台跨过整个周期后重建实例, 状态直接结算到 READY', () => {
  const clock = fakeClock();
  const storage = createMemoryStorage();

  makeTimer(clock, storage).claim();
  clock.advance(7 * HOUR);

  const revived = makeTimer(clock, storage);
  assert.equal(revived.getSnapshot().phase, Phase.READY);
});

test('提前结束游玩会立刻开始 6 小时冷却', () => {
  const clock = fakeClock();
  const timer = makeTimer(clock);
  timer.claim();
  clock.advance(5 * MINUTE);

  const res = timer.endSession();
  assert.equal(res.ok, true);
  assert.equal(res.snapshot.phase, Phase.COOLDOWN);
  assert.equal(res.snapshot.remainingCooldownMs, 6 * HOUR);
  // 没用完的 25 分钟不会保留
  assert.equal(res.snapshot.remainingPlayMs, 0);
  assert.equal(res.snapshot.totalPlayedMs, 5 * MINUTE);
});

test('未在游玩时调用 endSession 返回 not-playing', () => {
  const clock = fakeClock();
  const timer = makeTimer(clock);
  assert.equal(timer.endSession().reason, 'not-playing');
});

test('把系统时间往回拨不会赚到额外时间', () => {
  const clock = fakeClock();
  const timer = makeTimer(clock);
  timer.claim();
  clock.advance(20 * MINUTE);
  assert.equal(timer.refresh().remainingPlayMs, 10 * MINUTE);

  // 玩家把时钟往回拨 5 小时, 想撤销已经消耗的时间
  clock.advance(-5 * HOUR);
  const s = timer.refresh();
  assert.equal(s.remainingPlayMs, 10 * MINUTE, '剩余时间应保持不变');
  assert.equal(s.clockAnomalies, 1);
});

test('事件按顺序触发', () => {
  const clock = fakeClock();
  const timer = makeTimer(clock);
  const events = [];
  timer.on('session-start', () => events.push('start'));
  timer.on('session-end', () => events.push('end'));
  timer.on('cooldown-end', () => events.push('ready'));

  timer.claim();
  clock.advance(30 * MINUTE);
  timer.refresh();
  assert.deepEqual(events, ['start', 'end']);

  clock.advance(6 * HOUR);
  timer.refresh();
  assert.deepEqual(events, ['start', 'end', 'ready']);
});

test('取消订阅后不再收到事件', () => {
  const clock = fakeClock();
  const timer = makeTimer(clock);
  let n = 0;
  const off = timer.on('change', () => { n += 1; });
  timer.claim();
  const seen = n;
  off();
  clock.advance(30 * MINUTE);
  timer.refresh();
  assert.equal(n, seen);
});

test('监听器抛异常不会打断状态机', () => {
  const clock = fakeClock();
  const timer = makeTimer(clock);
  timer.on('session-start', () => { throw new Error('boom'); });
  const res = timer.claim();
  assert.equal(res.ok, true);
  assert.equal(timer.getSnapshot().phase, Phase.PLAYING);
});

test('时长可配置', () => {
  const clock = fakeClock();
  const timer = makeTimer(clock, createMemoryStorage(), {
    playDurationMs: 2 * MINUTE,
    cooldownDurationMs: 10 * MINUTE,
  });
  timer.claim();
  clock.advance(2 * MINUTE);
  assert.equal(timer.refresh().remainingCooldownMs, 10 * MINUTE);
  clock.advance(10 * MINUTE);
  assert.equal(timer.refresh().phase, Phase.READY);
});

test('非法时长参数被拒绝', () => {
  assert.throws(() => new PlaytimeTimer({ playDurationMs: 0 }), RangeError);
  assert.throws(() => new PlaytimeTimer({ cooldownDurationMs: -1 }), RangeError);
});

test('损坏的存储内容不会导致崩溃', () => {
  const clock = fakeClock();
  const storage = createMemoryStorage({ 'fake-minecraft:playtime:v1': '{不是 json' });
  const timer = makeTimer(clock, storage);
  assert.equal(timer.getSnapshot().phase, Phase.READY);
});

test('存储不可用时降级为纯内存运行', () => {
  const clock = fakeClock();
  const broken = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  };
  const timer = makeTimer(clock, broken);
  assert.equal(timer.claim().ok, true);
  assert.equal(timer.getSnapshot().phase, Phase.PLAYING);
});

test('cooldownReadyAt 指向冷却结束的时刻', () => {
  const clock = fakeClock();
  const timer = makeTimer(clock);
  const start = clock.now();
  timer.claim();
  assert.equal(timer.getSnapshot().cooldownReadyAt, start + 30 * MINUTE + 6 * HOUR);

  clock.advance(30 * MINUTE);
  timer.refresh();
  assert.equal(timer.getSnapshot().cooldownReadyAt, start + 30 * MINUTE + 6 * HOUR);

  clock.advance(6 * HOUR);
  timer.refresh();
  assert.equal(timer.getSnapshot().cooldownReadyAt, null);
});

test('reset 清空全部进度', () => {
  const clock = fakeClock();
  const timer = makeTimer(clock);
  timer.claim();
  clock.advance(30 * MINUTE);
  timer.refresh();
  const s = timer.reset();
  assert.equal(s.phase, Phase.READY);
  assert.equal(s.sessionsCompleted, 0);
});

test('formatDuration 格式化', () => {
  assert.equal(formatDuration(0), '00:00');
  assert.equal(formatDuration(30 * MINUTE), '30:00');
  assert.equal(formatDuration(6 * HOUR), '6:00:00');
  assert.equal(formatDuration(6 * HOUR + 5 * MINUTE + 9000), '6:05:09');
  assert.equal(formatDuration(-5000), '00:00');
});

test('完整循环可以重复多轮', () => {
  const clock = fakeClock();
  const timer = makeTimer(clock);
  for (let i = 1; i <= 3; i += 1) {
    assert.equal(timer.claim().ok, true, `第 ${i} 轮应可领取`);
    clock.advance(30 * MINUTE);
    assert.equal(timer.refresh().phase, Phase.COOLDOWN);
    clock.advance(6 * HOUR);
    assert.equal(timer.refresh().phase, Phase.READY);
    assert.equal(timer.getSnapshot().sessionsCompleted, i);
  }
  assert.equal(timer.getSnapshot().totalPlayedMs, 90 * MINUTE);
});

test('tick 事件每次结算都触发, 供 UI 刷新秒数', () => {
  const clock = fakeClock();
  const timer = makeTimer(clock);
  let ticks = 0;
  timer.on('tick', () => { ticks += 1; });
  timer.claim();
  const base = ticks;
  clock.advance(1000);
  timer.refresh();
  clock.advance(1000);
  timer.refresh();
  assert.equal(ticks, base + 2);
});

// ------------------------------------------------------------ 学习换游玩时间

test('初始状态是 STUDY_REQUIRED, 没学习不能登记', () => {
  const clock = fakeClock();
  const timer = makeStudyTimer(clock);
  const s = timer.getSnapshot();
  assert.equal(s.phase, Phase.STUDY_REQUIRED);
  assert.equal(s.canClaim, false);
  assert.equal(s.canStudy, true);
  assert.equal(s.study.remainingMs, 30 * MINUTE);

  const res = timer.claim();
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'study-required');
});

test('学满 30 分钟后才能登记, 登记扣掉这 30 分钟', () => {
  const clock = fakeClock();
  const timer = makeStudyTimer(clock);

  timer.startStudy();
  clock.advance(29 * MINUTE);
  assert.equal(timer.refresh().phase, Phase.STUDY_REQUIRED, '差 1 分钟还不行');
  assert.equal(timer.claim().ok, false);

  clock.advance(1 * MINUTE);
  const s = timer.refresh();
  assert.equal(s.phase, Phase.READY);
  assert.equal(s.study.passed, true);

  const res = timer.claim();
  assert.equal(res.ok, true);
  assert.equal(res.snapshot.remainingPlayMs, 30 * MINUTE);
  // 存款被扣光, 下一轮要重新学
  assert.equal(res.snapshot.study.bankedMs, 0);
  assert.equal(res.snapshot.study.running, false, '登记后自动停止学习计时');
});

test('学习时间可以分段累计, 暂停不会白学', () => {
  const clock = fakeClock();
  const timer = makeStudyTimer(clock);

  timer.startStudy();
  clock.advance(10 * MINUTE);
  timer.pauseStudy();
  assert.equal(timer.getSnapshot().study.bankedMs, 10 * MINUTE);

  clock.advance(3 * HOUR);   // 中间干别的, 不计学习
  assert.equal(timer.getSnapshot().study.bankedMs, 10 * MINUTE);

  timer.startStudy();
  clock.advance(20 * MINUTE);
  const s = timer.refresh();
  assert.equal(s.study.bankedMs, 30 * MINUTE);
  assert.equal(s.phase, Phase.READY);
});

test('学习也在后台走: 开始学习后关掉页面, 重建实例照样累计', () => {
  const clock = fakeClock();
  const storage = createMemoryStorage();

  makeStudyTimer(clock, storage).startStudy();
  clock.advance(35 * MINUTE);

  const revived = makeStudyTimer(clock, storage);
  const s = revived.getSnapshot();
  assert.equal(s.study.running, true, '学习状态应当保持');
  assert.equal(s.study.bankedMs, 35 * MINUTE);
  assert.equal(s.phase, Phase.READY);
});

test('游玩中不能学习, 避免一份时间用两次', () => {
  const clock = fakeClock();
  const timer = makeStudyTimer(clock);
  timer.startStudy();
  clock.advance(30 * MINUTE);
  timer.claim();

  assert.equal(timer.getSnapshot().canStudy, false);
  const res = timer.startStudy();
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'playing');
});

test('重复调用 startStudy 不会重复计时', () => {
  const clock = fakeClock();
  const timer = makeStudyTimer(clock);
  timer.startStudy();
  clock.advance(5 * MINUTE);
  const res = timer.startStudy();
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'already-studying');
  clock.advance(5 * MINUTE);
  assert.equal(timer.getSnapshot().study.bankedMs, 10 * MINUTE);
});

test('没在学习时 pauseStudy 返回 not-studying', () => {
  const clock = fakeClock();
  const timer = makeStudyTimer(clock);
  assert.equal(timer.pauseStudy().reason, 'not-studying');
});

test('冷却和学习是两道独立门槛: 冷却期间可以先把学习做掉', () => {
  const clock = fakeClock();
  const timer = makeStudyTimer(clock);

  timer.startStudy();
  clock.advance(30 * MINUTE);
  timer.claim();
  clock.advance(30 * MINUTE);           // 玩完 30 分钟
  assert.equal(timer.refresh().phase, Phase.COOLDOWN);

  // 冷却中就开始学下一轮
  timer.startStudy();
  clock.advance(30 * MINUTE);
  const mid = timer.refresh();
  assert.equal(mid.phase, Phase.COOLDOWN, '学习达标了但冷却还没完');
  assert.equal(mid.gates.study.passed, true);
  assert.equal(mid.gates.cooldown.passed, false);
  assert.equal(timer.claim().reason, 'cooldown');

  // 冷却一结束就能立刻登记
  clock.advance(5.5 * HOUR);
  const s = timer.refresh();
  assert.equal(s.phase, Phase.READY);
  assert.equal(timer.claim().ok, true);
});

test('冷却完了但学习不够, 停在 STUDY_REQUIRED', () => {
  const clock = fakeClock();
  const timer = makeStudyTimer(clock);

  timer.startStudy();
  clock.advance(30 * MINUTE);
  timer.claim();
  clock.advance(30 * MINUTE + 6 * HOUR);

  const s = timer.refresh();
  assert.equal(s.phase, Phase.STUDY_REQUIRED);
  assert.equal(s.gates.cooldown.passed, true);
  assert.equal(s.gates.study.passed, false);
  assert.equal(timer.claim().reason, 'study-required');
});

test('可以提前学出多份存款, credits 反映能登记几次', () => {
  const clock = fakeClock();
  const timer = makeStudyTimer(clock);

  timer.startStudy();
  clock.advance(75 * MINUTE);
  timer.pauseStudy();

  let s = timer.getSnapshot();
  assert.equal(s.study.credits, 2);
  assert.equal(s.study.bankedMs, 75 * MINUTE);

  timer.claim();
  s = timer.getSnapshot();
  assert.equal(s.study.bankedMs, 45 * MINUTE);
  assert.equal(s.study.credits, 1);

  // 玩完 + 冷却结束后, 靠存款直接登记, 不用再学
  clock.advance(30 * MINUTE + 6 * HOUR);
  assert.equal(timer.refresh().phase, Phase.READY);
  assert.equal(timer.claim().ok, true);
  assert.equal(timer.getSnapshot().study.bankedMs, 15 * MINUTE);
});

test('study-goal 事件在学习达标时触发一次', () => {
  const clock = fakeClock();
  const timer = makeStudyTimer(clock);
  let goals = 0;
  timer.on('study-goal', () => { goals += 1; });

  timer.startStudy();
  clock.advance(30 * MINUTE);
  timer.refresh();
  assert.equal(goals, 1);

  clock.advance(10 * MINUTE);
  timer.refresh();
  assert.equal(goals, 1, '继续学不该重复触发');

  // 登记后存款清零, 再学满一次应该再触发
  timer.claim();
  clock.advance(30 * MINUTE);
  timer.refresh();
  timer.startStudy();
  clock.advance(30 * MINUTE);
  timer.refresh();
  assert.equal(goals, 2);
});

test('学习时长可配置', () => {
  const clock = fakeClock();
  const timer = makeStudyTimer(clock, createMemoryStorage(), {
    studyRequiredMs: 45 * MINUTE,
    playDurationMs: 20 * MINUTE,
  });
  timer.startStudy();
  clock.advance(45 * MINUTE);
  assert.equal(timer.refresh().phase, Phase.READY);
  assert.equal(timer.claim().snapshot.remainingPlayMs, 20 * MINUTE);
});

test('时钟回拨不会凭空多出学习时长', () => {
  const clock = fakeClock();
  const timer = makeStudyTimer(clock);
  timer.startStudy();
  clock.advance(10 * MINUTE);
  assert.equal(timer.refresh().study.bankedMs, 10 * MINUTE);

  clock.advance(-2 * HOUR);
  const s = timer.refresh();
  assert.equal(s.study.bankedMs, 10 * MINUTE);
  assert.equal(s.clockAnomalies, 1);
});

test('v1 存档能平滑升级到 v2(保留冷却, 学习从零开始)', () => {
  const clock = fakeClock();
  const now = clock.now();
  const v1 = JSON.stringify({
    version: 1,
    sessionStartedAt: null,
    sessionEndsAt: null,
    cooldownEndsAt: now + 2 * HOUR,
    sessionsCompleted: 3,
    totalPlayedMs: 90 * MINUTE,
    lastSeenAt: now,
    clockAnomalies: 0,
  });
  const storage = createMemoryStorage({ 'fake-minecraft:playtime:v2': v1 });
  const timer = makeStudyTimer(clock, storage);

  const s = timer.getSnapshot();
  assert.equal(s.phase, Phase.COOLDOWN);
  assert.equal(s.remainingCooldownMs, 2 * HOUR);
  assert.equal(s.sessionsCompleted, 3);
  assert.equal(s.study.bankedMs, 0);
});

test('完整循环: 学习 -> 登记 -> 游玩 -> 冷却 -> 再学习', () => {
  const clock = fakeClock();
  const timer = makeStudyTimer(clock);

  for (let i = 1; i <= 3; i += 1) {
    assert.equal(timer.getSnapshot().phase, Phase.STUDY_REQUIRED, `第 ${i} 轮应先学习`);

    timer.startStudy();
    clock.advance(30 * MINUTE);
    assert.equal(timer.refresh().phase, Phase.READY);

    assert.equal(timer.claim().ok, true);
    clock.advance(30 * MINUTE);
    assert.equal(timer.refresh().phase, Phase.COOLDOWN);

    clock.advance(6 * HOUR);
    assert.equal(timer.refresh().phase, Phase.STUDY_REQUIRED, '冷却完还得再学');
    assert.equal(timer.getSnapshot().sessionsCompleted, i);
  }

  const s = timer.getSnapshot();
  assert.equal(s.totalPlayedMs, 90 * MINUTE);
  assert.equal(s.totalStudiedMs, 90 * MINUTE);
});

test('formatElapsed 向下取整, 和倒计时不打架', () => {
  // 同一个 10.5 秒: 已过去显示 10 秒, 还剩显示 11 秒, 两者相加不会超过总数
  assert.equal(formatElapsed(10_500), '00:10');
  assert.equal(formatDuration(10_500), '00:11');
  assert.equal(formatElapsed(0), '00:00');
  assert.equal(formatElapsed(-5000), '00:00');
  assert.equal(formatElapsed(90 * MINUTE), '1:30:00');
});

// ---------------------------------------------- 产品默认: 白拿一次 + 学满 6 小时

test('默认值: 学 6 小时换 30 分钟, 没有干等冷却', () => {
  const timer = makeDefaultTimer(fakeClock());
  assert.equal(timer.studyRequiredMs, 6 * HOUR);
  assert.equal(timer.playDurationMs, 30 * MINUTE);
  assert.equal(timer.cooldownDurationMs, 0);
  assert.equal(timer.freeFirstClaim, true);
});

test('第一个 30 分钟白拿: 一上来就能登记, 不用学', () => {
  const clock = fakeClock();
  const timer = makeDefaultTimer(clock);

  const s = timer.getSnapshot();
  assert.equal(s.phase, Phase.READY);
  assert.equal(s.canClaim, true);
  assert.equal(s.freeClaimAvailable, true);
  assert.equal(s.gates.study.waived, true, '学习门槛被赠送名额顶掉');
  assert.equal(s.study.bankedMs, 0);

  const res = timer.claim();
  assert.equal(res.ok, true);
  assert.equal(res.snapshot.remainingPlayMs, 30 * MINUTE);
  assert.equal(res.snapshot.study.bankedMs, 0, '白拿不该扣出负数存款');
});

test('白拿只有一次: 玩完之后必须学满 6 小时', () => {
  const clock = fakeClock();
  const timer = makeDefaultTimer(clock);

  timer.claim();
  clock.advance(30 * MINUTE);

  const s = timer.refresh();
  assert.equal(s.phase, Phase.STUDY_REQUIRED, '没有干等冷却, 直接卡在学习上');
  assert.equal(s.freeClaimAvailable, false);
  assert.equal(s.study.remainingMs, 6 * HOUR);
  assert.equal(timer.claim().reason, 'study-required');
});

test('学满 6 小时才能登记第二次, 差一分钟都不行', () => {
  const clock = fakeClock();
  const timer = makeDefaultTimer(clock);
  timer.claim();
  clock.advance(30 * MINUTE);
  timer.refresh();

  timer.startStudy();
  clock.advance(5 * HOUR + 59 * MINUTE);
  assert.equal(timer.refresh().phase, Phase.STUDY_REQUIRED);
  assert.equal(timer.claim().ok, false);

  clock.advance(1 * MINUTE);
  assert.equal(timer.refresh().phase, Phase.READY);
  const res = timer.claim();
  assert.equal(res.ok, true);
  assert.equal(res.snapshot.study.bankedMs, 0, '存款被扣掉 6 小时');
});

test('玩完立刻能接着学, 中间不用干等', () => {
  const clock = fakeClock();
  const timer = makeDefaultTimer(clock);
  timer.claim();
  clock.advance(30 * MINUTE);
  timer.refresh();

  const res = timer.startStudy();
  assert.equal(res.ok, true);
  assert.equal(res.snapshot.gates.cooldown.passed, true);
});

test('赠送名额跨重启只算一次', () => {
  const clock = fakeClock();
  const storage = createMemoryStorage();

  makeDefaultTimer(clock, storage).claim();
  clock.advance(30 * MINUTE);

  const revived = makeDefaultTimer(clock, storage);
  const s = revived.getSnapshot();
  assert.equal(s.phase, Phase.STUDY_REQUIRED);
  assert.equal(s.freeClaimAvailable, false);
  assert.equal(revived.claim().reason, 'study-required');
});

test('6 小时学习也在后台走: 开始学习后关掉页面, 回来直接可登记', () => {
  const clock = fakeClock();
  const storage = createMemoryStorage();

  const first = makeDefaultTimer(clock, storage);
  first.claim();
  clock.advance(30 * MINUTE);
  first.refresh();
  first.startStudy();

  // 关掉页面, 去学 6 个小时
  clock.advance(6 * HOUR);

  const revived = makeDefaultTimer(clock, storage);
  const s = revived.getSnapshot();
  assert.equal(s.phase, Phase.READY);
  assert.equal(s.study.bankedMs, 6 * HOUR);
  assert.equal(revived.claim().ok, true);
});

test('学 12 小时可以攒够两次登记', () => {
  const clock = fakeClock();
  const timer = makeDefaultTimer(clock);
  timer.claim();                       // 先把白拿的用掉
  clock.advance(30 * MINUTE);
  timer.refresh();

  timer.startStudy();
  clock.advance(12 * HOUR);
  timer.pauseStudy();
  assert.equal(timer.getSnapshot().study.credits, 2);

  assert.equal(timer.claim().ok, true);
  clock.advance(30 * MINUTE);
  assert.equal(timer.refresh().phase, Phase.READY, '存款还够一次, 不用再学');
  assert.equal(timer.claim().ok, true);
  clock.advance(30 * MINUTE);
  assert.equal(timer.refresh().phase, Phase.STUDY_REQUIRED, '存款用完了');
});

test('freeFirstClaim: false 时第一次也要学满', () => {
  const clock = fakeClock();
  const timer = makeDefaultTimer(clock, createMemoryStorage(), { freeFirstClaim: false });
  assert.equal(timer.getSnapshot().phase, Phase.STUDY_REQUIRED);
  assert.equal(timer.claim().reason, 'study-required');
});

test('v2 存档升级: 已经玩过的不再补送白拿名额', () => {
  const clock = fakeClock();
  const v2 = JSON.stringify({
    version: 2,
    sessionStartedAt: null, sessionEndsAt: null, cooldownEndsAt: null,
    studyBankedMs: 0, studyStartedAt: null, totalStudiedMs: 60 * MINUTE,
    sessionsCompleted: 2, totalPlayedMs: 60 * MINUTE,
    lastSeenAt: clock.now(), clockAnomalies: 0,
  });
  const storage = createMemoryStorage({ 'fake-minecraft:playtime:v2': v2 });
  const timer = makeDefaultTimer(clock, storage);

  const s = timer.getSnapshot();
  assert.equal(s.phase, Phase.STUDY_REQUIRED);
  assert.equal(s.freeClaimAvailable, false);
  assert.equal(s.sessionsCompleted, 2);
});

test('全新 v2 存档(还没玩过)升级后仍然保留白拿名额', () => {
  const clock = fakeClock();
  const v2 = JSON.stringify({
    version: 2,
    sessionStartedAt: null, sessionEndsAt: null, cooldownEndsAt: null,
    studyBankedMs: 5 * MINUTE, studyStartedAt: null, totalStudiedMs: 5 * MINUTE,
    sessionsCompleted: 0, totalPlayedMs: 0,
    lastSeenAt: clock.now(), clockAnomalies: 0,
  });
  const storage = createMemoryStorage({ 'fake-minecraft:playtime:v2': v2 });
  const timer = makeDefaultTimer(clock, storage);

  assert.equal(timer.getSnapshot().phase, Phase.READY);
  assert.equal(timer.getSnapshot().freeClaimAvailable, true);
});

test('默认配置下的完整循环: 白拿 -> 玩 -> 学 6 小时 -> 玩', () => {
  const clock = fakeClock();
  const timer = makeDefaultTimer(clock);

  // 第 1 轮: 白拿
  assert.equal(timer.claim().ok, true);
  clock.advance(30 * MINUTE);
  assert.equal(timer.refresh().phase, Phase.STUDY_REQUIRED);

  // 第 2、3 轮: 各学 6 小时
  for (let i = 2; i <= 3; i += 1) {
    timer.startStudy();
    clock.advance(6 * HOUR);
    assert.equal(timer.refresh().phase, Phase.READY, `第 ${i} 轮学满后应可登记`);
    timer.pauseStudy();

    assert.equal(timer.claim().ok, true);
    clock.advance(30 * MINUTE);
    assert.equal(timer.refresh().phase, Phase.STUDY_REQUIRED);
  }

  const s = timer.getSnapshot();
  assert.equal(s.sessionsCompleted, 3);
  assert.equal(s.totalPlayedMs, 90 * MINUTE);
  assert.equal(s.totalStudiedMs, 12 * HOUR);
});

test('冷却时长为 0 时不进冷却, 也不发"冷却结束"的空提醒', () => {
  const clock = fakeClock();
  const timer = makeDefaultTimer(clock);
  const events = [];
  timer.on('session-end', () => events.push('end'));
  timer.on('cooldown-end', () => events.push('cooldown-end'));

  timer.claim();
  clock.advance(30 * MINUTE);
  const s = timer.refresh();

  assert.deepEqual(events, ['end'], '不该冒出 cooldown-end');
  assert.equal(s.cooldownEndsAt, null);
  assert.equal(s.phase, Phase.STUDY_REQUIRED);
});

test('提前结束在无冷却配置下也不留冷却', () => {
  const clock = fakeClock();
  const timer = makeDefaultTimer(clock);
  timer.claim();
  clock.advance(5 * MINUTE);
  const res = timer.endSession();
  assert.equal(res.snapshot.cooldownEndsAt, null);
  assert.equal(res.snapshot.phase, Phase.STUDY_REQUIRED);
});
