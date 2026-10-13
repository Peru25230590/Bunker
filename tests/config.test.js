import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("Firebase database rules are valid JSON and remain UID-scoped", async () => {
  const source = await readFile(new URL("database.rules.json", root), "utf8");
  const rules = JSON.parse(source).rules;
  assert.equal(rules[".read"], false);
  assert.equal(rules[".write"], false);
  assert.match(rules.users.$uid.notes[".read"], /auth\.uid === \$uid/);
  assert.match(rules.users.$uid.notes[".write"], /auth\.uid === \$uid/);
  assert.equal(rules.users.$uid["$other"][".write"], false);
});

test("Firebase CLI configuration and seed records are valid", async () => {
  const config = JSON.parse(await readFile(new URL("firebase.json", root), "utf8"));
  const seed = JSON.parse(await readFile(new URL("database/seed-data.json", root), "utf8"));
  assert.equal(config.database.rules, "database.rules.json");
  assert.equal(config.storage.rules, "storage.rules");
  assert.equal(seed.version, 1);
  assert.ok(seed.notes.length > 0);
  for (const note of seed.notes) {
    assert.ok(note.id && note.title && typeof note.content === "string");
    assert.ok(note.content.length <= 10_000);
  }
});
