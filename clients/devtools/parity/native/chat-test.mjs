// The native chat screens end to end on the emulator, behind the block proxy.
// Fake OpenRouter answers. Prints one line per check; exits 1 on any failure.
import { execFileSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import http from "node:http";
import { deflateSync } from "node:zlib";
import { reset, session as fixtureSession, setFree, useUpFreeMessages } from "../../local-backend/fixtures.mjs";

const PKG = "tech.klui.app.dev";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const adb = (...args) => execFileSync("adb", args, { encoding: "utf8", timeout: 30000 }).trim();
const sh = (command) => adb("shell", command);
const CHAT_ID = "00000000-0000-4000-8000-b00000000001";
const SHOTS = process.env.SHOTS || "/tmp/x";

/* compressed honors what's hidden from screen readers: what's really on top. */
function nodes(onTop = false) {
  const xml = adb("exec-out", "uiautomator", "dump", ...(onTop ? ["--compressed"] : []), "/dev/stdout");
  return [...xml.matchAll(/<node [^>]*>/g)].map(([tag]) => ({
    id: (/resource-id="([^"]*)"/.exec(tag)?.[1] || "").split("/").pop(),
    text: (/text="([^"]*)"/.exec(tag)?.[1] || "").replace(/&amp;/g, "&"),
    desc: /content-desc="([^"]*)"/.exec(tag)?.[1] || "",
    enabled: !/enabled="false"/.test(tag),
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

const crcTable = [...Array(256)].map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (bytes) => {
  let c = ~0;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return ~c >>> 0;
};
function png(width, height) {
  const part = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const end = Buffer.alloc(4);
    end.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, end]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height, 120);
  for (let row = 0; row < height; row++) raw[row * (width * 3 + 1)] = 0; // each row's filter byte
  const pixels = deflateSync(raw);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), part("IHDR", header), part("IDAT", pixels), part("IEND", Buffer.alloc(0))]);
}
function pushFile(name, bytes) {
  writeFileSync(`${SHOTS}/${name}`, bytes);
  adb("push", `${SHOTS}/${name}`, `/sdcard/Download/${name}`);
  sh(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Download/${name}`);
}
const tapNode = (node) => {
  const [a, b, c, d] = node.bounds;
  sh(`input tap ${(a + c) >> 1} ${(b + d) >> 1}`);
};
/* Through the real system picker. */
async function attachFile(name) {
  await tap("attachButton");
  await tap("attachFiles");
  await until(() => !find("promptInput"), 8000);
  if (!(await until(() => hasText(name), 8000))) {
    const roots = await until(() => nodes().find((node) => node.desc === "Show roots"), 5000);
    if (roots) {
      tapNode(roots);
      tapNode(await until(() => nodes().find((node) => node.text === "Downloads"), 5000));
    }
  }
  const picked = await until(() => nodes().find((node) => node.text === name), 10000);
  if (picked) tapNode(picked);
}
const restart = () => {
  sh(`am force-stop ${PKG}`);
  sh(`am start -n ${PKG}/${PKG}.MainActivity`);
};

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
pushFile(NAME, png(64, 64));
await tap("newChat");
await until(() => find("newChatHint"), 8000);
await attachFile(NAME);
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

// Math is drawn; a diagram offers the web client, which opens that chat.
await tap("newChat");
await until(() => find("newChatHint"), 8000);
await tap("promptInput");
typeText("math please");
await tap("sendButton");
check("a reply with math finishes", await until(() => find("sendButton") && hasText("Done."), 30000));
check("math draws in its own view", await until(() => nodes().filter((node) => node.id === "mathBlock").length === 3, 8000));
await wait(800);
const mathViews = nodes().filter((node) => node.id === "mathBlock");
// A hostile block tries to report a height of 3000 from script.
check("nothing in a reply runs, and each is sized to its content", mathViews.every(({ bounds: [, top, , bottom] }) => bottom - top > 40 && bottom - top < 400), mathViews.map(({ bounds: [, t, , b] }) => b - t).join(","));
shot("native-math");
// Only a tapped web link leaves the view, and it goes to the system's browser.
adb("logcat", "-c");
const [left, top] = mathViews[1].bounds;
adb("shell", "input", "tap", String(left + 60), String(top + 30));
await wait(1500);
check("a link in a math block opens outside the app", adb("logcat", "-d", "-s", "ActivityTaskManager:I").includes("example.invalid"));
adb("shell", "am", "force-stop", "com.android.chrome");
adb("shell", "am", "start", "-n", `${PKG}/.MainActivity`);
check("and the chat is still there", await until(() => find("sendButton") && hasText("Done."), 8000));
check("math isn't left as source", !hasText("$$"));
await tap("webOnlyBlock");
check("a diagram opens the full view", await until(() => find("webSurface") && !find("threadBack", nodes(true)), 8000));
await wait(1500);
back();
check("Back returns to the chat", await until(() => find("threadBack", nodes(true)), 8000));
check("the page doesn't raise the keyboard by itself", !/mInputShown=true/.test(sh("dumpsys input_method")));
await tap("threadBack");
await until(() => find("chatList"));

// The page was running when these changed, and they stay the same on both sides.
const PIN_ID = "00000000-0000-4000-8000-b00000000002";
const inPage = (expression) => {
  adb("forward", "tcp:9333", `localabstract:webview_devtools_remote_${sh(`pidof ${PKG}`)}`);
  return execFileSync("node", [new URL("cdp.mjs", import.meta.url).pathname, "9333", expression], { encoding: "utf8", timeout: 30000 }).trim();
};
const rowOrder = () => nodes().filter((node) => node.id.startsWith("chatRow-")).map((node) => node.id.slice(-1));
await tap(`chatMenu-${PIN_ID}`);
await tap("chatPin");
await tap("openDojo");
await until(() => find("webSurface") && !find("chatList", nodes(true)), 8000);
const pinnedInPage = `!!document.querySelector('#pinnedConversationList [data-open-chat-id="${PIN_ID}"]')`;
check("a chat unpinned here is unpinned in the page", await until(() => inPage(pinnedInPage) === "false", 8000));
inPage(`document.querySelector('[data-pin-chat-id="${PIN_ID}"]')?.click()`);
check("a chat pinned in the page shows there", await until(() => inPage(pinnedInPage) === "true", 8000));
back();
await until(() => find("chatList", nodes(true)) || (back(), false), 12000);
check("a chat pinned in the page is pinned here", await until(() => rowOrder()[0] === "2", 8000), rowOrder().join(","));

// A slow refresh from the page, ending after the app has changed a pin, doesn't undo the change.
inPage(`window.__fetch = window.fetch; window.fetch = (url, options) => String(url).includes("/conversations") ? window.__fetch(url, options).then((reply) => new Promise((done) => setTimeout(() => done(reply), 4000))) : window.__fetch(url, options); 1`);
await tap("openDojo");
await until(() => !find("chatList", nodes(true)), 8000);
back();
await until(() => find("chatList", nodes(true)) || (back(), false), 12000);
await tap(`chatMenu-${PIN_ID}`);
await tap("chatPin");
await wait(5000);
await tap("openDojo");
await until(() => !find("chatList", nodes(true)), 8000);
check("a slow page refresh keeps a newer pin", await until(() => inPage(pinnedInPage) === "false", 8000) && (await wait(5000), inPage(pinnedInPage) === "false"));
inPage(`window.fetch = window.__fetch; 1`);
back();
await until(() => find("chatList", nodes(true)) || (back(), false), 12000);

// A big photo gets smaller on the phone, as on the web.
const BIG = "klui-big-photo.png";
pushFile(BIG, png(3000, 1000));
await tap("newChat");
await until(() => find("newChatHint"), 8000);
await attachFile(BIG);
await until(() => sql(`select status from attachments where file_name='${BIG}' order by created_at desc limit 1`) === "uploaded", 30000);
const bigKey = sql(`select object_key from attachments where file_name='${BIG}' order by created_at desc limit 1`);
const stored = Buffer.from(await (await fetch(`http://localhost:55900/klui-parity/${bigKey}`)).arrayBuffer());
check("a big image is scaled to the app's limit", stored.readUInt32BE(16) === 2048, `width ${stored.length > 20 ? stored.readUInt32BE(16) : "?"}`);
await tap("threadBack");
await until(() => find("chatList"));

// A document holds the message back until the server has read it.
const DOC = "klui-notes.csv";
pushFile(DOC, Buffer.from("topic,note\nphotosynthesis,light into energy\n".repeat(20)));
await tap("newChat");
await until(() => find("newChatHint"), 8000);
await attachFile(DOC);
await until(() => find("composerFile"), 15000);
await tap("promptInput");
typeText("Summarize this");
await wait(4000);
check("a document being read holds Send back", (await until(() => find("sendButton")))?.enabled === false);
const worker = spawn("sh", ["-c", `cd ../../../../worker; set -a; . ../clients/devtools/local-backend/parity.env; set +a; DOCUMENT_QUEUE=local exec "$HOME/.klui/parity/docworker-venv/bin/python" -u worker.py`], { cwd: import.meta.dirname, stdio: "ignore" });
check("Send opens once it's read", await until(() => find("sendButton")?.enabled, 90000));
await tap("sendButton");
check("the message goes with the document", await until(() => hasText("Done."), 60000));
worker.kill();
await tap("threadBack");
await until(() => find("chatList"));
sh(`rm -f /sdcard/Download/${BIG} /sdcard/Download/${DOC}`);

// With no connection the app still opens on the chats it last saw.
adb("reverse", "--remove", "tcp:55600");
restart();
check("the last list shows without a connection", await until(() => nodes().some((node) => node.id.startsWith("chatRow-")), 30000));
adb("reverse", "tcp:55600", "tcp:55600");

// Out of free messages: it says why and where to subscribe; the app doesn't sell plans.
await setFree("new");
await useUpFreeMessages("new");
restart();
await until(() => find("chatList"), 30000);
await tap("newChat");
await until(() => find("newChatHint"), 8000);
await tap("promptInput");
typeText("One more");
await tap("sendButton");
// The toast is brief, so its wording comes from the same read that found it.
const limitToast = await until(() => find("toast"), 8000);
check("the spent allowance says why", limitToast);
check("and where to subscribe", limitToast?.text?.includes("Subscribe on the website"), limitToast?.text);
check("without leaving the chat", find("promptInput") && !find("webSurface"));
shot("native-free-limit");

// Updates.
let feed = {};
const feedServer = http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(feed));
}).listen(55433);
adb("reverse", "tcp:55433", "tcp:55433");
feed = { published: true, versionCode: 999999, minimumVersionCode: 0, body: "A newer Klui." };
restart();
check("an available update asks", await until(() => find("updateDialog"), 30000));
shot("native-update");
await tap("updateLater");
check("and Later closes it", await until(() => !find("updateDialog"), 8000));
feed = { published: true, versionCode: 999999, minimumVersionCode: 999999 };
restart();
check("a required update asks", await until(() => find("updateDialog"), 30000));
check("with no way past it", !find("updateLater"));
back();
await wait(800);
check("Back doesn't close it", find("updateDialog"));
feed = { published: true, versionCode: 1, minimumVersionCode: 0 };
restart();
await until(() => find("chatList"), 30000);
check("an older feed stays quiet", !find("updateDialog"));
sh(`am force-stop ${PKG}`);
adb("reverse", "--remove", "tcp:55433");
feedServer.close();

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
