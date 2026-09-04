import crypto from 'node:crypto';

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 小时

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password, stored) {
  const [salt, digest] = String(stored).split(':');
  if (!salt || !digest) return false;
  const candidate = crypto.scryptSync(password, salt, 32).toString('hex');
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(digest, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createSession(db, userId) {
  purgeExpired(db);
  const token = crypto.randomBytes(24).toString('hex');
  db.insert('sessions', { token, userId, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

export function destroySession(db, token) {
  return db.remove('sessions', (s) => s.token === token) > 0;
}

export function userFromToken(db, token) {
  if (!token) return null;
  const session = db.find('sessions', (s) => s.token === token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    destroySession(db, token);
    return null;
  }
  return db.find('users', (u) => u.id === session.userId) || null;
}

export function purgeExpired(db) {
  const now = Date.now();
  db.remove('sessions', (s) => s.expiresAt < now);
}

/** 对外返回的用户信息，永远不含密码散列 */
export function publicUser(user) {
  if (!user) return null;
  const { id, username, name, role, studentNo, className } = user;
  return { id, username, name, role, studentNo, className };
}

export { SESSION_TTL_MS };
