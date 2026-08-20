/**
 * 游玩时间计时系统
 *
 * 规则:
 *   1. 每次领取奖励可获得 30 分钟游玩时间;
 *   2. 30 分钟用完后进入 6 小时冷却, 冷却期间不能游玩;
 *   3. 冷却结束后可以再次领取 30 分钟。
 *
 * 所有计时都基于绝对时间戳(deadline)而不是累加的 tick,
 * 因此页面切到后台、被浏览器节流、甚至完全关闭进程,
 * 时间依然在"真实世界"里流逝, 重新打开时会自动结算到正确的状态。
 */

import { createMemoryStorage } from './storage.js';

/** 三种状态 */
export const Phase = Object.freeze({
  /** 空闲, 可以领取 30 分钟 */
  READY: 'ready',
  /** 游玩中 */
  PLAYING: 'playing',
  /** 冷却中 */
  COOLDOWN: 'cooldown',
});

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;

export const DEFAULT_PLAY_DURATION_MS = 30 * MINUTE;
export const DEFAULT_COOLDOWN_DURATION_MS = 6 * HOUR;

/** 时钟被往回拨多少毫秒才算作异常(容忍 NTP 校准的小幅抖动) */
const CLOCK_BACKWARD_TOLERANCE_MS = 2000;

const STATE_VERSION = 1;

function emptyState() {
  return {
    version: STATE_VERSION,
    /** 当前游玩场次的结束时间戳; 不在游玩中时为 null */
    sessionEndsAt: null,
    /** 当前游玩场次的开始时间戳; 不在游玩中时为 null */
    sessionStartedAt: null,
    /** 冷却结束时间戳; 不在冷却中时为 null */
    cooldownEndsAt: null,
    /** 已经完整用完的游玩场次数 */
    sessionsCompleted: 0,
    /** 累计游玩毫秒数 */
    totalPlayedMs: 0,
    /** 最后一次观测到的时间戳, 用于检测时钟被往回拨 */
    lastSeenAt: 0,
    /** 检测到时钟回拨的次数 */
    clockAnomalies: 0,
  };
}

export class PlaytimeTimer {
  #storage;
  #storageKey;
  #now;
  #playDurationMs;
  #cooldownDurationMs;
  #state;
  #listeners = new Set();
  #ticker = null;

  /**
   * @param {object} [options]
   * @param {{getItem(k:string):(string|null), setItem(k:string,v:string):void, removeItem?(k:string):void}} [options.storage]
   *        持久化适配器, 接口与 localStorage 一致。默认只存在内存里。
   * @param {string}   [options.storageKey]
   * @param {() => number} [options.now]  时间源, 传服务器时间可以防作弊
   * @param {number}   [options.playDurationMs]      单次游玩时长, 默认 30 分钟
   * @param {number}   [options.cooldownDurationMs]  冷却时长, 默认 6 小时
   */
  constructor(options = {}) {
    const {
      storage = createMemoryStorage(),
      storageKey = 'fake-minecraft:playtime:v1',
      now = () => Date.now(),
      playDurationMs = DEFAULT_PLAY_DURATION_MS,
      cooldownDurationMs = DEFAULT_COOLDOWN_DURATION_MS,
    } = options;

    if (!(playDurationMs > 0)) throw new RangeError('playDurationMs 必须大于 0');
    if (!(cooldownDurationMs >= 0)) throw new RangeError('cooldownDurationMs 不能为负数');

    this.#storage = storage;
    this.#storageKey = storageKey;
    this.#now = now;
    this.#playDurationMs = playDurationMs;
    this.#cooldownDurationMs = cooldownDurationMs;
    this.#state = this.#load();

    // 构造时立刻结算一次: 处理"上次关掉页面之后经过的时间"
    this.refresh();
  }

  get playDurationMs() { return this.#playDurationMs; }
  get cooldownDurationMs() { return this.#cooldownDurationMs; }

  // ---------------------------------------------------------------- 持久化

  #load() {
    let raw = null;
    try {
      raw = this.#storage.getItem(this.#storageKey);
    } catch {
      raw = null;
    }
    if (!raw) return emptyState();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return emptyState();
    }
    if (!parsed || typeof parsed !== 'object' || parsed.version !== STATE_VERSION) {
      return emptyState();
    }
    return { ...emptyState(), ...parsed };
  }

