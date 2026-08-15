// @ts-nocheck
/* ==========================================================
   Cabinet library dialog — lets any user add their own speakers.
   Manual form / JSON / CSV / datasheet (text or PDF) input,
   cached locally and synced to the user's cloud library.
   ========================================================== */
import { supabase } from "@/integrations/supabase/client";
import {
  SPL_BANDS, CSV_COLUMNS, normalizeSpec, registerCabinet, unregisterCabinet,
  userCabinets, isUserCabinet, saveLocal, loadLocal, toJSON, toCSV,
  parseJSONLibrary, parseCSV,
} from "@/lib/acoustics/customCabinets";
import {
  listUserCabinets, saveUserCabinet, deleteUserCabinet, extractCabinetSpec,
} from "./cabinets.functions";

let session = null;
let onChanged = () => {};
let booted = false;

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function download(name, text, mime = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickFile(accept) {
  return new Promise((res) => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = accept;
    inp.onchange = () => res(inp.files?.[0] || null);
    inp.click();
  });
}

const readText = (f) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result)); fr.readAsText(f); });
const readDataUrl = (f) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result)); fr.readAsDataURL(f); });

/** Register local cache + cloud library. Called once at boot. */
export async function initCabinetLibrary(onChange) {
  onChanged = onChange || (() => {});
  if (booted) return;
  booted = true;
  loadLocal();
  const { data } = await supabase.auth.getSession();
  session = data.session;
  supabase.auth.onAuthStateChange((_e, s) => { session = s; void syncFromCloud(); });
  if (session) await syncFromCloud();
  onChanged();
}

async function syncFromCloud() {
  if (!session) return;
  try {
    const rows = await listUserCabinets();
    rows.forEach((c) => registerCabinet(c));
    saveLocal();
    onChanged();
  } catch (e) {
    console.warn("cabinet sync failed", e);
  }
}

async function persist(cab) {
  registerCabinet(cab);
  saveLocal();
  if (session) {
    try { await saveUserCabinet({ data: cab }); } catch (e) { return String(e.message || e); }
  }
  onChanged();
  return null;
}

async function remove(key) {
  unregisterCabinet(key);
  saveLocal();
  if (session) { try { await deleteUserCabinet({ data: { key } }); } catch { /* ignore */ } }
  onChanged();
}

/* ---------------- markup ---------------- */
const FIELDS = [
  ["key", "Model key", "text", "e.g. KSL8"],
  ["name", "Display name", "text", ""],
  ["manufacturer", "Manufacturer", "text", ""],
  ["kind", "Type", "select", ["array", "point", "sub"]],
  ["mounting", "Mounting", "select", ["flown", "stacked", "stack-only"]],
  ["h", "Height", "num", "m"],
  ["w", "Width", "num", "m"],
  ["d", "Depth", "num", "m"],
  ["kg", "Weight", "num", "kg"],
  ["hCov", "Horizontal coverage", "num", "°"],
  ["vCov", "Vertical coverage (point)", "num", "°"],
  ["splayMin", "Splay min", "num", "°"],
  ["splayMax", "Splay max", "num", "°"],
  ["qtyMax", "Max per hang", "num", ""],
  ["lowCut", "Low cut-off", "num", "Hz"],
  ["hiCut", "High cut-off", "num", "Hz"],
  ["ampCh", "Amp channels / box", "num", ""],
  ["ampModel", "Amplifier", "text", ""],
];

function fieldRow(f, v) {
  const [id, label, type, extra] = f;
  if (type === "select")
    return `<div class="f"><label>${label}</label><select data-cf="${id}">${extra
      .map((o) => `<option value="${o}" ${v === o ? "selected" : ""}>${o}</option>`).join("")}</select></div>`;
  return `<div class="f"><label>${label}</label><input data-cf="${id}" value="${esc(v ?? "")}" placeholder="${type === "num" ? extra : esc(extra)}"></div>`;
}

