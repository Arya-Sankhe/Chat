// Cold start, scrolling, a long chat and streaming on a heavy account: 300 chats, one of 200
// messages. Prints numbers, not pass or fail; compare runs on the same emulator setup.
// Usage: ./run-chat.sh perf-test.mjs
import { execFileSync } from "node:child_process";
import { reset, session as fixtureSession, USERS } from "../../local-backend/fixtures.mjs";

const PKG = "tech.klui.app.dev";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const adb = (...args) => execFileSync("adb", args, { encoding: "utf8", timeout: 60000 }).trim();
const sh = (command) => adb("shell", command);
const sql = (input) => execFileSync("docker", ["exec", "-i", "supabase_db_klui-parity", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], { input });
const dump = () => adb("exec-out", "uiautomator", "dump", "/dev/stdout");
const has = (id) => new RegExp(`resource-id="([^"]*/)?${id}"`).test(dump());
async function until(test, ms = 30000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if (test()) return Date.now() - start; } catch {}
    await wait(100);
  }
  throw new Error(`timed out: ${test}`);
}
function tapId(id) {
  const [, x1, y1, x2, y2] = new RegExp(`resource-id="(?:[^"]*/)?${id}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`).exec(dump());
  sh(`input tap ${(Number(x1) + Number(x2)) >> 1} ${(Number(y1) + Number(y2)) >> 1}`);
}
function frames(label) {
  const text = sh(`dumpsys gfxinfo ${PKG}`);
  const read = (name) => new RegExp(`${name}: *([\\d.]+)`).exec(text)?.[1];
  console.log(`${label}: frames=${read("Total frames rendered")} janky=${read("Janky frames")} p50=${read("50th percentile")}ms p90=${read("90th percentile")}ms p99=${read("99th percentile")}ms`);
}
async function swipes(from, to, count) {
  sh(`dumpsys gfxinfo ${PKG} reset`);
  for (let index = 0; index < count; index += 1) {
    sh(`input swipe 540 ${from} 540 ${to} 180`);
    await wait(250);
  }
}

await reset();
const user = USERS.new.id;
const LONG = "00000000-0000-4000-8000-c00000000000";
const lit = (value) => `'${String(value).replace(/'/g, "''")}'`;
const body = (index) => JSON.stringify(`## Part ${index}\n\nSome **bold** text with \`code\` and a [link](https://example.invalid).\n\n- one\n- two\n- three\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n\`\`\`js\nconst value = ${index};\nconsole.log(value);\n\`\`\`\n\n${"A longer paragraph of ordinary reply text. ".repeat(8)}`);
const rows = [`insert into public.conversations (id, user_id, title, model, created_at, updated_at) values (${lit(LONG)}, ${lit(user)}, 'Long chat', 'think', now(), now() + interval '1 day');`];
for (let index = 0; index < 300; index += 1) rows.push(`insert into public.conversations (user_id, title, model, created_at, updated_at) values (${lit(user)}, ${lit(`Chat number ${index}`)}, 'think', now(), now() - interval '${index} minutes');`);
for (let index = 0; index < 200; index += 1) {
  const role = index % 2 ? "assistant" : "user";
  const content = role === "user" ? JSON.stringify(`Question ${index}`) : body(index);
  rows.push(`insert into public.messages (user_id, conversation_id, role, content, model, finish_reason, created_at) values (${lit(user)}, ${lit(LONG)}, '${role}', ${lit(content)}::jsonb, ${role === "user" ? "null" : "'think'"}, ${role === "user" ? "null" : "'stop'"}, now() - interval '${200 - index} minutes');`);
}
sql(rows.join("\n"));

sh(`pm clear ${PKG}`);
sh(`am start -n ${PKG}/${PKG}.MainActivity`);
await until(() => has("signIn"));
sh(`am start -a android.intent.action.VIEW -d '${PKG}://test/session?data=${encodeURIComponent(JSON.stringify(await fixtureSession("new")))}' ${PKG}`);
await until(() => has("chatList"));
await wait(3000);

const starts = [];
for (let run = 0; run < 3; run += 1) {
  sh(`am force-stop ${PKG}`);
  await wait(1500);
  starts.push(/TotalTime: (\d+)/.exec(sh(`am start -W -n ${PKG}/${PKG}.MainActivity`))?.[1]);
  await wait(3000);
}
console.log(`cold start to first frame: ${starts.join(", ")} ms`);
sh(`am force-stop ${PKG}`);
await wait(1500);
sh(`am start -n ${PKG}/${PKG}.MainActivity`);
console.log(`cold start to chats on screen: ${await until(() => dump().includes("chatRow-"))} ms (includes a screen read of about 1 s)`);
await wait(2000);

await swipes(1900, 500, 12);
frames("chat list scroll");
await swipes(500, 1900, 12);
await wait(1000);
tapId(`chatRow-${LONG}`);
console.log(`long chat to messages: ${await until(() => dump().includes("Part 1"), 30000)} ms (includes a screen read)`);
await wait(1500);
async function stream(label) {
  tapId("promptInput");
  sh("input text 'long%spoem'");
  await wait(500);
  tapId("sendButton");
  sh(`dumpsys gfxinfo ${PKG} reset`);
  await wait(9000);
  frames(label);
  await until(() => has("sendButton"), 60000);
}
// uiautomator waits for idle, so nothing reads the screen while these stream.
await stream("streaming at the end of the long chat");
await swipes(600, 1800, 15);
frames("long chat scroll, older pages loading");
console.log(sh(`dumpsys meminfo ${PKG}`).split("\n").find((line) => /TOTAL PSS/.test(line))?.trim());
tapId("threadBack");
await until(() => has("newChat"));
tapId("newChat");
await until(() => has("newChatHint"));
await stream("streaming in a new chat");
