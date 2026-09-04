import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const emptyData = () => ({
  users: [],
  assignments: [],
  submissions: [],
  sessions: [],
});

/**
 * 极简 JSON 文件数据库：整库读入内存，写入时先写临时文件再重命名，避免半截文件。
 * 作业系统的数据量很小（一个班级几十人），不引入外部依赖。
 */
export class Db {
  constructor(file = process.env.DB_FILE || path.join(rootDir, 'data', 'db.json')) {
    this.file = file;
    this.data = emptyData();
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      this.data = { ...emptyData(), ...JSON.parse(raw) };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.data = emptyData();
      this.save();
    }
    return this.data;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  reset() {
    this.data = emptyData();
    this.save();
  }

  /** 表操作 */
  all(table) {
    return this.data[table];
  }

  find(table, predicate) {
    return this.data[table].find(predicate);
  }

  filter(table, predicate) {
    return this.data[table].filter(predicate);
  }

  insert(table, row) {
    const record = { id: nextId(this.data[table]), ...row };
    this.data[table].push(record);
    this.save();
    return record;
  }

  update(table, id, patch) {
    const row = this.data[table].find((r) => r.id === id);
    if (!row) return null;
    Object.assign(row, patch);
    this.save();
    return row;
  }

  remove(table, predicate) {
    const before = this.data[table].length;
    this.data[table] = this.data[table].filter((row) => !predicate(row));
    if (this.data[table].length !== before) this.save();
    return before - this.data[table].length;
  }
}

function nextId(rows) {
  return rows.reduce((max, row) => Math.max(max, row.id ?? 0), 0) + 1;
}

export { rootDir };
