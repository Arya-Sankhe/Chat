import { Commands as e, subsetToBinary as t } from "./subset-shared.chunk-DLL6VnZE.js";
import "./percentages-BXMCSKIN-DphkO3ol.js";
var m = import.meta.url ? new URL(import.meta.url) : void 0;
typeof window > "u" && typeof self < "u" && (self.onmessage = async (a) => {
  if (a.data.command === e.Subset) {
    let s = await t(a.data.arrayBuffer, a.data.codePoints);
    self.postMessage(s, { transfer: [s] });
  }
});
export {
  m as WorkerUrl
};