function formHTML(cab) {
  const s = cab?.spec || {};
  const val = { key: cab?.key, name: cab?.name, manufacturer: cab?.manufacturer, ...s };
  return `<div class="cf-grid">${FIELDS.map((f) => fieldRow(f, val[f[0]])).join("")}</div>
    <div class="cf-sub">Max SPL per octave band (dB @ 1 m)</div>
    <div class="cf-grid">${SPL_BANDS.map((b) =>
      `<div class="f"><label>${b >= 1000 ? b / 1000 + " kHz" : b + " Hz"}</label>
        <input data-cf="spl${b}" value="${esc(s.maxSplOct?.[b] ?? "")}"></div>`).join("")}
      <div class="f"><label>or single SPLmax</label><input data-cf="maxSpl" placeholder="dB"></div>
    </div>`;
}

function listHTML() {
  const list = userCabinets();
  if (!list.length) return `<div class="cf-empty">No user cabinets yet. Add one manually, import a file, or paste a datasheet.</div>`;
  return `<div class="cf-list">${list.map((c) => `<div class="cf-row">
      <b>${esc(c.key)}</b><span>${esc(c.manufacturer || "")}</span>
      <span>${esc(c.spec.kind)} · ${c.spec.hCov}° · ${c.spec.kg} kg</span>
      <button class="btn sm" data-edit="${esc(c.key)}">Edit</button>
      <button class="btn sm" data-rm="${esc(c.key)}">Remove</button></div>`).join("")}</div>`;
}

