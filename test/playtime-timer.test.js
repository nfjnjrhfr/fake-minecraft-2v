import test from 'node:test';
import assert from 'node:assert/strict';

import { PlaytimeTimer, Phase, formatDuration, MINUTE, HOUR } from '../src/index.js';
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

function makeTimer(clock, storage = createMemoryStorage(), extra = {}) {
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

test('nextClaimAt 指向下一次可领取的时刻', () => {
  const clock = fakeClock();
  const timer = makeTimer(clock);
  const start = clock.now();
  timer.claim();
  assert.equal(timer.getSnapshot().nextClaimAt, start + 30 * MINUTE + 6 * HOUR);

  clock.advance(30 * MINUTE);
  timer.refresh();
  assert.equal(timer.getSnapshot().nextClaimAt, start + 30 * MINUTE + 6 * HOUR);

  clock.advance(6 * HOUR);
  timer.refresh();
  assert.equal(timer.getSnapshot().nextClaimAt, null);
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
