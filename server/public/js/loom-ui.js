/** Pure render helpers for the loom threads. */
import { COLOURS, ORIENTATION_ARROWS, ORIENTATION_NAMES } from "./shared.js";

export function createThreadEl(thread, opts = {}) {
  const el = document.createElement("div");
  el.className = [
    "thread",
    `colour-${thread.colour}`,
    thread.token ? "token" : "",
    thread.exhausted ? "exhausted" : "",
    opts.clickable ? "clickable" : "",
    opts.paymentSelectable ? "selectable-payment" : "",
    opts.paying ? "paying" : "",
    opts.highlightTarget ? "highlight-target" : "",
  ].join(" ");
  el.dataset.threadId = thread.id;
  el.innerHTML = `
    ${thread.token ? `<span class="token-tag">token</span>` : ""}
    ${thread.exhausted ? `<span class="flip-tag">flipped</span>` : ""}
    <div class="diamond"></div>
    <div class="arrow">${ORIENTATION_ARROWS[thread.orientation] ?? "↑"}</div>
    <div class="orient-tag">${ORIENTATION_NAMES[thread.orientation] ?? "up"}</div>`;
  el.title = thread.token
    ? `Threadling · colourless token · pointing ${ORIENTATION_NAMES[thread.orientation] ?? "up"}${thread.exhausted ? " · exhausted" : ""} — sacrificed (not flipped) to pay any one arrow`
    : `${COLOURS[thread.colour]?.label ?? "?"} thread · pointing ${ORIENTATION_NAMES[thread.orientation] ?? "up"}${thread.exhausted ? " · exhausted" : ""}`;
  return el;
}
