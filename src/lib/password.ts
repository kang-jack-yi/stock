import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCallback);

/** 使用独立随机盐和 scrypt 生成密码哈希，返回可持久化的算法、盐、密钥组合。 */
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${hash.toString("hex")}`;
}
/** 派生候选密码密钥并以恒定时间比较，数据库中不保存明文密码。 */
export async function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, key] = stored.split(":");
  if (algorithm !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "hex");
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