  #save() {
    try {
      this.#storage.setItem(this.#storageKey, JSON.stringify(this.#state));
    } catch {
      // 存储不可用(隐私模式 / 配额满)时降级为纯内存运行, 不影响本次会话
    }
  }

  // ------------------------------------------------------------ 时钟与结算

  /**
   * 读取当前时间, 并检测时钟被往回拨的情况。
   * 时钟往回拨会让 deadline 显得更远, 对玩家不利, 所以这里把所有 deadline
   * 按同样的差值平移, 保证"剩余时间"不变。
   */
  #readClock() {
    const now = this.#now();
    const backwards = this.#state.lastSeenAt - now;

    if (backwards > CLOCK_BACKWARD_TOLERANCE_MS) {
      const shift = backwards;
      if (this.#state.sessionStartedAt !== null) this.#state.sessionStartedAt -= shift;
      if (this.#state.sessionEndsAt !== null) this.#state.sessionEndsAt -= shift;
      if (this.#state.cooldownEndsAt !== null) this.#state.cooldownEndsAt -= shift;
      this.#state.clockAnomalies += 1;
    }

    this.#state.lastSeenAt = now;
    return now;
  }

  /**
   * 把状态结算到"此刻", 触发所有应该发生的状态迁移。
   * 关掉页面几小时后再打开, 这一次调用就能把 游玩结束 -> 冷却结束 全部补上。
   * @returns {ReturnType<PlaytimeTimer['getSnapshot']>}
   */
  refresh() {
    const now = this.#readClock();
    const before = this.#phaseAt(now);
    let changed = false;

    // 游玩时间用完 -> 进入冷却。
    // 冷却从"游玩实际结束的那一刻"起算, 而不是从发现它的这一刻起算,
    // 这样离线期间冷却也在正常走。
    if (this.#state.sessionEndsAt !== null && now >= this.#state.sessionEndsAt) {
      const endedAt = this.#state.sessionEndsAt;
      this.#state.totalPlayedMs += endedAt - this.#state.sessionStartedAt;
      this.#state.sessionsCompleted += 1;
      this.#state.sessionStartedAt = null;
      this.#state.sessionEndsAt = null;
      this.#state.cooldownEndsAt = endedAt + this.#cooldownDurationMs;
      changed = true;
      this.#emit('session-end', { at: endedAt });
    }

    // 冷却结束 -> 可以再次领取
    if (this.#state.cooldownEndsAt !== null && now >= this.#state.cooldownEndsAt) {
      const readyAt = this.#state.cooldownEndsAt;
      this.#state.cooldownEndsAt = null;
      changed = true;
      this.#emit('cooldown-end', { at: readyAt });
    }

    if (changed) this.#save();

    const snapshot = this.getSnapshot();
    if (changed || before !== snapshot.phase) this.#emit('change', snapshot);
    // 每次结算都触发, 供 UI 刷新倒计时数字
    this.#emit('tick', snapshot);
    return snapshot;
  }

  #phaseAt(now) {
    if (this.#state.sessionEndsAt !== null && now < this.#state.sessionEndsAt) return Phase.PLAYING;
    if (this.#state.cooldownEndsAt !== null && now < this.#state.cooldownEndsAt) return Phase.COOLDOWN;
    return Phase.READY;
  }

  // -------------------------------------------------------------------- 读

  /**
   * 当前状态快照。纯读取, 不会触发状态迁移(需要迁移请先 refresh)。
   */
  getSnapshot() {
    const now = this.#now();
    const phase = this.#phaseAt(now);
    const s = this.#state;

    const remainingPlayMs = phase === Phase.PLAYING ? Math.max(0, s.sessionEndsAt - now) : 0;
    const remainingCooldownMs = phase === Phase.COOLDOWN ? Math.max(0, s.cooldownEndsAt - now) : 0;

    return {
      phase,
      /** 现在能不能玩 */
      canPlay: phase === Phase.PLAYING,
      /** 现在能不能领取 30 分钟 */
      canClaim: phase === Phase.READY,
      /** 本场剩余游玩毫秒数 */
      remainingPlayMs,
      /** 冷却剩余毫秒数 */
      remainingCooldownMs,
      /** 当前阶段的剩余毫秒数(READY 时为 0) */
      remainingMs: phase === Phase.PLAYING ? remainingPlayMs : remainingCooldownMs,
      /** 当前阶段进度 0~1 */
      progress:
        phase === Phase.PLAYING
          ? 1 - remainingPlayMs / this.#playDurationMs
          : phase === Phase.COOLDOWN
            ? 1 - remainingCooldownMs / this.#cooldownDurationMs
            : 1,
      sessionStartedAt: s.sessionStartedAt,
      sessionEndsAt: s.sessionEndsAt,
      cooldownEndsAt: s.cooldownEndsAt,
      /** 下一次可以领取的时间戳; READY 时为 null */
      nextClaimAt: phase === Phase.PLAYING
        ? s.sessionEndsAt + this.#cooldownDurationMs
        : phase === Phase.COOLDOWN
          ? s.cooldownEndsAt
          : null,
      sessionsCompleted: s.sessionsCompleted,
      totalPlayedMs: s.totalPlayedMs + (phase === Phase.PLAYING ? now - s.sessionStartedAt : 0),
      clockAnomalies: s.clockAnomalies,
      now,
    };
  }

  // -------------------------------------------------------------------- 写

  /**
   * 领取奖励并开始 30 分钟游玩。
   * @returns {{ok: true, snapshot: object} | {ok: false, reason: 'playing'|'cooldown', snapshot: object}}
   */
  claim() {
    this.refresh();
    const now = this.#readClock();
    const phase = this.#phaseAt(now);

    if (phase !== Phase.READY) {
      return { ok: false, reason: phase === Phase.PLAYING ? 'playing' : 'cooldown', snapshot: this.getSnapshot() };
    }

    this.#state.sessionStartedAt = now;
    this.#state.sessionEndsAt = now + this.#playDurationMs;
    this.#state.cooldownEndsAt = null;
    this.#save();

    const snapshot = this.getSnapshot();
    this.#emit('session-start', { at: now, endsAt: this.#state.sessionEndsAt });
    this.#emit('change', snapshot);
    return { ok: true, snapshot };
  }

  /** claim() 的别名, 语义更直白 */
  startSession() { return this.claim(); }

  /**
   * 提前结束本场游玩。冷却照常从"结束的这一刻"起算 6 小时,
   * 提前退出不会缩短冷却, 也不会保留没用完的时间。
   */
  endSession() {
    this.refresh();
    const now = this.#readClock();
    if (this.#phaseAt(now) !== Phase.PLAYING) {
      return { ok: false, reason: 'not-playing', snapshot: this.getSnapshot() };
    }

    this.#state.totalPlayedMs += now - this.#state.sessionStartedAt;
    this.#state.sessionsCompleted += 1;
    this.#state.sessionStartedAt = null;
    this.#state.sessionEndsAt = null;
    this.#state.cooldownEndsAt = now + this.#cooldownDurationMs;
    this.#save();

    const snapshot = this.getSnapshot();
    this.#emit('session-end', { at: now, early: true });
    this.#emit('change', snapshot);
    return { ok: true, snapshot };
  }

  /** 清空全部进度(测试 / 管理员用) */
  reset() {
    this.#state = emptyState();
    this.#save();
    const snapshot = this.getSnapshot();
    this.#emit('change', snapshot);
    return snapshot;
  }

  // ------------------------------------------------------------------ 事件

  /**
   * 订阅事件。
   *   'tick'          每次 refresh() 都触发, 用来刷新倒计时显示
   *   'change'        状态发生变化(阶段迁移 / 领取 / 重置)
   *   'session-start' 领取并开始游玩
   *   'session-end'   游玩时间用完或提前结束
   *   'cooldown-end'  冷却结束, 可以再次领取
   * @returns {() => void} 取消订阅
   */
  on(event, listener) {
    const entry = { event, listener };
    this.#listeners.add(entry);
    return () => this.#listeners.delete(entry);
  }

  #emit(event, payload) {
    for (const entry of [...this.#listeners]) {
      if (entry.event !== event) continue;
      try {
        entry.listener(payload);
      } catch (err) {
        // 一个监听器抛错不应该打断状态机
        console.error(`[PlaytimeTimer] 监听器 ${event} 抛出异常:`, err);
      }
    }
  }

  // ------------------------------------------------------------ 后台轮询

  /**
   * 开始定时结算。这只是为了让 UI 上的秒数跳动 —— 状态本身由时间戳决定,
   * 所以浏览器把定时器节流到几分钟一次也不会算错。
   * @param {number} [intervalMs=1000]
   */
  startTicking(intervalMs = 1000) {
    this.stopTicking();
    this.#ticker = setInterval(() => this.refresh(), intervalMs);
    this.#ticker.unref?.();
    return () => this.stopTicking();
  }

  stopTicking() {
    if (this.#ticker !== null) {
      clearInterval(this.#ticker);
      this.#ticker = null;
    }
  }
}

/** 把毫秒格式化成 hh:mm:ss / mm:ss */
export function formatDuration(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
