// The native chat screens end to end on the emulator, behind the block proxy.
// Fake OpenRouter answers. Prints one line per check; exits 1 on any failure.
import { execFileSync } from "node:child_process";
import { reset, session as fixtureSession } from "../../local-backend/fixtures.mjs";

const PKG = "tech.klui.app.dev";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const adb = (...args) => execFileSync("adb", args, { encoding: "utf8", timeout: 30000 }).trim();
const sh = (command) => adb("shell", command);
const CHAT_ID = "00000000-0000-4000-8000-b00000000001";
const SHOTS = process.env.SHOTS || "/tmp/x";

function nodes() {
  const xml = adb("exec-out", "uiautomator", "dump", "/dev/stdout");
  return [...xml.matchAll(/<node [^>]*>/g)].map(([tag]) => ({
    id: (/resource-id="([^"]*)"/.exec(tag)?.[1] || "").split("/").pop(),
    text: (/text="([^"]*)"/.exec(tag)?.[1] || "").replace(/&amp;/g, "&"),
    desc: /content-desc="([^"]*)"/.exec(tag)?.[1] || "",
    bounds: /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(tag)?.slice(1).map(Number)
  }));
}
const find = (id, list = nodes()) => list.find((node) => node.id === id);
const hasText = (text, list = nodes()) => list.some((node) => node.text.includes(text));
async function until(test, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const value = test(); if (value) return value; } catch {}
    await wait(400);
  }
  return false;
}
async function tap(id) {
  const node = await until(() => find(id));
  if (!node) throw new Error(`nothing to tap: ${id}`);
  const [x1, y1, x2, y2] = node.bounds;
  sh(`input tap ${(x1 + x2) >> 1} ${(y1 + y2) >> 1}`);
  await wait(300);
}
const typeText = (text) => sh(`input text '${text.replace(/ /g, "%s")}'`);
const shot = (name) => execFileSync("sh", ["-c", `adb exec-out screencap -p > ${SHOTS}/${name}.png`]);
const sql = (text) => execFileSync("docker", ["exec", "supabase_db_klui-parity", "psql", "-U", "postgres", "-tAc", text], { encoding: "utf8" }).trim();
const back = () => sh("input keyevent 4");

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
}

await reset();
sh(`pm clear ${PKG}`);
sh(`am start -n ${PKG}/${PKG}.MainActivity`);
await until(() => find("signIn"), 30000);
sh(`am start -a android.intent.action.VIEW -d '${PKG}://test/session?data=${encodeURIComponent(JSON.stringify(await fixtureSession("new")))}' ${PKG}`);

check("the signed-in app opens on the chat list", await until(() => find("chatList"), 30000));
check("the list shows the fixture chats", await until(() => hasText("Photosynthesis basics") && hasText("Calculus limits practice")));
shot("native-list");

// Search: by title at once.
await tap("searchChats");
typeText("calculus");
check("search filters by title", await until(() => hasText("Calculus limits practice") && !hasText("Photosynthesis basics"), 8000));
await tap("searchChats");
sh("input keycombination 113 29"); // ctrl+a
sh("input keyevent 67");
back();
await until(() => hasText("Photosynthesis basics"));

// Pin, rename.
await tap(`chatMenu-00000000-0000-4000-8000-b00000000002`);
await tap("chatPin");
await wait(500);
const order = nodes().filter((node) => node.id.startsWith("chatRow-")).map((node) => node.id.slice(-1));
check("a pinned chat moves to the top", order[0] === "2", order.join(","));
await tap(`chatMenu-00000000-0000-4000-8000-b00000000003`);
await tap("chatRename");
await until(() => find("renameInput"));
sh("input keycombination 113 29");
typeText("Renamed natively");
await tap("renameSave");
check("rename shows in the list", await until(() => hasText("Renamed natively"), 8000));

// A stored thread: markdown draws natively.
await tap(`chatRow-${CHAT_ID}`);
check("a thread opens with its messages", await until(() => hasText("Explain photosynthesis simply"), 15000));
check("markdown: headings, table and code", await until(() => hasText("Light-dependent reactions") && hasText("Glucose") && hasText("co2_molecules")));
shot("native-thread");

// Stream a reply.
await tap("promptInput");
await wait(800);
shot("native-keyboard");
const input = find("promptInput");
const screen = find("messages");
check("the keyboard doesn't cover the message box", input && input.bounds[3] < 2400 - 400, input?.bounds?.join(","));
typeText("Say hello");
await tap("sendButton");
check("the sent message shows at once", await until(() => hasText("Say hello"), 8000));
check("a reply streams in", await until(() => hasText("Done."), 30000));
check("Send comes back when it ends", await until(() => find("sendButton"), 15000));
check("a plain reply doesn't offer the full view", !find("openFullView"));
shot("native-reply");

// Stop a slow reply.
await tap("promptInput");
typeText("crawl follow up");
await wait(300);
// The dump waits for an idle screen, so it can't see a reply mid-stream: Stop sits where Send was.
const send = await until(() => find("sendButton"));
const [sx1, sy1, sx2, sy2] = send.bounds;
sh(`input tap ${(sx1 + sx2) >> 1} ${(sy1 + sy2) >> 1}`);
await wait(1800);
shot("native-streaming");
sh(`input tap ${(sx1 + sx2) >> 1} ${(sy1 + sy2) >> 1}`);
// A turn stopped mid-way is withdrawn by the server; the message returns to the box, as on the web.
check("Stop withdraws the turn", await until(() => sql(`select count(*) from messages where conversation_id='${CHAT_ID}' and content::text like '%crawl%'`) === "0", 15000));
check("the stopped message returns to the box", await until(() => find("promptInput")?.text === "crawl follow up", 15000));
check("Send comes back after stopping", await until(() => find("sendButton"), 15000));

