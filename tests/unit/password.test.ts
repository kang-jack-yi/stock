import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../../src/lib/password";

test("每次哈希使用独立盐，只有正确密码验证通过", async () => {
  const first = await hashPassword("example-test-password"),
    second = await hashPassword("example-test-password");
  assert.notEqual(first, second);
  assert.ok(!first.includes("example-test-password"));
  assert.equal(await verifyPassword("example-test-password", first), true);
  assert.equal(await verifyPassword("wrong-password", first), false);
  assert.equal(await verifyPassword("example-test-password", "invalid"), false);
});
