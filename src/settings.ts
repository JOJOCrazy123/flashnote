import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./settings.css";

interface Settings {
  shortcut: string;
}

const app = document.querySelector<HTMLDivElement>("#settings-app")!;

app.innerHTML = `
  <div class="s-wrap">
    <h1>设置</h1>

    <section class="row">
      <label>全局唤起快捷键</label>
      <div class="capture-box" id="capture" tabindex="0">
        <span id="shortcut-text">点击此处后按下组合键</span>
      </div>
      <p class="tip">需含至少一个修饰键（⌘/Ctrl/⌥/⇧）+ 一个或多个主键，例如 ⇧QW</p>
    </section>

    <div class="actions">
      <span class="status" id="status"></span>
      <button class="btn ghost" id="cancel">关闭</button>
      <button class="btn primary" id="save" disabled>保存</button>
    </div>
  </div>
`;

const captureBox = document.querySelector<HTMLDivElement>("#capture")!;
const shortcutText = document.querySelector<HTMLSpanElement>("#shortcut-text")!;
const saveBtn = document.querySelector<HTMLButtonElement>("#save")!;
const cancelBtn = document.querySelector<HTMLButtonElement>("#cancel")!;
const statusEl = document.querySelector<HTMLSpanElement>("#status")!;

let captured = ""; // accelerator string for backend, e.g. "CmdOrCtrl+Shift+A"
let capturing = false;
let capturedMods: string[] = [];
const capturedMainKeys = new Set<string>();

const isMac = navigator.platform.toUpperCase().includes("MAC");

function displayFor(accel: string): string {
  if (!accel) return "";
  return accel
    .replace(/CmdOrCtrl/gi, isMac ? "⌘" : "Ctrl")
    .replace(/CommandOrControl/gi, isMac ? "⌘" : "Ctrl")
    .replace(/Command|Cmd|Super|Meta/gi, "⌘")
    .replace(/Control|Ctrl/gi, "Ctrl")
    .replace(/Option|Alt/gi, isMac ? "⌥" : "Alt")
    .replace(/Shift/gi, "⇧")
    .split("+")
    .map((s) => s.trim())
    .join(isMac ? "" : "+");
}

async function loadCurrent() {
  const s = await invoke<Settings>("get_settings");
  captured = s.shortcut;
  shortcutText.textContent = displayFor(s.shortcut) || s.shortcut;
}
loadCurrent();

// ---- Key capture ----
captureBox.addEventListener("click", () => {
  capturing = true;
  capturedMods = [];
  capturedMainKeys.clear();
  captureBox.classList.add("capturing");
  shortcutText.textContent = "请按下组合键…";
  statusEl.textContent = "";
  captureBox.focus();
});

captureBox.addEventListener("keydown", (e) => {
  if (!capturing) return;
  e.preventDefault();

  if (e.repeat) return;

  const mods: string[] = [];
  if (e.metaKey) mods.push(isMac ? "Cmd" : "Super");
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");

  const isModifierOnly = ["Meta", "Control", "Alt", "Shift"].includes(e.key);
  if (isModifierOnly) {
    shortcutText.textContent = displayFor(mods.join("+") + "+");
    return;
  }

  let mainKey = "";
  if (/^Key[A-Z]$/.test(e.code)) mainKey = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) mainKey = e.code.slice(5);
  else if (e.code === "Space") mainKey = "Space";
  else if (e.code === "Enter" || e.code === "NumpadEnter") mainKey = "Enter";

  if (!mainKey || mods.length === 0) {
    statusEl.textContent = "需修饰键 + 主键";
    statusEl.className = "status err";
    return;
  }

  // Normalize cross-platform primary modifier to CmdOrCtrl when it's the sole meta/ctrl.
  const normalizedMods = mods.map((m) =>
    m === "Cmd" || m === "Super" || m === "Ctrl" ? "CmdOrCtrl" : m
  );
  // De-dup CmdOrCtrl
  const dedup = normalizedMods.filter((m, i) => normalizedMods.indexOf(m) === i);

  capturedMods = dedup;
  capturedMainKeys.add(mainKey);
  shortcutText.textContent = displayFor([...capturedMods, ...capturedMainKeys].join("+"));
  statusEl.textContent = "";
  statusEl.className = "status";
});

captureBox.addEventListener("keyup", (e) => {
  if (!capturing) return;
  e.preventDefault();

  const releasedMainKey =
    /^Key[A-Z]$/.test(e.code) ||
    /^Digit[0-9]$/.test(e.code) ||
    e.code === "Space" ||
    e.code === "Enter" ||
    e.code === "NumpadEnter";

  if (!releasedMainKey || capturedMainKeys.size === 0) return;

  captured = [...capturedMods, ...capturedMainKeys].join("+");
  capturing = false;
  captureBox.classList.remove("capturing");
  shortcutText.textContent = displayFor(captured);
  saveBtn.disabled = false;
});

captureBox.addEventListener("blur", () => {
  if (capturing) {
    capturing = false;
    captureBox.classList.remove("capturing");
    shortcutText.textContent = displayFor(captured) || captured;
  }
});

// ---- Save / cancel ----
saveBtn.addEventListener("click", async () => {
  try {
    await invoke("set_shortcut", { shortcut: captured });
    statusEl.textContent = "已保存并生效";
    statusEl.className = "status ok";
    saveBtn.disabled = true;
  } catch (err) {
    statusEl.textContent = `保存失败：${err}`;
    statusEl.className = "status err";
  }
});

cancelBtn.addEventListener("click", () => {
  getCurrentWindow().hide();
});