// Leave and return while a reply runs: it isn't cancelled.
back();
await wait(300);
if (!find("threadBack")) await wait(500);
if (find("promptInput") && find("threadBack")) await tap("threadBack");
check("back reaches the list", await until(() => find("chatList"), 8000));

// New chat.
await tap("newChat");
check("a new chat is empty and ready", await until(() => find("newChatHint"), 8000));
await tap("promptInput");
typeText("Hello from native");
await tap("sendButton");
check("sending from a new chat streams", await until(() => hasText("Done."), 30000));
await tap("threadBack");
check("the new chat is in the list", await until(() => hasText("Hello from native") || nodes().filter((node) => node.id.startsWith("chatRow-")).length >= 4, 12000));

// Delete.
await tap(`chatMenu-00000000-0000-4000-8000-b00000000003`);
await tap("chatDelete");
await until(() => hasText("Delete chat?"), 5000);
const del = nodes().find((node) => node.text === "DELETE" || node.text === "Delete");
const [x1, y1, x2, y2] = del.bounds;
sh(`input tap ${(x1 + x2) >> 1} ${(y1 + y2) >> 1}`);
check("delete removes the chat", await until(() => !find("chatRow-00000000-0000-4000-8000-b00000000003"), 8000));

// Attach a real file through the system picker; it goes to local storage and on with the message.
const NAME = "klui-upload-test.png";
execFileSync("sh", ["-c", `node -e "
const z = require('zlib');
const crcTable = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = ~0; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
const part = (t, d) => { const h = Buffer.from(t); const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const e = Buffer.alloc(4); e.writeUInt32BE(crc(Buffer.concat([h, d]))); return Buffer.concat([l, h, d, e]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(64, 0); ihdr.writeUInt32BE(64, 4); ihdr[8] = 8; ihdr[9] = 2;
const raw = Buffer.alloc(65 * 3 * 64 + 64, 120);
process.stdout.write(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), part('IHDR', ihdr), part('IDAT', z.deflateSync(raw.subarray(0, (64 * 3 + 1) * 64))), part('IEND', Buffer.alloc(0))]));
" > ${SHOTS}/${NAME}`]);
adb("push", `${SHOTS}/${NAME}`, `/sdcard/Download/${NAME}`);
sh(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Download/${NAME}`);
await tap("newChat");
await until(() => find("newChatHint"), 8000);
await tap("attachButton");
await tap("attachFiles");
await until(() => !find("promptInput"), 8000);
if (!(await until(() => hasText(NAME), 8000))) {
  const roots = await until(() => nodes().find((node) => node.desc === "Show roots"), 5000);
  if (roots) {
    const [a, b, c, d] = roots.bounds;
    sh(`input tap ${(a + c) >> 1} ${(b + d) >> 1}`);
    const downloads = await until(() => nodes().find((node) => node.text === "Downloads"), 5000);
    const [e, f, g, h] = downloads.bounds;
    sh(`input tap ${(e + g) >> 1} ${(f + h) >> 1}`);
  }
}
const picked = await until(() => nodes().find((node) => node.text === NAME), 10000);
if (picked) {
  const [a, b, c, d] = picked.bounds;
  sh(`input tap ${(a + c) >> 1} ${(b + d) >> 1}`);
}
check("the picked file appears on the message", await until(() => find("composerFile"), 15000));
const uploaded = await until(() => sql(`select status from attachments where file_name='${NAME}' order by created_at desc limit 1`) === "uploaded", 20000);
check("the bytes reached storage", uploaded);
shot("native-attached");
await tap("promptInput");
typeText("crawl Look at this picture");
await until(() => find("sendButton"), 5000);
const sendFile = await until(() => find("sendButton"));
const [fx1, fy1, fx2, fy2] = sendFile.bounds;
const onFile = `input tap ${(fx1 + fx2) >> 1} ${(fy1 + fy2) >> 1}`;
sh(onFile);
await wait(2000);
sh(onFile);
check("a stopped file returns to the box", await until(() => find("composerFile"), 15000));
check("the stopped file is free to send again", await until(() => sql(`select message_id is null from attachments where file_name='${NAME}' order by created_at desc limit 1`) === "t", 10000));
await until(() => find("sendButton"), 5000);
await tap("sendButton");
check("the reply to the picture finishes", await until(() => sql(`select count(*) from attachments a join messages m on m.id = a.message_id where a.file_name='${NAME}' and m.role='user'`) === "1", 20000) && await until(() => hasText("Done."), 60000));
shot("native-attached-sent");
await tap("threadBack");
await until(() => find("chatList"));
sh(`rm -f /sdcard/Download/${NAME}`);

// Settings.
await tap("openSettings");
check("settings shows the account", await until(() => find("settingsEmail"), 10000));
shot("native-settings");
await tap("appearance-dark");
await wait(800);
shot("native-settings-dark");
await tap("appearance-light");
await tap("settingsBack");
await until(() => find("chatList"));

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
