/**
 * 游玩时间计时系统
 *
 * 规则:
 *   1. 想领取游玩时间, 必须先完成学习 —— 学习满 30 分钟才能登记一次;
 *   2. 登记一次得到 30 分钟游玩时间;
 *   3. 游玩时间用完后进入 6 小时冷却;
 *   4. 冷却结束 + 学习时长够, 才能再次登记。
 *
 * 两道门槛是相互独立的, 冷却期间可以先把学习做掉,
 * 冷却一结束就能立刻登记。
 *
 * 所有计时都基于绝对时间戳(deadline)而不是累加的 tick,
 * 因此切到别的 App、锁屏、甚至把这个页面完全关掉,
 * 时间依然在"真实世界"里流逝, 回来时会自动结算到正确的状态。
 */

import { createMemoryStorage } from './storage.js';

/** 主状态 */
export const Phase = Object.freeze({
  /** 学习时长不够, 领取不了 */
  STUDY_REQUIRED: 'study_required',
  /** 两道门槛都过了, 可以登记 30 分钟 */
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
export const DEFAULT_STUDY_REQUIRED_MS = 30 * MINUTE;

/** 时钟被往回拨多少毫秒才算作异常(容忍 NTP 校准的小幅抖动) */
const CLOCK_BACKWARD_TOLERANCE_MS = 2000;

const STATE_VERSION = 2;

function emptyState() {
  return {
    version: STATE_VERSION,
    /** 当前游玩场次的开始 / 结束时间戳; 不在游玩中时为 null */
    sessionStartedAt: null,
    sessionEndsAt: null,
    /** 冷却结束时间戳; 不在冷却中时为 null */
    cooldownEndsAt: null,
    /** 已结算的学习时长("存款"), 登记一次扣掉 studyRequiredMs */
    studyBankedMs: 0,
    /** 本次学习开始的时间戳; 没在学习时为 null */
    studyStartedAt: null,
    /** 累计学习总时长(只增不减, 用于统计) */
    totalStudiedMs: 0,
    /** 已经完成的游玩场次数 */
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
  #studyRequiredMs;
  #state;
  #listeners = new Set();
  #ticker = null;
  #studyGoalReached = false;

  /**
   * @param {object} [options]
   * @param {{getItem(k:string):(string|null), setItem(k:string,v:string):void, removeItem?(k:string):void}} [options.storage]
   *        持久化适配器, 接口与 localStorage 一致。默认只存在内存里。
   * @param {string}   [options.storageKey]
   * @param {() => number} [options.now]  时间源, 传服务器时间可以防作弊
   * @param {number}   [options.playDurationMs]      单次游玩时长, 默认 30 分钟
   * @param {number}   [options.cooldownDurationMs]  冷却时长, 默认 6 小时
   * @param {number}   [options.studyRequiredMs]     登记一次需要的学习时长, 默认 30 分钟
   */
  constructor(options = {}) {
    const {
      storage = createMemoryStorage(),
      storageKey = 'fake-minecraft:playtime:v2',
      now = () => Date.now(),
      playDurationMs = DEFAULT_PLAY_DURATION_MS,
      cooldownDurationMs = DEFAULT_COOLDOWN_DURATION_MS,
      studyRequiredMs = DEFAULT_STUDY_REQUIRED_MS,
    } = options;

    if (!(playDurationMs > 0)) throw new RangeError('playDurationMs 必须大于 0');
    if (!(cooldownDurationMs >= 0)) throw new RangeError('cooldownDurationMs 不能为负数');
    if (!(studyRequiredMs >= 0)) throw new RangeError('studyRequiredMs 不能为负数');

    this.#storage = storage;
    this.#storageKey = storageKey;
    this.#now = now;
    this.#playDurationMs = playDurationMs;
    this.#cooldownDurationMs = cooldownDurationMs;
    this.#studyRequiredMs = studyRequiredMs;
    this.#state = this.#load();
    this.#studyGoalReached = this.#liveStudyMs(this.#now()) >= studyRequiredMs;

    // 构造时立刻结算一次: 处理"上次关掉页面之后经过的时间"
    this.refresh();
  }

  get playDurationMs() { return this.#playDurationMs; }
  get cooldownDurationMs() { return this.#cooldownDurationMs; }
  get studyRequiredMs() { return this.#studyRequiredMs; }

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
    if (!parsed || typeof parsed !== 'object') return emptyState();

    // v1 没有学习相关字段, 其余字段同名, 直接合并即可平滑升级
    if (parsed.version !== 1 && parsed.version !== STATE_VERSION) return emptyState();

    return { ...emptyState(), ...parsed, version: STATE_VERSION };
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
   * 时钟往回拨会让 deadline 显得更远、让已累计的学习时长缩水,
   * 所以这里把所有时间锚点按同样的差值平移, 保证"剩余时间"不变。
   */
  #readClock() {
    const now = this.#now();
    const backwards = this.#state.lastSeenAt - now;

    if (backwards > CLOCK_BACKWARD_TOLERANCE_MS) {
      const shift = backwards;
      if (this.#state.sessionStartedAt !== null) this.#state.sessionStartedAt -= shift;
      if (this.#state.sessionEndsAt !== null) this.#state.sessionEndsAt -= shift;
      if (this.#state.cooldownEndsAt !== null) this.#state.cooldownEndsAt -= shift;
      if (this.#state.studyStartedAt !== null) this.#state.studyStartedAt -= shift;
      this.#state.clockAnomalies += 1;
    }

    this.#state.lastSeenAt = now;
    return now;
  }

  /** 当前有效学习时长 = 已结算 + 本次正在进行的 */
  #liveStudyMs(now) {
    const s = this.#state;
    return s.studyBankedMs + (s.studyStartedAt === null ? 0 : Math.max(0, now - s.studyStartedAt));
  }

  /** 把正在进行的学习时长结算进"存款" */
  #settleStudy(now) {
    const s = this.#state;
    if (s.studyStartedAt === null) return;
    const elapsed = Math.max(0, now - s.studyStartedAt);
    s.studyBankedMs += elapsed;
    s.totalStudiedMs += elapsed;
    s.studyStartedAt = now;
  }

  /**
   * 把状态结算到"此刻", 触发所有应该发生的状态迁移。
   * 切去别的 App 几小时后回来, 这一次调用就能把 游玩结束 -> 冷却结束 全部补上。
   * @returns {ReturnType<PlaytimeTimer['getSnapshot']>}
   */
  refresh() {
    const now = this.#readClock();
    const before = this.#phaseAt(now);
    let changed = false;

    // 游玩时间用完 -> 进入冷却。
    // 冷却从"游玩实际结束的那一刻"起算, 而不是从发现它的这一刻起算,
    // 这样切去别的 App 的期间冷却也在正常走。
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

    // 冷却结束
    if (this.#state.cooldownEndsAt !== null && now >= this.#state.cooldownEndsAt) {
      const readyAt = this.#state.cooldownEndsAt;
      this.#state.cooldownEndsAt = null;
      changed = true;
      this.#emit('cooldown-end', { at: readyAt });
    }

    // 学习时长达标(每次从"不够"跨到"够了"时提醒一次)
    const studyMs = this.#liveStudyMs(now);
    if (studyMs >= this.#studyRequiredMs && !this.#studyGoalReached) {
      this.#studyGoalReached = true;
      this.#settleStudy(now);
      changed = true;
      this.#emit('study-goal', { at: now, bankedMs: this.#state.studyBankedMs });
    } else if (studyMs < this.#studyRequiredMs) {
      this.#studyGoalReached = false;
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
    if (this.#liveStudyMs(now) < this.#studyRequiredMs) return Phase.STUDY_REQUIRED;
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
    const remainingCooldownMs =
      s.cooldownEndsAt !== null ? Math.max(0, s.cooldownEndsAt - now) : 0;

    const studyMs = this.#liveStudyMs(now);
    const studyRemainingMs = Math.max(0, this.#studyRequiredMs - studyMs);

    // 两道门槛
    const cooldownPassed = remainingCooldownMs === 0;
    const studyPassed = studyRemainingMs === 0;

    return {
      phase,
      /** 现在能不能玩 */
      canPlay: phase === Phase.PLAYING,
      /** 现在能不能登记 30 分钟 */
      canClaim: phase === Phase.READY,
      /** 现在能不能开始学习(游玩中不能学习, 避免一份时间用两次) */
      canStudy: phase !== Phase.PLAYING,

      /** 本场剩余游玩毫秒数 */
      remainingPlayMs,
      /** 冷却剩余毫秒数 */
      remainingCooldownMs,
      /** 当前阶段的主倒计时(READY / STUDY_REQUIRED 时为 0) */
      remainingMs: phase === Phase.PLAYING ? remainingPlayMs : remainingCooldownMs,
      /** 当前阶段进度 0~1 */
      progress:
        phase === Phase.PLAYING
          ? 1 - remainingPlayMs / this.#playDurationMs
          : phase === Phase.COOLDOWN
            ? 1 - remainingCooldownMs / this.#cooldownDurationMs
            : phase === Phase.STUDY_REQUIRED
              ? (this.#studyRequiredMs === 0 ? 1 : studyMs / this.#studyRequiredMs)
              : 1,

      /** 登记的两道门槛, UI 可以分别显示 */
      gates: {
        cooldown: { passed: cooldownPassed, remainingMs: remainingCooldownMs },
        study: { passed: studyPassed, remainingMs: studyRemainingMs },
      },

      /** 学习状态 */
      study: {
        /** 是否正在计学习时间 */
        running: s.studyStartedAt !== null,
        /** 当前累计的学习时长("存款") */
        bankedMs: studyMs,
        /** 登记一次需要的学习时长 */
        requiredMs: this.#studyRequiredMs,
        /** 还差多久达标 */
        remainingMs: studyRemainingMs,
        /** 学习进度 0~1 */
        progress: this.#studyRequiredMs === 0 ? 1 : Math.min(1, studyMs / this.#studyRequiredMs),
        /** 够不够登记一次 */
        passed: studyPassed,
        /** 存款够登记几次 */
        credits: this.#studyRequiredMs === 0 ? Infinity : Math.floor(studyMs / this.#studyRequiredMs),
      },

      sessionStartedAt: s.sessionStartedAt,
      sessionEndsAt: s.sessionEndsAt,
      cooldownEndsAt: s.cooldownEndsAt,
      /** 冷却最早结束的时间戳; 已经没有冷却时为 null。注意还要学习达标才能登记 */
      cooldownReadyAt: phase === Phase.PLAYING
        ? s.sessionEndsAt + this.#cooldownDurationMs
        : s.cooldownEndsAt,

      sessionsCompleted: s.sessionsCompleted,
      totalPlayedMs: s.totalPlayedMs + (phase === Phase.PLAYING ? now - s.sessionStartedAt : 0),
      totalStudiedMs: s.totalStudiedMs + (s.studyStartedAt === null ? 0 : Math.max(0, now - s.studyStartedAt)),
      clockAnomalies: s.clockAnomalies,
      now,
    };
  }

  // ------------------------------------------------------------------ 学习

  /**
   * 开始(或继续)计学习时间。学习同样按真实时间走,
   * 所以可以开始学习之后锁屏、去看书、去别的 App 背单词。
   * @returns {{ok:true, snapshot:object} | {ok:false, reason:'playing'|'already-studying', snapshot:object}}
   */
  startStudy() {
    this.refresh();
    const now = this.#readClock();

    if (this.#phaseAt(now) === Phase.PLAYING) {
      return { ok: false, reason: 'playing', snapshot: this.getSnapshot() };
    }
    if (this.#state.studyStartedAt !== null) {
      return { ok: false, reason: 'already-studying', snapshot: this.getSnapshot() };
    }

    this.#state.studyStartedAt = now;
    this.#save();

    const snapshot = this.getSnapshot();
    this.#emit('study-start', { at: now });
    this.#emit('change', snapshot);
    return { ok: true, snapshot };
  }

  /**
   * 暂停学习计时, 已经学的时间会存进"存款", 不会白学。
   * @returns {{ok:true, snapshot:object} | {ok:false, reason:'not-studying', snapshot:object}}
   */
  pauseStudy() {
    this.refresh();
    const now = this.#readClock();

    if (this.#state.studyStartedAt === null) {
      return { ok: false, reason: 'not-studying', snapshot: this.getSnapshot() };
    }

    this.#settleStudy(now);
    this.#state.studyStartedAt = null;
    this.#save();

    const snapshot = this.getSnapshot();
    this.#emit('study-pause', { at: now, bankedMs: this.#state.studyBankedMs });
    this.#emit('change', snapshot);
    return { ok: true, snapshot };
  }

  // -------------------------------------------------------------------- 写

  /**
   * 登记奖励: 扣掉 30 分钟学习时长, 换 30 分钟游玩时间。
   * 需要同时满足: 冷却已结束 + 学习时长达标。
   * @returns {{ok:true, snapshot:object} | {ok:false, reason:'playing'|'cooldown'|'study-required', snapshot:object}}
   */
  claim() {
    this.refresh();
    const now = this.#readClock();
    const phase = this.#phaseAt(now);

    if (phase !== Phase.READY) {
      const reason = phase === Phase.PLAYING ? 'playing'
        : phase === Phase.COOLDOWN ? 'cooldown'
          : 'study-required';
      return { ok: false, reason, snapshot: this.getSnapshot() };
    }

    // 学习中直接登记的话, 先把这一段学习时间结算进存款再扣
    this.#settleStudy(now);
    if (this.#state.studyStartedAt !== null) {
      this.#state.studyStartedAt = null;
      this.#emit('study-pause', { at: now, bankedMs: this.#state.studyBankedMs });
    }
    this.#state.studyBankedMs = Math.max(0, this.#state.studyBankedMs - this.#studyRequiredMs);
    this.#studyGoalReached = this.#state.studyBankedMs >= this.#studyRequiredMs;

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
    this.#studyGoalReached = this.#studyRequiredMs === 0;
    this.#save();
    const snapshot = this.getSnapshot();
    this.#emit('change', snapshot);
    return snapshot;
  }

  // ------------------------------------------------------------------ 事件

  /**
   * 订阅事件。
   *   'tick'          每次 refresh() 都触发, 用来刷新倒计时显示
   *   'change'        状态发生变化(阶段迁移 / 登记 / 学习开始暂停 / 重置)
   *   'study-start'   开始计学习时间
   *   'study-pause'   暂停学习
   *   'study-goal'    学习时长达标, 可以登记了
   *   'session-start' 登记成功, 开始游玩
   *   'session-end'   游玩时间用完或提前结束
   *   'cooldown-end'  冷却结束
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

/**
 * 把"已经过去的时间"格式化成 hh:mm:ss / mm:ss。
 * 用向下取整, 免得同一个 10.5 秒既显示成"已学 11 秒"又显示成"还差 10 秒"。
 */
export function formatElapsed(ms) {
  return formatDuration(Math.floor(Math.max(0, ms) / 1000) * 1000);
}

/** 把"还剩多久"格式化成 hh:mm:ss / mm:ss(向上取整, 剩 0.5 秒也显示 1 秒) */
export function formatDuration(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
