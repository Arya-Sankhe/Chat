// node cdp.mjs <port> <expression>  — evaluates (awaiting promises) in the first page target.
const [port = "9333", expr = "location.href"] = process.argv.slice(2);
const targets = await (await fetch(`http://localhost:${port}/json`)).json();
const ws = new WebSocket(targets.find((t) => t.type === "page" && !/^(about|data):/.test(t.url)).webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true, returnByValue: true } }));
const msg = await new Promise((r) => ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id === 1) r(m); }));
const res = msg.result?.result;
console.log(msg.result?.exceptionDetails ? JSON.stringify(msg.result.exceptionDetails) : typeof res?.value === "string" ? res.value : JSON.stringify(res?.value ?? res, null, 1));
ws.close();
