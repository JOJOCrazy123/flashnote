import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import "./styles.css";

const COLLAPSED_H = 120;
const EXPANDED_H = 520;
const WIN_W = 560;

// ---------- Types ----------
type Kind = "inspiration" | "todo";

interface Note {
  id: string;
  text: string;
  type: Kind;
  done: boolean;
  ts: number;
}

interface Settings {
  shortcut: string;
  day_tabs: number[];
}

interface TrashedNote extends Note {
  deleted_at: number;
}

// ---------- State ----------
let currentKind: Kind = "inspiration";
let historyOpen = false;
// "today" | "day-N" (N = 1..6) | "week" | "month" | "trash"
let rangeMode = "today";
let settings: Settings = { shortcut: "", day_tabs: [1, 2] };

// ---------- Helpers ----------
function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfWeek(d: Date): Date {
  const c = new Date(d);
  const day = (c.getDay() + 6) % 7; // Monday = 0
  c.setDate(c.getDate() - day);
  c.setHours(0, 0, 0, 0);
  return c;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${fmtTime(ts)}`;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function dayLabel(offset: number): string {
  if (offset === 1) return "昨天";
  if (offset === 2) return "前天";
  return `${offset}天前`;
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// ---------- Backend calls ----------
async function addNotes(texts: string[], kind: Kind): Promise<void> {
  await invoke("add_notes", { texts, kind });
}

async function getRange(start: string, end: string): Promise<Note[]> {
  return await invoke<Note[]>("get_range", { start, end });
}

async function toggleTodo(id: string, done: boolean): Promise<void> {
  await invoke("toggle_todo", { id, done });
}

async function deleteNote(id: string): Promise<void> {
  await invoke("delete_note", { id });
}

async function getSettings(): Promise<Settings> {
  return await invoke<Settings>("get_settings");
}

async function getTrash(): Promise<TrashedNote[]> {
  return await invoke<TrashedNote[]>("get_trash");
}

async function restoreNote(id: string): Promise<void> {
  await invoke("restore_note", { id });
}

async function deletePermanently(id: string): Promise<void> {
  await invoke("delete_permanently", { id });
}

async function emptyTrash(): Promise<void> {
  await invoke("empty_trash");
}

async function hideWindow(): Promise<void> {
  await invoke("hide_window");
}

async function copyNote(text: string, item: HTMLElement): Promise<void> {
  await writeText(text);
  item.classList.add("copied");
  window.setTimeout(() => item.classList.remove("copied"), 1000);
}

// ---------- Render ----------
const app = document.querySelector<HTMLDivElement>("#app")!;

app.innerHTML = `
  <div class="wrap" id="wrap">
    <div class="bar" data-tauri-drag-region>
      <div class="kind-toggle">
        <button class="kind-btn active" data-kind="inspiration">灵感</button>
        <button class="kind-btn" data-kind="todo">Todo</button>
      </div>
      <div class="bar-right">
        <div class="hint">空格×2 加下一条 · ↵ 保存 · Esc 隐藏</div>
        <button class="gear" id="gear" title="设置">⚙</button>
      </div>
    </div>
    <div class="chips" id="chips"></div>
    <input id="input" class="input" type="text" autocomplete="off"
           placeholder="记录一个灵感... (连按两次空格继续下一条)" />
    <div class="edge-hint" id="edge">▾ 历史</div>

    <div class="history" id="history">
      <div class="history-head">
        <div class="range-tabs" id="range-tabs"></div>
        <button class="trash-empty-btn" id="trash-empty-btn" style="display:none">清空垃圾箱</button>
      </div>
      <div class="history-list" id="history-list"></div>
    </div>
  </div>
`;

const input = document.querySelector<HTMLInputElement>("#input")!;
const wrap = document.querySelector<HTMLDivElement>("#wrap")!;
const chipsEl = document.querySelector<HTMLDivElement>("#chips")!;
const historyEl = document.querySelector<HTMLDivElement>("#history")!;
const historyList = document.querySelector<HTMLDivElement>("#history-list")!;
const rangeTabsEl = document.querySelector<HTMLDivElement>("#range-tabs")!;
const trashEmptyBtn = document.querySelector<HTMLButtonElement>("#trash-empty-btn")!;

// Committed-but-not-yet-saved entries (batch input via double-space).
// Each entry remembers the kind that was active when it was committed, so
// switching lists afterwards doesn't retroactively change queued entries.
let pending: { text: string; kind: Kind }[] = [];
let composing = false;
let lastSpaceTs = 0;
const DOUBLE_SPACE_MS = 350;

function renderChips() {
  chipsEl.innerHTML = pending
    .map(
      (entry, i) =>
        `<span class="chip ${entry.kind === "todo" ? "todo" : "inspiration"}"><span class="chip-text">${escapeHtml(entry.text)}</span><button class="chip-del" data-i="${i}" title="删除">✕</button></span>`,
    )
    .join("");
  chipsEl.querySelectorAll<HTMLButtonElement>(".chip-del").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      pending.splice(Number(btn.dataset.i), 1);
      renderChips();
      input.focus();
    });
  });
  adjustHeight();
}

// Grow the collapsed window so committed chips stay visible.
function adjustHeight() {
  if (historyOpen) return;
  const extra = chipsEl.offsetHeight ? chipsEl.offsetHeight + 8 : 0;
  const h = Math.min(EXPANDED_H, COLLAPSED_H + extra);
  getCurrentWindow().setSize(new LogicalSize(WIN_W, h));
}

// Turn the current input text into a chip; returns false if nothing to commit.
function commitCurrent(): boolean {
  const text = input.value.trim();
  if (!text) return false;
  pending.push({ text, kind: currentKind });
  input.value = "";
  renderChips();
  return true;
}

// Enter = finish: save current text + all chips as separate notes, then hide.
async function finishInput() {
  const entries = [...pending];
  const cur = input.value.trim();
  if (cur) entries.push({ text: cur, kind: currentKind });
  if (entries.length === 0) {
    await hideWindow();
    return;
  }
  // Preserve order while grouping consecutive entries of the same kind so each
  // note is saved with the kind that was active when it was entered.
  let i = 0;
  while (i < entries.length) {
    const kind = entries[i].kind;
    const texts: string[] = [];
    while (i < entries.length && entries[i].kind === kind) {
      texts.push(entries[i].text);
      i++;
    }
    await addNotes(texts, kind);
  }
  pending = [];
  input.value = "";
  renderChips();
  if (historyOpen) renderHistory();
  else await hideWindow();
}

// Kind toggle
document.querySelectorAll<HTMLButtonElement>(".kind-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".kind-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentKind = btn.dataset.kind as Kind;
    input.placeholder =
      currentKind === "todo"
        ? "记录一个 todo... (连按两次空格继续下一条)"
        : "记录一个灵感... (连按两次空格继续下一条)";
    renderChips();
    input.focus();
  });
});

// Gear -> open settings window
document.querySelector<HTMLButtonElement>("#gear")!.addEventListener("click", async (e) => {
  e.stopPropagation();
  await invoke("open_settings");
});

// Range tabs (built dynamically from settings.day_tabs)
function renderRangeTabs() {
  const offsets = [...(settings.day_tabs || [])]
    .filter((o) => o >= 1 && o <= 6)
    .sort((a, b) => a - b);
  const tabs: { mode: string; label: string }[] = [
    { mode: "today", label: "今天" },
    ...offsets.map((o) => ({ mode: `day-${o}`, label: dayLabel(o) })),
    { mode: "week", label: "本周" },
    { mode: "month", label: "本月" },
    { mode: "trash", label: "垃圾箱" },
  ];
  const valid = new Set(tabs.map((t) => t.mode));
  if (!valid.has(rangeMode)) rangeMode = "today";

  rangeTabsEl.innerHTML = tabs
    .map(
      (t) =>
        `<button class="range-tab${t.mode === rangeMode ? " active" : ""}${t.mode === "trash" ? " trash" : ""}" data-range="${t.mode}">${t.label}</button>`,
    )
    .join("");

  rangeTabsEl.querySelectorAll<HTMLButtonElement>(".range-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      rangeTabsEl.querySelectorAll(".range-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      rangeMode = tab.dataset.range!;
      renderHistory();
    });
  });
}

// Reload settings (day tabs may have changed in the settings window) then rebuild tabs.
async function refreshTabs(): Promise<void> {
  try {
    settings = await getSettings();
  } catch {
    // keep last known settings
  }
  renderRangeTabs();
}

// Track IME composition so Enter used to pick a candidate never submits.
input.addEventListener("compositionstart", () => {
  composing = true;
});
input.addEventListener("compositionend", () => {
  composing = false;
});

// Input submit / batch input
input.addEventListener("keydown", async (e) => {
  // While the IME is composing, let it own every key (Enter picks a candidate).
  if (composing || e.isComposing || e.keyCode === 229) return;

  if (e.key === " ") {
    const now = Date.now();
    if (now - lastSpaceTs < DOUBLE_SPACE_MS) {
      // Second quick space: commit current text as a chip instead of typing it.
      e.preventDefault();
      lastSpaceTs = 0;
      commitCurrent();
    } else {
      lastSpaceTs = now;
    }
    return;
  }

  lastSpaceTs = 0;

  if (e.key === "Enter") {
    e.preventDefault();
    await finishInput();
  } else if (e.key === "Escape") {
    await hideWindow();
  }
});

// ---------- Edge hover history ----------
let closeTimer: number | undefined;

function openHistory() {
  if (historyOpen) return;
  historyOpen = true;
  wrap.classList.add("expanded");
  getCurrentWindow().setSize(new LogicalSize(WIN_W, EXPANDED_H));
  refreshTabs().then(() => renderHistory());
}

function scheduleClose() {
  clearTimeout(closeTimer);
  closeTimer = window.setTimeout(() => {
    historyOpen = false;
    wrap.classList.remove("expanded");
    getCurrentWindow().setSize(new LogicalSize(WIN_W, COLLAPSED_H));
  }, 350);
}

// Reaching the bottom edge opens the panel.
document.addEventListener("mousemove", (e) => {
  const nearBottom = window.innerHeight - e.clientY < 14;
  if (nearBottom && !historyOpen) openHistory();
});

// Keep open while hovering the panel; retract when leaving it.
historyEl.addEventListener("mouseenter", () => clearTimeout(closeTimer));
historyEl.addEventListener("mouseleave", scheduleClose);
wrap.addEventListener("mouseleave", () => {
  if (historyOpen) scheduleClose();
});

// ---------- History render ----------
async function renderHistory() {
  trashEmptyBtn.style.display = rangeMode === "trash" ? "" : "none";

  if (rangeMode === "trash") {
    renderTrashList(await getTrash());
    return;
  }

  const now = new Date();
  let start: string;
  let end: string;
  if (rangeMode === "week") {
    start = fmtDate(startOfWeek(now));
    end = fmtDate(now);
  } else if (rangeMode === "month") {
    start = fmtDate(new Date(now.getFullYear(), now.getMonth(), 1));
    end = fmtDate(now);
  } else if (rangeMode.startsWith("day-")) {
    const day = fmtDate(daysAgo(parseInt(rangeMode.slice(4), 10)));
    start = day;
    end = day;
  } else {
    start = fmtDate(now);
    end = fmtDate(now);
  }

  const notes = await getRange(start, end);
  if (notes.length === 0) {
    historyList.innerHTML = `<div class="empty">暂无记录</div>`;
    return;
  }

  historyList.innerHTML = notes
    .map((n) => {
      const badge = n.type === "todo" ? "todo" : "灵感";
      const checkbox =
        n.type === "todo"
          ? `<input type="checkbox" class="chk" data-id="${n.id}" ${n.done ? "checked" : ""} />`
          : `<span class="dot"></span>`;
      const itemCls = [
        "item",
        n.type === "todo" ? "todo-item" : "",
        n.done ? "done" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `
        <div class="${itemCls}" data-id="${n.id}" data-type="${n.type}" data-done="${n.done}" title="单击复制">
          ${checkbox}
          <span class="badge ${n.type}">${badge}</span>
          <span class="text">${escapeHtml(n.text)}</span>
          <span class="time">${fmtTime(n.ts)}</span>
          <span class="copy-state">已复制</span>
          <button class="del" data-id="${n.id}" title="移入垃圾箱">✕</button>
        </div>`;
    })
    .join("");

  historyList.querySelectorAll<HTMLInputElement>(".chk").forEach((checkbox) => {
    checkbox.addEventListener("click", async (e) => {
      e.stopPropagation();
      await toggleTodo(checkbox.dataset.id!, checkbox.checked);
      renderHistory();
    });
  });
  historyList.querySelectorAll<HTMLDivElement>(".item").forEach((item) => {
    item.addEventListener("click", async (e) => {
      if ((e.target as HTMLElement).closest(".del, .chk")) return;
      const note = notes.find((n) => n.id === item.dataset.id);
      if (note) await copyNote(note.text, item);
    });
  });
  historyList.querySelectorAll<HTMLButtonElement>(".del").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await deleteNote(btn.dataset.id!);
      renderHistory();
    });
  });
}

// ---------- Trash render ----------
function renderTrashList(items: TrashedNote[]) {
  if (items.length === 0) {
    historyList.innerHTML = `<div class="empty">垃圾箱是空的</div>`;
    return;
  }

  historyList.innerHTML = items
    .map((n) => {
      const badge = n.type === "todo" ? "todo" : "灵感";
      return `
        <div class="item trash-item" data-id="${n.id}" title="单击复制">
          <span class="badge ${n.type}">${badge}</span>
          <span class="text">${escapeHtml(n.text)}</span>
          <span class="time">${fmtDateTime(n.ts)}</span>
          <span class="copy-state">已复制</span>
          <button class="restore" data-id="${n.id}" title="恢复">↩</button>
          <button class="del permanent" data-id="${n.id}" title="彻底删除">✕</button>
        </div>`;
    })
    .join("");

  historyList.querySelectorAll<HTMLButtonElement>(".restore").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await restoreNote(btn.dataset.id!);
      renderHistory();
    });
  });
  historyList.querySelectorAll<HTMLButtonElement>(".del").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await deletePermanently(btn.dataset.id!);
      renderHistory();
    });
  });
  historyList.querySelectorAll<HTMLDivElement>(".item").forEach((item) => {
    item.addEventListener("click", async (e) => {
      if ((e.target as HTMLElement).closest(".del, .restore")) return;
      const note = items.find((n) => n.id === item.dataset.id);
      if (note) await copyNote(note.text, item);
    });
  });
}

trashEmptyBtn.addEventListener("click", async () => {
  await emptyTrash();
  renderHistory();
});

// ---------- Focus on shortcut ----------
listen("focus-input", () => {
  input.focus();
  input.select();
});

// Focus once on load (dev convenience)
window.addEventListener("DOMContentLoaded", () => input.focus());
input.focus();

// Expose settings type so tsc keeps the import meaningful if extended later.
export type { Settings };