/* ---------------- dialog ---------------- */
export function cabinetDialog(root) {
  const back = document.createElement("div");
  back.className = "dlg-back open";
  let editing = null;
  let mode = "list"; // list | form | paste | auth
  let msg = "";

  const accountBar = () => session
    ? `<div class="cf-acct">Synced to <b>${esc(session.user.email || "your account")}</b>
        <button class="btn sm" data-signout>Sign out</button></div>`
    : `<div class="cf-acct">Saved on this device only.
        <button class="btn sm" data-auth>Sign in to sync</button></div>`;

  function body() {
    if (mode === "auth")
      return `<div class="cf-auth">
        <div class="f"><label>Email</label><input data-au="email" type="email"></div>
        <div class="f"><label>Password</label><input data-au="pass" type="password"></div>
        <div class="r" style="gap:4px;margin-top:6px">
          <button class="btn primary sm" data-signin>Sign in</button>
          <button class="btn sm" data-signup>Create account</button>
          <button class="btn sm" data-google>Continue with Google</button>
          <button class="btn sm" data-back>Back</button></div></div>`;
    if (mode === "paste")
      return `<div class="cf-paste">
        <div class="cf-sub">Paste the specification block from a datasheet, or upload the PDF.</div>
        <textarea data-paste rows="10" placeholder="Model KSL8 — 2 x 10&quot; LF ... 90° horizontal ... 46 Hz – 18 kHz ... 143 dB SPLmax ... 39 kg"></textarea>
        <div class="r" style="gap:4px;margin-top:6px">
          <button class="btn primary sm" data-extract>Read specification</button>
          <button class="btn sm" data-pdf>Upload PDF…</button>
          <button class="btn sm" data-back>Back</button></div></div>`;
    if (mode === "form")
      return formHTML(editing) + `<div class="r" style="gap:4px;margin-top:8px">
        <button class="btn primary sm" data-save>Save cabinet</button>
        <button class="btn sm" data-back>Cancel</button></div>`;
    return listHTML() + `<div class="r" style="gap:4px;margin-top:8px;flex-wrap:wrap">
      <button class="btn primary sm" data-new>New cabinet</button>
      <button class="btn sm" data-imp-json>Import JSON…</button>
      <button class="btn sm" data-imp-csv>Import CSV…</button>
      <button class="btn sm" data-mode-paste>Paste datasheet / PDF…</button>
      <button class="btn sm" data-exp-json>Export JSON</button>
      <button class="btn sm" data-exp-csv>Export CSV</button></div>`;
  }

  function draw() {
    back.innerHTML = `<div class="dlg"><div class="hd">Cabinet library<span class="x" data-close>&#10005;</span></div>
      <div class="bd" style="width:640px;max-height:70vh;overflow:auto">
        ${accountBar()}
        ${msg ? `<div class="cf-msg">${esc(msg)}</div>` : ""}
        ${body()}
      </div>
      <div class="ft"><span class="cf-note">User cabinets are analytical models built from the figures you enter — no measured balloon data.</span>
        <button class="btn" data-close>Close</button></div></div>`;
  }

  const read = () => {
    const raw = {};
    back.querySelectorAll("[data-cf]").forEach((el) => { if (el.value !== "") raw[el.dataset.cf] = el.value; });
    return raw;
  };

  back.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.hasAttribute?.("data-close") || t === back) { back.remove(); return; }
    const q = (a) => t.closest?.(`[${a}]`);

    if (q("data-new")) { editing = null; mode = "form"; msg = ""; draw(); }
    else if (q("data-back")) { mode = "list"; msg = ""; draw(); }
    else if (q("data-mode-paste")) { mode = "paste"; msg = ""; draw(); }
    else if (q("data-auth")) { mode = "auth"; msg = ""; draw(); }
    else if (q("data-edit")) {
      editing = userCabinets().find((c) => c.key === q("data-edit").dataset.edit);
      mode = "form"; msg = ""; draw();
    } else if (q("data-rm")) {
      await remove(q("data-rm").dataset.rm); msg = "Cabinet removed."; draw();
    } else if (q("data-save")) {
      const res = normalizeSpec(read());
      if (!res.ok) { msg = res.errors.join(" "); draw(); return; }
      if (editing && editing.key !== res.cabinet.key) await remove(editing.key);
      const err = await persist(res.cabinet);
      msg = err ? `Saved locally, cloud sync failed: ${err}` : `${res.cabinet.key} saved.`;
      mode = "list"; draw();
    } else if (q("data-imp-json") || q("data-imp-csv")) {
      const csv = !!q("data-imp-csv");
      const f = await pickFile(csv ? ".csv,text/csv" : ".json,application/json");
      if (!f) return;
      const txt = await readText(f);
      const { cabinets, errors } = csv ? parseCSV(txt) : parseJSONLibrary(txt);
      for (const c of cabinets) await persist(c);
      msg = `Imported ${cabinets.length} cabinet(s).${errors.length ? " " + errors.join(" ") : ""}`;
      draw();
    } else if (q("data-exp-json")) { download("cabinets.json", toJSON()); }
    else if (q("data-exp-csv")) { download("cabinets.csv", CSV_COLUMNS.length ? toCSV() : "", "text/csv"); }
    else if (q("data-extract") || q("data-pdf")) {
      if (!session) { msg = "Sign in to use datasheet reading."; mode = "auth"; draw(); return; }
      let payload = {};
      if (q("data-pdf")) {
        const f = await pickFile("application/pdf,.pdf");
        if (!f) return;
        payload = { filename: f.name, fileData: await readDataUrl(f) };
      } else {
        const txt = back.querySelector("[data-paste]")?.value || "";
        if (!txt.trim()) { msg = "Paste some specification text first."; draw(); return; }
        payload = { text: txt };
      }
      msg = "Reading specification…"; draw();
      try {
        const out = JSON.parse(await extractCabinetSpec({ data: payload }));
        const res = normalizeSpec(out);
        editing = res.cabinet || { key: out.key || "", name: out.name || "", manufacturer: out.manufacturer || "", spec: { ...out, maxSplOct: {} } };
        mode = "form";
        msg = res.ok ? "Check the extracted values, then save." : "Extracted — some fields need completing: " + res.errors.join(" ");
      } catch (err) { msg = String(err.message || err); }
      draw();
    } else if (q("data-signin") || q("data-signup")) {
      const email = back.querySelector('[data-au="email"]').value.trim();
      const password = back.querySelector('[data-au="pass"]').value;
      const fn = q("data-signup")
        ? supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
        : supabase.auth.signInWithPassword({ email, password });
      const { data, error } = await fn;
      if (error) { msg = error.message; draw(); return; }
      session = data.session;
      msg = session ? "Signed in." : "Check your email to confirm the account.";
      mode = "list";
      if (session) await syncFromCloud();
      draw();
    } else if (q("data-google")) {
      const { lovable } = await import("@/integrations/lovable/index");
      const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
      if (result.error) { msg = String(result.error.message || result.error); draw(); }
    } else if (q("data-signout")) {
      await supabase.auth.signOut();
      session = null; msg = "Signed out — cabinets remain on this device."; draw();
    }
  });

  draw();
  (root || document.body).appendChild(back);
}

export { isUserCabinet };
