const state = {
  view: "dashboard",
  centers: [],
  representatives: [],
  assessments: [],
  calendar: { type: "approved", year: new Date().getFullYear(), month: new Date().getMonth() + 1, payload: null },
  finder: { query: "", selected: "", source: "", tab: "assessors", picked: { assessment_center: "", assessor: "", assessor_type: "province" } },
  report: { year: new Date().getFullYear(), month: new Date().getMonth() + 1, q: "" },
  history: { qualification: "", assessor_type: "", tab: "log" },
  theme: null,
  editingId: null,
  prefill: null,
  expandedTasks: new Set(),
  recordsSort: "added_desc",
};

const titles = {
  dashboard: ["Operations", "Dashboard"],
  scheduler: ["Records", "Assessment Scheduler"],
  calendar: ["Timeline", "Calendar"],
  finder: ["Lookup", "Qualification Finder"],
  history: ["Rotation", "Assessor History"],
  reps: ["People", "TESDA Representatives"],
  reports: ["Exports", "Monthly Reports"],
  settings: ["Sources", "Settings / Data Sources"],
};

const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];

async function api(path, options = {}) {
  const res = await fetch(path, options);
  if (!res.ok) {
    let message = "Request failed";
    try {
      const data = await res.json();
      message = data.error || data.message || message;
    } catch {}
    throw new Error(message);
  }
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  return res;
}

// Safely reads a fetch Response that's expected to be JSON. Used for the couple of
// upload flows that post raw FormData instead of going through api(), so a
// non-JSON response (a server crash page, a proxy timeout page, etc.) surfaces a
// readable message instead of crashing with "Unexpected token '<' ... is not valid
// JSON" on res.json().
async function readJsonResponse(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 160);
    const status = `${res.status} ${res.statusText}`.trim();
    throw new Error(
      snippet
        ? `Server error (${status}): ${snippet}${text.length > 160 ? "…" : ""}`
        : `Server error (${status}) with no details.`
    );
  }
}

function $(id) { return document.getElementById(id); }

function toast(message, kind = "ok") {
  const el = document.createElement("div");
  el.className = `toast ${kind === "error" ? "error" : ""}`;
  el.textContent = message;
  $("toast-stack").appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function openModal(html) {
  $("modal-card").innerHTML = html;
  $("modal").classList.remove("hidden");
}

function closeModal() {
  $("modal").classList.add("hidden");
  $("modal-card").innerHTML = "";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

function durationLabel(type) {
  return type === "continuous" ? "Continuous / Multiple Days" : "Single Day";
}

function optionList(values, selected = "") {
  return values.map((value) => {
    const label = typeof value === "string" ? value : (value.display_name || value.name);
    const key = typeof value === "string" ? value : value.name;
    return `<option value="${escapeHtml(key)}" ${key === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
}

function hexToRgb(hex) {
  const raw = String(hex || "").replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((ch) => ch + ch).join("") : raw;
  const value = Number.parseInt(full, 16);
  if (Number.isNaN(value)) return [15, 118, 110];
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function applyTheme(theme) {
  if (!theme) return;
  state.theme = theme;
  const root = document.documentElement;
  const [br, bg, bb] = hexToRgb(theme.background);
  const [sr, sg, sb] = hexToRgb(theme.secondary);
  const lightBg = Number.parseInt(String(theme.background || "").replace("#", ""), 16) > 0x888888;
  root.style.setProperty("--bg", theme.background);
  root.style.setProperty("--bg-2", theme.background);
  root.style.setProperty("--panel", `rgba(${br}, ${bg}, ${bb}, ${lightBg ? 0.92 : 0.78})`);
  root.style.setProperty("--text", theme.text);
  root.style.setProperty("--primary", theme.primary);
  root.style.setProperty("--cyan", theme.secondary);
  root.style.setProperty("--cyan-2", theme.secondary);
  root.style.setProperty("--gold", theme.highlight);
  root.style.setProperty("--line", `rgba(${sr}, ${sg}, ${sb}, 0.28)`);
  root.style.setProperty("--input-bg", lightBg ? "rgba(255,255,255,0.72)" : "rgba(4, 14, 20, 0.7)");
  root.style.setProperty("--muted", lightBg ? "color-mix(in srgb, var(--text) 62%, var(--bg))" : "#8aa3ae");
  document.body.style.backgroundColor = theme.background;
}

async function refreshLookups() {
  state.centers = await api("/api/centers");
  state.representatives = await api("/api/representatives");
  state.assessments = await api("/api/assessments");
  updateRepDatalist();
}

// A single persistent <datalist>, kept in sync whenever representatives are
// (re)loaded, so every inline TESDA-rep input across the app (Dashboard task
// cards, Calendar day modal, Scheduler form) can share one "rep-options-inline"
// id without ever having two of the same id in the DOM at once.
function updateRepDatalist() {
  let list = document.getElementById("rep-options-inline");
  if (!list) {
    list = document.createElement("datalist");
    list.id = "rep-options-inline";
    document.body.appendChild(list);
  }
  list.innerHTML = state.representatives.map((r) => `<option value="${escapeHtml(r.name)}"></option>`).join("");
}

function switchView(view, extra) {
  state.view = view;
  document.querySelectorAll(".nav button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((section) => {
    const active = section.id === `view-${view}`;
    section.classList.toggle("active", active);
    section.hidden = !active;
  });
  const [eyebrow, title] = titles[view];
  $("view-eyebrow").textContent = eyebrow;
  $("view-title").textContent = title;
  $("rail")?.classList.add("collapsed");
  render(extra);
}

async function render(extra) {
  try {
    if (state.view === "dashboard") await renderDashboard();
    if (state.view === "scheduler") await renderScheduler(extra);
    if (state.view === "calendar") await renderCalendar();
    if (state.view === "finder") await renderFinder();
    if (state.view === "history") await renderHistory();
    if (state.view === "reps") await renderReps();
    if (state.view === "reports") await renderReports();
    if (state.view === "settings") await renderSettings();
  } catch (err) {
    toast(err.message, "error");
  }
}

// ---- Shared compact task-card component (Dashboard + Calendar day view) ----

function fmtShort(iso) {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Normalizes a dashboard item or a calendar event into one consistent shape.
function taskCardModel(raw, kind) {
  if (kind === "assessment") {
    const a = raw.assessment || raw;
    return {
      taskId: raw.task_id,
      done: !!raw.done,
      kind: "assessment",
      scheduleByDate: null,
      assessmentDate: raw.assessment_date || a.start_date,
      assessmentDateLabel: a.date_label,
      qualification: a.qualification,
      assessmentCenter: a.assessment_center,
      pax: a.pax,
      assessors: a.assessors || [],
      tesdaRepresentative: a.tesda_representative || "",
      assessmentId: a.id,
    };
  }
  const a = raw.assessment;
  return {
    taskId: raw.task_id,
    done: !!raw.done,
    kind,
    scheduleByDate: raw.date || null,
    assessmentDate: raw.assessment_date,
    assessmentDateLabel: fmt(raw.assessment_date),
    qualification: a.qualification,
    assessmentCenter: a.assessment_center,
    pax: a.pax,
    assessors: a.assessors || [],
    tesdaRepresentative: a.tesda_representative || "",
    assessmentId: a.id,
  };
}

const KIND_LABEL = { schedule: "Schedule", results: "Results", assessment: "Assessment" };
const KIND_CLASS = { schedule: "", results: "rose", assessment: "gold" };

function renderTaskCard(m) {
  const expanded = state.expandedTasks.has(m.taskId);
  const dateLine = m.kind === "assessment"
    ? fmtShort(m.assessmentDate)
    : `${fmtShort(m.scheduleByDate)} → ${fmtShort(m.assessmentDate)}`;
  const assessorNames = m.assessors.length ? m.assessors.map((a) => a.name).join(", ") : "Unassigned";

  const body = !expanded ? "" : `
    <div class="task-card-body">
      ${m.kind !== "assessment" ? `<div class="task-detail-row"><span class="task-detail-label">Create schedule by</span><span>${escapeHtml(fmt(m.scheduleByDate))}</span></div>` : ""}
      <div class="task-detail-row"><span class="task-detail-label">${m.kind === "assessment" ? "Assessment date" : "For assessment on"}</span><span>${escapeHtml(m.assessmentDateLabel || fmt(m.assessmentDate))}</span></div>
      <div class="task-detail-row"><span class="task-detail-label">Center</span><span>${escapeHtml(m.assessmentCenter || "—")} · ${m.pax || 0} pax</span></div>
      <div class="task-detail-row">
        <span class="task-detail-label">Assessor(s)</span>
        <span class="task-chip-list">
          ${m.assessors.length
            ? m.assessors.map((a) => `<span class="chip">${escapeHtml(a.name)} <small class="muted">(${a.assessor_type === "region" ? "Region" : "Province"})</small></span>`).join("")
            : `<span class="muted">Not yet assigned</span>`}
        </span>
      </div>
      <div class="task-detail-row"><span class="task-detail-label">TESDA Rep</span><span>${escapeHtml(m.tesdaRepresentative || "—")}</span></div>
      <div class="row-actions" style="margin-top:8px">
        <button type="button" class="ghost" data-open-assessment="${escapeHtml(m.assessmentId)}">View / edit assessment</button>
      </div>
    </div>
  `;

  return `
    <div class="task-card ${m.done ? "task-card-done" : ""}" data-qualification-preload="${escapeHtml(m.qualification)}">
      <div class="task-card-head">
        <input type="checkbox" data-task-toggle="${escapeHtml(m.taskId)}" ${m.done ? "checked" : ""} />
        <span class="chip ${KIND_CLASS[m.kind]}" style="flex:none">${KIND_LABEL[m.kind]}</span>
        <div class="task-card-summary" data-task-expand-toggle="${escapeHtml(m.taskId)}">
          <b>${escapeHtml(m.qualification)}</b>
          <span class="muted">${dateLine} · ${escapeHtml(m.assessmentCenter || "—")} · ${escapeHtml(assessorNames)}</span>
        </div>
        <button type="button" class="ghost task-chevron" data-task-expand-toggle="${escapeHtml(m.taskId)}">${expanded ? "▲" : "▼"}</button>
      </div>
      ${body}
    </div>
  `;
}

function renderTaskCardGroup(models, emptyMessage) {
  if (!models.length) return `<p class="empty">${escapeHtml(emptyMessage || "Nothing here.")}</p>`;
  return `<div class="task-card-list">${models.map(renderTaskCard).join("")}</div>`;
}

// Wires every task card's interactive bits inside `container`. `refresh` is called
// after any successful change (toggle) so the caller can re-fetch its own data;
// expand/collapse state survives because it's tracked by task_id in
// state.expandedTasks, not by DOM node. Editing assessors/TESDA rep is no
// longer done inline here — "View / edit assessment" sends the person to the
// full Scheduler for that.
function bindTaskCards(container, refresh) {
  container.querySelectorAll("[data-task-toggle]").forEach((box) => {
    box.addEventListener("change", async () => {
      const taskId = box.dataset.taskToggle;
      const done = box.checked;
      try {
        await api("/api/tasks/toggle", { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ task_id: taskId, done }) });
      } catch (err) {
        toast(err.message, "error");
        box.checked = !done;
        return;
      }
      toast(done ? "Marked as done." : "Marked as not done.");
      refresh();
    });
  });

  container.querySelectorAll("[data-task-expand-toggle]").forEach((el) => {
    el.addEventListener("click", () => {
      const taskId = el.dataset.taskExpandToggle;
      if (state.expandedTasks.has(taskId)) state.expandedTasks.delete(taskId);
      else state.expandedTasks.add(taskId);
      refresh();
    });
  });

  container.querySelectorAll("[data-open-assessment]").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeModal();
      state.editingId = btn.dataset.openAssessment;
      switchView("scheduler");
    });
  });
}

// Tracks the models from the most recent render, kept around in case other
// code needs to look up a card's current data by task_id.
let lastRenderedCardModels = {};
function trackCardModels(models) {
  models.forEach((m) => { lastRenderedCardModels[m.taskId] = m; });
}

async function renderDashboard() {
  await refreshLookups();
  const data = await api("/api/dashboard");

  const scheduleModels = data.schedule_today.map((raw) => taskCardModel(raw, "schedule"));
  const resultsModels = data.results_today.map((raw) => taskCardModel(raw, "results"));
  const todayModels = data.assessments_today.map((raw) => taskCardModel(raw, "assessment"));
  const upcomingModels = data.upcoming.map((raw) => taskCardModel(raw, "assessment"));
  trackCardModels([...scheduleModels, ...resultsModels, ...todayModels, ...upcomingModels]);

  $("view-dashboard").innerHTML = `
    <div class="grid stats">
      <div class="card"><div class="stat-value">${data.summary.tasks_pending_today}</div><div class="stat-label">Tasks pending today (${data.summary.tasks_today} total)</div></div>
      <div class="card"><div class="stat-value">${data.summary.assessments_this_month}</div><div class="stat-label">Assessments this month</div></div>
      <div class="card"><div class="stat-value">${data.summary.upcoming_assessments}</div><div class="stat-label">Upcoming assessments</div></div>
      <div class="card"><div class="stat-value">${data.summary.requiring_scheduling}</div><div class="stat-label">Still needing portal schedule</div></div>
    </div>
    <div class="grid two" style="margin-top:16px">
      <div class="card">
        <h3>Today's tasks</h3>
        ${renderTaskCardGroup([...scheduleModels, ...resultsModels], "Nothing due today.")}
      </div>
      <div class="card">
        <h3>Today's assessments</h3>
        ${renderTaskCardGroup(todayModels, "No assessments today.")}
        <h3 style="margin-top:18px">Upcoming</h3>
        ${renderTaskCardGroup(upcomingModels, "Nothing upcoming.")}
      </div>
    </div>
  `;
  bindTaskCards($("view-dashboard"), renderDashboard);
  maybeNotify(data);
}

function fmt(iso) {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function defaultAssessorRows() {
  return [{ assessor_type: "province", assessor: "" }];
}

async function renderScheduler(extra) {
  await refreshLookups();
  const editing = extra?.assessment || state.assessments.find((a) => a.id === state.editingId);
  const prefill = extra?.prefill || state.prefill || {};
  const current = editing || {
    assessment_center: prefill.assessment_center || "",
    qualification: prefill.qualification || "",
    duration_type: "continuous",
    start_date: "",
    end_date: "",
    pax: "",
    tesda_representative: prefill.tesda_representative || "",
    remarks: prefill.remarks || "",
  };

  let startingAssessorRows;
  if (prefill.assessors && prefill.assessors.length) {
    startingAssessorRows = prefill.assessors;
  } else if (prefill.assessor) {
    // Compatibility with single-assessor prefills (e.g. "Use assessor" from Qualification Finder).
    startingAssessorRows = [{ assessor_type: prefill.assessor_type || "province", assessor: prefill.assessor }];
  } else if (editing && editing.assessors && editing.assessors.length) {
    startingAssessorRows = editing.assessors.map((a) => ({
      assessor_type: a.assessor_type === "region" ? "region" : "province",
      assessor: a.name,
    }));
  } else if (editing && editing.assessor) {
    startingAssessorRows = [{ assessor_type: editing.assessor_type === "region" ? "region" : "province", assessor: editing.assessor }];
  } else {
    startingAssessorRows = defaultAssessorRows();
  }
  let assessorRows = startingAssessorRows.map((row) => ({
    assessor_type: row.assessor_type === "region" ? "region" : "province",
    assessor: row.assessor || "",
  }));

  // Approved (schedule reminder) dates are normally auto-calculated, one per
  // assessment day, but can be hand-edited here for a special exemption — the
  // backend keeps whichever ones actually differ from its own calculation and
  // flags the record as manually overridden so "Recalculate all assessment
  // dates" in Settings leaves it alone.
  let approvedRows = [];
  let defaultApprovedByDate = {};
  async function fetchDerivedDates(startVal, endVal, durationType) {
    if (!startVal) return null;
    const params = new URLSearchParams({ start_date: startVal, end_date: endVal || startVal, duration_type: durationType });
    try {
      return await api(`/api/calculate-dates?${params.toString()}`);
    } catch (err) {
      toast(err.message, "error");
      return null;
    }
  }
  if (editing && editing.approved_dates && editing.approved_dates.length) {
    approvedRows = editing.approved_dates.map((p) => ({ ...p }));
    const derived = await fetchDerivedDates(editing.start_date, editing.end_date, editing.duration_type);
    if (derived) derived.approved_dates.forEach((p) => { defaultApprovedByDate[p.assessment_date] = p.date; });
  } else if (prefill.approved_dates && prefill.approved_dates.length) {
    approvedRows = prefill.approved_dates.map((p) => ({ ...p }));
    const derived = await fetchDerivedDates(current.start_date, current.end_date || current.start_date, current.duration_type === "continuous" ? "continuous" : "single");
    if (derived) derived.approved_dates.forEach((p) => { defaultApprovedByDate[p.assessment_date] = p.date; });
  } else if (current.start_date) {
    const derived = await fetchDerivedDates(current.start_date, current.end_date || current.start_date, current.duration_type === "continuous" ? "continuous" : "single");
    if (derived) {
      derived.approved_dates.forEach((p) => { defaultApprovedByDate[p.assessment_date] = p.date; });
      approvedRows = derived.assessment_dates.map((ad) => ({ assessment_date: ad, date: defaultApprovedByDate[ad] }));
    }
  }

  function approvedDatesHtml() {
    if (!approvedRows.length) return `<p class="muted">Pick the assessment date(s) above first.</p>`;
    return approvedRows.map((row, index) => {
      const isOverride = !!defaultApprovedByDate[row.assessment_date] && row.date !== defaultApprovedByDate[row.assessment_date];
      return `
        <div class="approved-date-row${isOverride ? " approved-date-row-override" : ""}">
          <span class="approved-date-label">For ${escapeHtml(fmt(row.assessment_date))}</span>
          <input type="date" class="approved-date-input" data-index="${index}" value="${row.date || ""}" />
          ${isOverride
            ? `<button type="button" class="ghost approved-date-reset" data-index="${index}">Reset</button>`
            : `<span class="muted" style="font-size:12px;white-space:nowrap">Calculated</span>`}
        </div>
      `;
    }).join("");
  }

  function bindApprovedDateEvents() {
    document.querySelectorAll(".approved-date-input").forEach((input) => {
      input.addEventListener("change", () => {
        const idx = Number(input.dataset.index);
        approvedRows[idx].date = input.value;
        redrawApprovedDates();
      });
    });
    document.querySelectorAll(".approved-date-reset").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.index);
        const ad = approvedRows[idx].assessment_date;
        if (defaultApprovedByDate[ad]) approvedRows[idx].date = defaultApprovedByDate[ad];
        redrawApprovedDates();
      });
    });
  }

  function redrawApprovedDates() {
    $("approved-dates-rows").innerHTML = approvedDatesHtml();
    bindApprovedDateEvents();
  }

  // Re-syncs approvedRows/defaultApprovedByDate whenever the date range or
  // duration changes, preserving any day the person already hand-edited (as
  // long as that same assessment date still exists in the new range).
  async function onDateRangeChanged() {
    const startVal = form.start_date.value;
    const durationType = $("duration-type-checkbox").checked ? "continuous" : "single";
    const endVal = durationType === "continuous" ? (form.end_date.value || startVal) : startVal;
    const derived = await fetchDerivedDates(startVal, endVal, durationType);
    if (!derived) {
      approvedRows = [];
      defaultApprovedByDate = {};
      redrawApprovedDates();
      return;
    }
    const newDefaults = {};
    derived.approved_dates.forEach((p) => { newDefaults[p.assessment_date] = p.date; });
    const preserved = {};
    approvedRows.forEach((row) => {
      const oldDefault = defaultApprovedByDate[row.assessment_date];
      if (oldDefault && row.date !== oldDefault) preserved[row.assessment_date] = row.date;
    });
    defaultApprovedByDate = newDefaults;
    approvedRows = derived.assessment_dates.map((ad) => ({ assessment_date: ad, date: preserved[ad] || newDefaults[ad] }));
    redrawApprovedDates();
  }

  const quals = current.assessment_center
    ? (state.centers.find((c) => c.name === current.assessment_center)?.qualifications || [])
    : [];
  const qualQuery = current.qualification ? `&qualification=${encodeURIComponent(current.qualification)}` : "";
  const [provinceAssessors, regionAssessors] = await Promise.all([
    api(`/api/assessors?source=province${qualQuery}`),
    api(`/api/assessors?source=region${qualQuery}`),
  ]);
  const assessorsBySource = { province: provinceAssessors, region: regionAssessors };

  function assessorRowsHtml() {
    return assessorRows.map((row, index) => {
      const list = assessorsBySource[row.assessor_type].assessors;
      const thisLabel = row.assessor_type === "province" ? "Province-Based" : "Region-Based";
      const otherSource = row.assessor_type === "province" ? "region" : "province";
      const otherLabel = otherSource === "region" ? "Region-Based" : "Province-Based";
      const otherList = assessorsBySource[otherSource].assessors;
      const isCustom = !!row.assessor && !list.some((a) => a.name === row.assessor);
      const emptyHint = !list.length
        ? (otherList.length
            ? `<p class="hint" style="margin:4px 0 0">No ${thisLabel} assessors recorded for this qualification — ${otherList.length} available under ${otherLabel} instead. You can also just type a name below for someone not in the Excel file.</p>`
            : `<p class="hint" style="margin:4px 0 0">No assessors recorded for this qualification under either Province-Based or Region-Based in the uploaded Excel files. Type a name below to add one anyway.</p>`)
        : "";
      return `
        <div class="assessor-row">
          <select class="assessor-type-input" data-index="${index}">
            <option value="province" ${row.assessor_type === "province" ? "selected" : ""}>Province-Based</option>
            <option value="region" ${row.assessor_type === "region" ? "selected" : ""}>Region-Based</option>
          </select>
          <input
            type="text"
            class="assessor-name-input"
            data-index="${index}"
            list="assessor-options-${index}"
            placeholder="Type a name or pick a saved one"
            value="${escapeHtml(row.assessor)}"
          />
          <datalist id="assessor-options-${index}">
            ${optionList(list)}
          </datalist>
          <button type="button" class="ghost assessor-remove" data-index="${index}" ${assessorRows.length <= 1 ? "disabled" : ""}>Remove</button>
        </div>
        ${isCustom ? `<p class="hint" style="margin:4px 0 0">"${escapeHtml(row.assessor)}" isn't in the Excel registry — it'll be saved as a custom assessor.</p>` : emptyHint}
      `;
    }).join("");
  }

  function redrawAssessorRows() {
    $("assessor-rows").innerHTML = assessorRowsHtml();
    bindAssessorRowEvents();
  }

  function bindAssessorRowEvents() {
    document.querySelectorAll(".assessor-type-input").forEach((sel) => {
      sel.addEventListener("change", () => {
        const idx = Number(sel.dataset.index);
        assessorRows[idx] = { assessor_type: sel.value, assessor: "" };
        redrawAssessorRows();
      });
    });
    document.querySelectorAll(".assessor-name-input").forEach((input) => {
      input.addEventListener("input", () => {
        const idx = Number(input.dataset.index);
        assessorRows[idx].assessor = input.value;
      });
      // Re-render on blur only, so the "custom assessor" hint and dedupe-safe state
      // stay in sync without fighting the caret position while the person is typing.
      input.addEventListener("change", () => {
        const idx = Number(input.dataset.index);
        assessorRows[idx].assessor = input.value;
        redrawAssessorRows();
      });
    });
    document.querySelectorAll(".assessor-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.index);
        if (assessorRows.length <= 1) return;
        assessorRows.splice(idx, 1);
        redrawAssessorRows();
      });
    });
  }

  $("view-scheduler").innerHTML = `
    <div class="scheduler-layout">
      <div class="card scheduler-form">
        <h3>${editing ? "Edit assessment" : "Assessment entry"}</h3>
        <p class="hint">Approved, schedule, and results dates are calculated automatically.</p>
        <form id="assessment-form" class="form-grid">
          <div class="field full">
            <label>Assessment Center</label>
            <select name="assessment_center" required>
              <option value="">Select center</option>
              ${optionList(state.centers.map((c) => c.name), current.assessment_center)}
            </select>
          </div>
          <div class="field full">
            <label>Qualification</label>
            <select name="qualification" required>
              <option value="">Select qualification</option>
              ${optionList(quals, current.qualification)}
            </select>
          </div>
          <div class="field">
            <label>Assessment Duration</label>
            <label class="checkbox-field">
              <input type="checkbox" name="duration_type" id="duration-type-checkbox" value="continuous" ${current.duration_type === "continuous" ? "checked" : ""} />
              <span>Continuous / Multiple Days</span>
            </label>
            <span class="muted" style="font-size:12px">Unchecked = single day</span>
          </div>
          <div class="field">
            <label>Number of Pax</label>
            <input type="number" min="1" name="pax" value="${escapeHtml(current.pax)}" required />
          </div>
          <div class="field">
            <label id="start-label">${current.duration_type === "continuous" ? "Start Date" : "Assessment Date"}</label>
            <input type="date" name="start_date" value="${current.start_date || ""}" required />
          </div>
          <div class="field" id="end-wrap" style="${current.duration_type === "continuous" ? "" : "display:none"}">
            <label>End Date</label>
            <input type="date" name="end_date" value="${current.end_date || ""}" />
          </div>
          <div class="field full">
            <label>Approved / Schedule Dates</label>
            <p class="hint">Calculated automatically from the assessment date(s) above. Edit a date only for a special exemption — rows left as-is stay on the automatic rule.</p>
            <div id="approved-dates-rows">${approvedDatesHtml()}</div>
          </div>
          <div class="field full">
            <label>Assessors</label>
            <div id="assessor-rows">${assessorRowsHtml()}</div>
            <button type="button" class="ghost" id="add-assessor">+ Add another assessor</button>
          </div>
          <div class="field full">
            <label>TESDA Representative</label>
            <input type="text" name="tesda_representative" list="rep-options" placeholder="Type a name or pick a saved one" value="${escapeHtml(current.tesda_representative)}" />
            <datalist id="rep-options">
              ${state.representatives.map((r) => `<option value="${escapeHtml(r.name)}"></option>`).join("")}
            </datalist>
          </div>
          <div class="field full">
            <label>Remarks</label>
            <textarea name="remarks" placeholder="Optional — leave blank if none">${escapeHtml(current.remarks || "")}</textarea>
          </div>
          <div class="field full row-actions">
            <button class="primary" type="submit">${editing ? "Update record" : "Save assessment"}</button>
            ${editing ? `<button class="ghost" type="button" id="cancel-edit">Cancel</button>` : ""}
          </div>
        </form>
      </div>
      <div class="card scheduler-records">
        <h3>Assessment records</h3>
        <div class="records-toolbar">
          <label for="records-sort" class="muted" style="text-transform:none;letter-spacing:normal">Sort by</label>
          <select id="records-sort">
            <option value="added_desc" ${state.recordsSort === "added_desc" ? "selected" : ""}>Date added (newest first)</option>
            <option value="added_asc" ${state.recordsSort === "added_asc" ? "selected" : ""}>Date added (oldest first)</option>
            <option value="assessment_desc" ${state.recordsSort === "assessment_desc" ? "selected" : ""}>Assessment date (latest first)</option>
            <option value="assessment_asc" ${state.recordsSort === "assessment_asc" ? "selected" : ""}>Assessment date (earliest first)</option>
          </select>
        </div>
        <div id="records-list">${assessmentCards(sortAssessments(state.assessments, state.recordsSort))}</div>
      </div>
    </div>
  `;

  $("records-sort").addEventListener("change", (event) => {
    state.recordsSort = event.target.value;
    $("records-list").innerHTML = assessmentCards(sortAssessments(state.assessments, state.recordsSort));
    bindRecordButtons();
  });

  bindAssessorRowEvents();
  $("add-assessor").addEventListener("click", () => {
    assessorRows.push({ assessor_type: "province", assessor: "" });
    redrawAssessorRows();
  });
  bindApprovedDateEvents();

  const form = $("assessment-form");
  const duration = $("duration-type-checkbox");
  const endWrap = $("end-wrap");
  duration.addEventListener("change", () => {
    const continuous = duration.checked;
    endWrap.style.display = continuous ? "" : "none";
    $("start-label").textContent = continuous ? "Start Date" : "Assessment Date";
    onDateRangeChanged();
  });
  form.start_date.addEventListener("change", onDateRangeChanged);
  form.end_date.addEventListener("change", onDateRangeChanged);
  form.assessment_center.addEventListener("change", async () => {
    state.prefill = { ...formValues(form), assessors: assessorRows.slice(), approved_dates: approvedRows.slice() };
    state.prefill.qualification = "";
    await renderScheduler({ prefill: state.prefill, assessment: editing });
  });
  form.qualification.addEventListener("change", async () => {
    state.prefill = { ...formValues(form), assessors: assessorRows.slice(), approved_dates: approvedRows.slice() };
    await renderScheduler({ prefill: state.prefill, assessment: editing });
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = formValues(form);
    payload.pax = Number(payload.pax);
    if (payload.duration_type === "single") payload.end_date = payload.start_date;
    payload.assessors = assessorRows
      .filter((row) => row.assessor)
      .map((row) => ({ name: row.assessor, assessor_type: row.assessor_type }));
    payload.approved_dates = approvedRows.map((row) => ({ assessment_date: row.assessment_date, date: row.date }));
    // Assessors are optional — the date can be locked in before anyone is assigned.
    try {
      if (editing) {
        await api(`/api/assessments/${editing.id}`, { method: "PUT", headers: jsonHeaders(), body: JSON.stringify(payload) });
        toast("Assessment updated. Dates recalculated.");
      } else {
        await api("/api/assessments", { method: "POST", headers: jsonHeaders(), body: JSON.stringify(payload) });
        toast("Assessment saved.");
      }
      state.editingId = null;
      state.prefill = null;
      await renderScheduler();
    } catch (err) {
      toast(err.message, "error");
    }
  });
  $("cancel-edit")?.addEventListener("click", () => {
    state.editingId = null;
    state.prefill = null;
    renderScheduler();
  });
  bindRecordButtons();
}

function formValues(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  // duration_type is now a checkbox ("Continuous / Multiple Days"); FormData
  // only includes it when checked, so an absent entry means single-day.
  values.duration_type = values.duration_type === "continuous" ? "continuous" : "single";
  return values;
}

function jsonHeaders() {
  return { "Content-Type": "application/json" };
}

function itemAssessors(item) {
  if (item.assessors && item.assessors.length) return item.assessors;
  // Only fall back to the legacy singular fields for old records that never had
  // an "assessors" array at all. If "assessors" is present but empty, that's a
  // deliberate "not yet assigned" state and should stay empty, not be misread
  // as a single assessor with a blank name.
  if (!item.assessors && item.assessor) return [{ name: item.assessor, assessor_type: item.assessor_type }];
  return [];
}

function assessorChipLabel(item) {
  const list = itemAssessors(item);
  if (!list.length) return "Not yet assigned";
  if (list.length > 1) return `${list.length} Assessors`;
  return list[0].assessor_type === "region" ? "Region-Based" : "Province-Based";
}

function assessorsSummary(item) {
  const list = itemAssessors(item);
  if (!list.length) return "Not yet assigned";
  return list
    .map((a) => `${a.name} (${a.assessor_type === "region" ? "Region-Based" : "Province-Based"})`)
    .join("; ");
}

function sortAssessments(items, sortKey) {
  const sorted = items.slice();
  const byAdded = (item) => item.created_at || "";
  const byAssessmentDate = (item) => item.start_date || "";
  switch (sortKey) {
    case "added_asc":
      sorted.sort((a, b) => byAdded(a).localeCompare(byAdded(b)));
      break;
    case "assessment_desc":
      sorted.sort((a, b) => byAssessmentDate(b).localeCompare(byAssessmentDate(a)));
      break;
    case "assessment_asc":
      sorted.sort((a, b) => byAssessmentDate(a).localeCompare(byAssessmentDate(b)));
      break;
    case "added_desc":
    default:
      sorted.sort((a, b) => byAdded(b).localeCompare(byAdded(a)));
      break;
  }
  return sorted;
}

function assessmentCards(items) {
  if (!items.length) return `<p class="empty">No assessments yet.</p>`;
  return `<div class="record-list">${items.map((item) => `
    <article class="record-card">
      <h4>${escapeHtml(item.assessment_center)}</h4>
      <div class="muted">${escapeHtml(item.qualification)}</div>
      <div class="record-meta">
        <span class="chip">${escapeHtml(durationLabel(item.duration_type))}</span>
        <span class="chip gold">${escapeHtml(assessorChipLabel(item))}</span>
        ${item.approved_dates_manual ? `<span class="chip rose">Manually overridden dates</span>` : ""}
        <span>${escapeHtml(item.date_label)}</span>
        <span class="muted">${item.pax} pax</span>
      </div>
      <div><b>Assessors:</b> ${escapeHtml(assessorsSummary(item))}</div>
      <div><b>TESDA Representative:</b> ${escapeHtml(item.tesda_representative || "None")}</div>
      ${item.remarks ? `<div><b>Remarks:</b> ${escapeHtml(item.remarks)}</div>` : ""}
      <div class="muted">Approved: ${escapeHtml(item.approved_date_list.map(fmt).join("; ") || "—")}</div>
      <div class="muted">Results: ${escapeHtml(item.results_reminder_list.map(fmt).join("; ") || "—")}</div>
      <div class="row-actions">
        <button class="ghost" data-edit="${item.id}">Edit</button>
        <button class="danger" data-delete="${item.id}">Delete</button>
      </div>
    </article>
  `).join("")}</div>`;
}

function assessmentTable(items) {
  if (!items.length) return `<p class="empty">No assessments yet.</p>`;
  return `<table>
    <thead><tr>
      <th>Center / Qualification</th><th>Dates</th><th>People</th><th>Calculated dates</th><th></th>
    </tr></thead>
    <tbody>
      ${items.map((item) => `
        <tr>
          <td><b>${escapeHtml(item.assessment_center)}</b><br><span class="muted">${escapeHtml(item.qualification)}</span></td>
          <td><span class="chip">${escapeHtml(durationLabel(item.duration_type))}</span><br>${escapeHtml(item.date_label)}<br><span class="muted">${item.pax} pax</span></td>
          <td>${escapeHtml(assessorsSummary(item))}<br><span class="muted">${escapeHtml(item.tesda_representative || "No representative")}</span></td>
          <td>
            <div>Approved: ${escapeHtml(item.approved_date_list.map(fmt).join("; "))}</div>
            <div>Results: ${escapeHtml(item.results_reminder_list.map(fmt).join("; "))}</div>
          </td>
          <td class="row-actions">
            <button class="ghost" data-edit="${item.id}">Edit</button>
            <button class="danger" data-delete="${item.id}">Delete</button>
          </td>
        </tr>
      `).join("")}
    </tbody>
  </table>`;
}

function bindRecordButtons() {
  document.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.editingId = btn.dataset.edit;
      switchView("scheduler");
    });
  });
  document.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this assessment record?")) return;
      await api(`/api/assessments/${btn.dataset.delete}`, { method: "DELETE" });
      toast("Assessment deleted.");
      state.editingId = null;
      await render();
    });
  });
}

async function renderCalendar() {
  if (!state.representatives.length) await refreshLookups();
  const { type, year, month } = state.calendar;
  const payload = await api(`/api/calendar?type=${type}&year=${year}&month=${month}`);
  state.calendar.payload = payload;
  const first = new Date(year, month - 1, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells = [];
  for (let i = 0; i < startWeekday; i += 1) cells.push(`<div class="day muted"></div>`);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const info = payload.compact[iso];
    const isToday = iso === payload.today;
    const allDone = info && info.pending === 0;
    cells.push(`
      <button class="day ${isToday ? "today" : ""}" data-day="${iso}">
        <div class="day-num">${day}</div>
        ${info ? `<div class="day-alert ${allDone ? "day-alert-done" : ""}">${allDone ? `${info.count} done ✓` : `${info.pending} pending`}</div>` : ""}
      </button>
    `);
  }

  $("view-calendar").innerHTML = `
    <div class="card">
      <div class="cal-toolbar">
        <label>Calendar</label>
        <select id="cal-type">
          <option value="approved" ${type === "approved" ? "selected" : ""}>Approved Dates</option>
          <option value="assessment" ${type === "assessment" ? "selected" : ""}>Assessment Calendar</option>
          <option value="results" ${type === "results" ? "selected" : ""}>Results Calendar</option>
        </select>
        <button class="ghost" id="cal-prev">Prev</button>
        <strong>${monthNames[month - 1]} ${year}</strong>
        <button class="ghost" id="cal-next">Next</button>
      </div>
      <p class="hint">${calendarHint(type)}</p>
      <div class="cal-grid">
        ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => `<div class="cal-dow">${d}</div>`).join("")}
        ${cells.join("")}
      </div>
    </div>
  `;
  $("cal-type").addEventListener("change", (e) => { state.calendar.type = e.target.value; renderCalendar(); });
  $("cal-prev").addEventListener("click", () => shiftMonth(-1));
  $("cal-next").addEventListener("click", () => shiftMonth(1));
  document.querySelectorAll(".day[data-day]").forEach((btn) => {
    btn.addEventListener("click", () => showDay(btn.dataset.day));
  });
}

function calendarHint(type) {
  if (type === "approved") return "When do I need to create the assessment schedule in the portal?";
  if (type === "results") return "When do results need to be shown or submitted?";
  return "Actual assessment dates. Continuous assessments appear as one range.";
}

function shiftMonth(delta) {
  let { year, month } = state.calendar;
  month += delta;
  if (month < 1) { month = 12; year -= 1; }
  if (month > 12) { month = 1; year += 1; }
  state.calendar.year = year;
  state.calendar.month = month;
  renderCalendar();
}

function showDay(iso) {
  const events = state.calendar.payload?.events?.[iso] || [];
  if (!events.length) {
    openModal(`<div class="modal-head"><div><h3>${fmt(iso)}</h3><p class="muted">No events on this date.</p></div><button class="ghost" id="close-modal">Close</button></div>`);
    $("close-modal").onclick = closeModal;
    return;
  }
  const uniqueAssessments = [];
  const models = [];
  events.forEach((event) => {
    if (event.kind === "assessment") {
      if (uniqueAssessments.includes(event.assessment.id)) return;
      uniqueAssessments.push(event.assessment.id);
      models.push(taskCardModel(event, "assessment"));
    } else {
      models.push(taskCardModel(event, event.kind === "approved" ? "schedule" : "results"));
    }
  });
  trackCardModels(models);
  const pendingCount = models.filter((m) => !m.done).length;

  openModal(`
    <div class="modal-head">
      <div><p class="eyebrow">${iso} — ${pendingCount === 0 ? "All done" : `${pendingCount} pending`}</p><h2>${fmt(iso)} — ${models.length} ${models.length === 1 ? "Task" : "Tasks"}</h2></div>
      <button class="ghost" id="close-modal">Close</button>
    </div>
    ${renderTaskCardGroup(models)}
  `);
  $("close-modal").onclick = closeModal;
  bindTaskCards($("modal-card"), async () => {
    await refreshCalendarCounts(iso);
    showDay(iso);
  });
}

// After a task card mutation inside the day modal, refresh just this day's bucket
// from the server (so done/assessor/rep state is current) and patch the month
// grid's pending count for that day, without a full calendar re-render.
async function refreshCalendarCounts(iso) {
  const { type, year, month } = state.calendar;
  const payload = await api(`/api/calendar?type=${type}&year=${year}&month=${month}`);
  state.calendar.payload = payload;
  const info = payload.compact[iso];
  const dayBtn = document.querySelector(`.day[data-day="${iso}"]`);
  const alertEl = dayBtn?.querySelector(".day-alert");
  if (alertEl && info) {
    const allDone = info.pending === 0;
    alertEl.textContent = allDone ? `${info.count} done ✓` : `${info.pending} pending`;
    alertEl.classList.toggle("day-alert-done", allDone);
  }
}

async function renderFinder() {
  const query = state.finder.query;
  const source = state.finder.source || "";
  const tab = state.finder.tab === "centers" ? "centers" : "assessors";
  const picked = state.finder.picked;
  const data = await api(`/api/finder?q=${encodeURIComponent(query)}&qualification=${encodeURIComponent(state.finder.selected)}&source=${encodeURIComponent(source)}`);
  const sourceLabel = source === "region" ? "Region-Based" : source === "province" ? "Province-Based" : "All";

  const qualificationListHtml = data.suggestions.length
    ? data.suggestions.map((q) => `
        <button class="finder-qual-item ${q === data.qualification ? "active" : ""}" data-qual="${escapeHtml(q)}">${escapeHtml(q)}</button>
      `).join("")
    : `<p class="empty">No qualifications match that search.</p>`;

  const assessorsPanel = `
    <div class="segmented">
      <button type="button" class="${source === "" ? "active" : ""}" data-source-filter="">All</button>
      <button type="button" class="${source === "province" ? "active" : ""}" data-source-filter="province">Province-Based</button>
      <button type="button" class="${source === "region" ? "active" : ""}" data-source-filter="region">Region-Based</button>
    </div>
    <div class="finder-result-list">
      ${data.assessors.length ? data.assessors.map((a) => {
        const isPicked = !!picked.assessor && picked.assessor === a.name;
        const detail = [
          a.assessor_type === "region" ? "Region-Based" : "Province-Based",
          a.address || "",
          a.designation || a.company || "",
        ].filter(Boolean).join(" · ");
        return `
          <div class="finder-result-card ${isPicked ? "finder-result-picked" : ""}">
            <div>
              <b>${escapeHtml(a.display_name || a.name)}</b>
              <span class="muted">${escapeHtml(detail)}</span>
            </div>
            <button type="button" class="${isPicked ? "primary" : "ghost"}" data-pick-assessor="${escapeHtml(a.name)}" data-pick-assessor-type="${escapeHtml(a.assessor_type || "province")}">${isPicked ? "Selected ✓" : "Use"}</button>
          </div>
        `;
      }).join("") : `<p class="empty">No ${sourceLabel.toLowerCase()} assessors found for this qualification.</p>`}
    </div>
  `;

  const centersPanel = `
    <div class="finder-result-list">
      ${data.centers.length ? data.centers.map((c) => {
        const isPicked = !!picked.assessment_center && picked.assessment_center === c.name;
        const detail = [c.address || "", c.manager || ""].filter(Boolean).join(" · ");
        return `
          <div class="finder-result-card ${isPicked ? "finder-result-picked" : ""}">
            <div>
              <b>${escapeHtml(c.name)}</b>
              <span class="muted">${escapeHtml(detail)}</span>
            </div>
            <button type="button" class="${isPicked ? "primary" : "ghost"}" data-pick-center="${escapeHtml(c.name)}">${isPicked ? "Selected ✓" : "Use"}</button>
          </div>
        `;
      }).join("") : `<p class="empty">No assessment centers found for this qualification.</p>`}
    </div>
  `;

  $("view-finder").innerHTML = `
    <div class="finder-layout">
      <div class="card finder-sidebar">
        <div class="toolbar">
          <input id="finder-q" placeholder="Search qualification, e.g. Computer" value="${escapeHtml(query)}" />
          ${query || state.finder.selected ? `<button type="button" class="ghost" id="finder-clear">Clear</button>` : ""}
        </div>
        <div class="finder-qual-list">${qualificationListHtml}</div>
      </div>
      <div class="card finder-main">
        ${!data.qualification ? `
          <p class="empty">Search or pick a qualification on the left to see its assessors and assessment centers.</p>
        ` : `
          <div class="finder-main-head">
            <div>
              <h3 style="margin-bottom:2px">${escapeHtml(data.qualification)}</h3>
              <span class="muted">${data.assessor_count} assessor${data.assessor_count === 1 ? "" : "s"} · ${data.center_count} center${data.center_count === 1 ? "" : "s"}</span>
            </div>
            <a class="ghost" style="text-decoration:none" href="/api/finder/export?qualification=${encodeURIComponent(data.qualification)}">Export Assessors to Excel</a>
          </div>
          <div class="selection-bar">
            <div class="selection-bar-item">
              <span class="muted" style="font-size:0.78rem">Center</span>
              <b>${picked.assessment_center ? escapeHtml(picked.assessment_center) : "Not picked yet"}</b>
            </div>
            <div class="selection-bar-item">
              <span class="muted" style="font-size:0.78rem">Assessor</span>
              <b>${picked.assessor ? escapeHtml(picked.assessor) : "Not picked yet"}</b>
            </div>
            <button type="button" class="primary" id="create-from-finder">Create assessment</button>
          </div>
          <div class="segmented" style="margin-top:16px">
            <button type="button" class="${tab === "assessors" ? "active" : ""}" id="finder-tab-assessors">Assessors</button>
            <button type="button" class="${tab === "centers" ? "active" : ""}" id="finder-tab-centers">Assessment Centers</button>
          </div>
          <div style="margin-top:14px">
            ${tab === "assessors" ? assessorsPanel : centersPanel}
          </div>
        `}
      </div>
    </div>
  `;

  const box = $("finder-q");
  box.addEventListener("input", debounce(() => {
    state.finder.query = box.value;
    state.finder.selected = "";
    renderFinder();
  }, 250));
  $("finder-clear")?.addEventListener("click", () => {
    state.finder = { query: "", selected: "", source: state.finder.source, tab: state.finder.tab, picked: { assessment_center: "", assessor: "", assessor_type: "province" } };
    renderFinder();
  });
  document.querySelectorAll("[data-qual]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.finder.selected = btn.dataset.qual;
      // A pick is tied to the qualification it was made under, so switching
      // qualification starts the selection fresh rather than carrying over
      // a center/assessor that may not even serve the new qualification.
      state.finder.picked = { assessment_center: "", assessor: "", assessor_type: "province" };
      renderFinder();
    });
  });
  document.querySelectorAll("[data-source-filter]").forEach((btn) => {
    btn.addEventListener("click", () => { state.finder.source = btn.dataset.sourceFilter; renderFinder(); });
  });
  $("finder-tab-assessors")?.addEventListener("click", () => { state.finder.tab = "assessors"; renderFinder(); });
  $("finder-tab-centers")?.addEventListener("click", () => { state.finder.tab = "centers"; renderFinder(); });
  document.querySelectorAll("[data-pick-center]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.pickCenter;
      state.finder.picked.assessment_center = state.finder.picked.assessment_center === name ? "" : name;
      renderFinder();
    });
  });
  document.querySelectorAll("[data-pick-assessor]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.pickAssessor;
      if (state.finder.picked.assessor === name) {
        state.finder.picked.assessor = "";
        state.finder.picked.assessor_type = "province";
      } else {
        state.finder.picked.assessor = name;
        state.finder.picked.assessor_type = btn.dataset.pickAssessorType || "province";
      }
      renderFinder();
    });
  });
  $("create-from-finder")?.addEventListener("click", () => {
    state.editingId = null;
    const prefillData = { qualification: data.qualification, ...state.finder.picked };
    state.prefill = prefillData;
    switchView("scheduler", { prefill: prefillData });
  });
}

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function daysSinceLabel(days) {
  if (days === null || days === undefined) return "Never assessed";
  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

async function renderHistory() {
  const { qualification, assessor_type } = state.history;
  const tab = state.history.tab === "log" ? "log" : "rotation";
  const params = new URLSearchParams();
  if (qualification) params.set("qualification", qualification);
  if (assessor_type) params.set("assessor_type", assessor_type);
  const data = await api(`/api/assessor-rotation?${params.toString()}`);

  const rotationPanel = !data.qualification ? `
    <p class="empty">Select a qualification above to see its assessor rotation — who's assessed it, when they last did, and who's next in line.</p>
  ` : `
    <p class="hint">Rotation for <b>${escapeHtml(data.qualification)}</b> · sorted so whoever has gone longest without an assignment (or has never been assigned) is listed first. Click a row to see full assessment history.</p>
    ${data.rotation.length ? `<div class="table-wrap desktop-table"><table>
      <thead><tr><th>#</th><th>Assessor</th><th>Type</th><th>Times Assessed</th><th>Last Assessed</th><th>Since</th></tr></thead>
      <tbody>
        ${data.rotation.map((row, i) => `
          <tr class="rotation-row" data-assessor-row="${i}" style="cursor:pointer">
            <td>${i + 1}</td>
            <td><b>${escapeHtml(row.assessor)}</b>${i === 0 ? ` <span class="chip gold">Next up</span>` : ""}</td>
            <td>${escapeHtml(row.assessor_type_label)}</td>
            <td>${row.assessments_conducted}</td>
            <td>${row.last_assessment_date ? escapeHtml(fmt(row.last_assessment_date)) : `<span class="muted">Never</span>`}</td>
            <td>${escapeHtml(daysSinceLabel(row.days_since_last))}</td>
          </tr>
        `).join("")}
      </tbody>
    </table></div>
    <div class="mobile-records">${data.rotation.map((row, i) => `
      <article class="record-card" data-assessor-row="${i}" style="cursor:pointer">
        <h4>${i + 1}. ${escapeHtml(row.assessor)}${i === 0 ? ` <span class="chip gold">Next up</span>` : ""}</h4>
        <div class="record-meta">
          <span class="chip">${escapeHtml(row.assessor_type_label)}</span>
          <span>${row.assessments_conducted} assessment${row.assessments_conducted === 1 ? "" : "s"}</span>
        </div>
        <div class="muted">Last assessed: ${row.last_assessment_date ? fmt(row.last_assessment_date) : "Never"} · ${escapeHtml(daysSinceLabel(row.days_since_last))}</div>
      </article>
    `).join("")}</div>` : `<p class="empty">No assessors found for this qualification.</p>`}
  `;

  const logPanel = `
    <p class="hint">${data.qualification ? `Every recorded assessment for <b>${escapeHtml(data.qualification)}</b>` : "Every recorded assessment across all qualifications"}, most recent first.</p>
    ${data.assessment_log.length ? `<div class="table-wrap desktop-table"><table>
      <thead><tr><th>Date</th>${data.qualification ? "" : "<th>Qualification</th>"}<th>Assessment Center</th><th>Assessor(s)</th><th>Pax</th></tr></thead>
      <tbody>
        ${data.assessment_log.map((item) => `
          <tr class="log-row" data-open-assessment="${item.id}" style="cursor:pointer">
            <td>${escapeHtml(item.date_label)}</td>
            ${data.qualification ? "" : `<td>${escapeHtml(item.qualification)}</td>`}
            <td>${escapeHtml(item.assessment_center)}</td>
            <td>${item.assessors.map((a) => `${escapeHtml(a.name)} <span class="muted">(${a.assessor_type === "region" ? "Region" : "Province"})</span>`).join("<br>")}</td>
            <td>${item.pax}</td>
          </tr>
        `).join("")}
      </tbody>
    </table></div>
    <div class="mobile-records">${data.assessment_log.map((item) => `
      <article class="record-card" data-open-assessment="${item.id}" style="cursor:pointer">
        <h4>${escapeHtml(item.date_label)}</h4>
        <div class="muted">${data.qualification ? "" : `${escapeHtml(item.qualification)} · `}${escapeHtml(item.assessment_center)} · ${item.pax} pax</div>
        <div>${item.assessors.map((a) => `${escapeHtml(a.name)} (${a.assessor_type === "region" ? "Region" : "Province"})`).join(", ")}</div>
      </article>
    `).join("")}</div>` : `<p class="empty">No recorded assessments yet.</p>`}
  `;

  $("view-history").innerHTML = `
    <div class="card">
      <div class="toolbar">
        <label>Qualification</label>
        <select id="hist-qual">
          <option value="">All qualifications</option>
          ${optionList(data.qualifications, data.qualification)}
        </select>
        <label>Assessor Type</label>
        <select id="hist-type">
          <option value="">All types</option>
          <option value="province" ${data.assessor_type === "province" ? "selected" : ""}>Province-Based</option>
          <option value="region" ${data.assessor_type === "region" ? "selected" : ""}>Region-Based</option>
        </select>
        <button class="ghost" id="hist-reset" type="button">Clear filters</button>
      </div>
      <div class="toolbar" style="margin-top:-6px">
        <button class="${tab === "rotation" ? "primary" : "ghost"}" type="button" id="tab-rotation">Rotation Order</button>
        <button class="${tab === "log" ? "primary" : "ghost"}" type="button" id="tab-log">Assessment History</button>
        <a class="ghost" style="text-decoration:none;margin-left:auto" href="/api/assessor-rotation/export?qualification=${encodeURIComponent(data.qualification || "")}&assessor_type=${encodeURIComponent(data.assessor_type || "")}">Export to Excel</a>
      </div>
      ${tab === "rotation" ? rotationPanel : logPanel}
    </div>
  `;

  const applyHistory = () => {
    state.history = {
      qualification: $("hist-qual").value,
      assessor_type: $("hist-type").value,
      tab: state.history.tab,
    };
    renderHistory();
  };
  ["hist-qual", "hist-type"].forEach((id) => {
    $(id).onchange = applyHistory;
  });
  $("hist-reset").onclick = () => {
    state.history = { qualification: "", assessor_type: "", tab: state.history.tab };
    renderHistory();
  };
  $("tab-rotation")?.addEventListener("click", () => { state.history.tab = "rotation"; renderHistory(); });
  $("tab-log")?.addEventListener("click", () => { state.history.tab = "log"; renderHistory(); });
  document.querySelectorAll("[data-assessor-row]").forEach((el) => {
    el.addEventListener("click", () => showAssessorHistory(data.rotation[Number(el.dataset.assessorRow)], data.qualification));
  });
  document.querySelectorAll("[data-open-assessment]").forEach((el) => {
    el.addEventListener("click", () => {
      state.editingId = el.dataset.openAssessment;
      switchView("scheduler");
    });
  });
}

function showAssessorHistory(row, qualification) {
  const historyBlocks = row.history.length ? row.history.map((h) => `
    <div class="event-block">
      <p><b>${escapeHtml(fmt(h.date))}</b>${h.end_date && h.end_date !== h.date ? ` – ${escapeHtml(fmt(h.end_date))}` : ""}</p>
      <p class="muted">${escapeHtml(h.assessment_center)} · ${h.pax} pax</p>
    </div>
  `).join("") : `<p class="empty">No recorded assessments yet — this assessor hasn't been assigned to ${escapeHtml(qualification)}.</p>`;
  openModal(`
    <div class="modal-head">
      <div>
        <p class="eyebrow">${escapeHtml(row.assessor_type_label)} · ${escapeHtml(qualification)}</p>
        <h2>${escapeHtml(row.assessor)}</h2>
        <p class="muted">${row.assessments_conducted} assessment${row.assessments_conducted === 1 ? "" : "s"} on record · Last assessed: ${row.last_assessment_date ? escapeHtml(fmt(row.last_assessment_date)) : "Never"}</p>
      </div>
      <button class="ghost" id="close-modal">Close</button>
    </div>
    ${historyBlocks}
  `);
  $("close-modal").onclick = closeModal;
}

async function renderReps() {
  const people = await api("/api/representatives");
  $("view-reps").innerHTML = `
    <div class="grid split">
      <div class="card">
        <h3>Add / edit representative</h3>
        <form id="rep-form" class="form-grid">
          <input type="hidden" name="id" />
          <div class="field full"><label>Name</label><input name="name" required /></div>
          <div class="field"><label>Position</label><input name="position" /></div>
          <div class="field"><label>Contact</label><input name="contact" /></div>
          <div class="field full"><label>Notes</label><textarea name="notes"></textarea></div>
          <div class="field full row-actions">
            <button class="primary" type="submit">Save representative</button>
            <button class="ghost" type="button" id="rep-reset">Clear</button>
          </div>
        </form>
      </div>
      <div class="card">
        <h3>Existing representatives</h3>
        ${people.length ? people.map((p) => `
          <div class="task">
            <b>${escapeHtml(p.name)}</b>
            <span>${escapeHtml(p.position || "TESDA Representative")} ${p.contact ? "· " + escapeHtml(p.contact) : ""}</span>
            <div class="row-actions" style="margin-top:8px">
              <button class="ghost" data-rep-edit="${p.id}">Edit</button>
              <button class="danger" data-rep-del="${p.id}">Delete</button>
            </div>
          </div>
        `).join("") : `<p class="empty">No representatives yet. Add the people you assign to assessments.</p>`}
      </div>
    </div>
  `;
  const form = $("rep-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = formValues(form);
    try {
      if (payload.id) {
        await api(`/api/representatives/${payload.id}`, { method: "PUT", headers: jsonHeaders(), body: JSON.stringify(payload) });
        toast("Representative updated.");
      } else {
        await api("/api/representatives", { method: "POST", headers: jsonHeaders(), body: JSON.stringify(payload) });
        toast("Representative added.");
      }
      await renderReps();
    } catch (err) {
      toast(err.message, "error");
    }
  });
  $("rep-reset").onclick = () => form.reset();
  document.querySelectorAll("[data-rep-edit]").forEach((btn) => {
    btn.onclick = () => {
      const person = people.find((item) => item.id === btn.dataset.repEdit);
      if (!person) return;
      form.id.value = person.id;
      form.name.value = person.name;
      form.position.value = person.position || "";
      form.contact.value = person.contact || "";
      form.notes.value = person.notes || "";
    };
  });
  document.querySelectorAll("[data-rep-del]").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm("Delete this representative?")) return;
      await api(`/api/representatives/${btn.dataset.repDel}`, { method: "DELETE" });
      await renderReps();
    };
  });
}

async function renderReports() {
  const { year, month, q } = state.report;
  const data = await api(`/api/reports?year=${year}&month=${month}&q=${encodeURIComponent(q)}`);
  $("view-reports").innerHTML = `
    <div class="card">
      <div class="toolbar">
        <select id="rep-month">${monthNames.map((name, i) => `<option value="${i+1}" ${i+1===month?"selected":""}>${name}</option>`).join("")}</select>
        <input id="rep-year" type="number" value="${year}" style="width:110px" />
        <input id="rep-q" placeholder="Search center, qualification, assessor" value="${escapeHtml(q)}" />
        <a class="primary" href="/api/reports/export?year=${year}&month=${month}" style="text-decoration:none">Export This Month</a>
      </div>
      <div class="toolbar" style="margin-top:-6px">
        <label class="muted" style="text-transform:none;letter-spacing:0">Export a range of months:</label>
        <select id="range-start-month">${monthNames.map((name, i) => `<option value="${i + 1}" ${i + 1 === month ? "selected" : ""}>${name}</option>`).join("")}</select>
        <input id="range-start-year" type="number" value="${year}" style="width:90px" />
        <span class="muted">to</span>
        <select id="range-end-month">${monthNames.map((name, i) => `<option value="${i + 1}" ${i + 1 === month ? "selected" : ""}>${name}</option>`).join("")}</select>
        <input id="range-end-year" type="number" value="${year}" style="width:90px" />
        <a class="ghost" id="range-export-link" style="text-decoration:none" href="#">Export Range</a>
      </div>
      <p class="hint">${data.items.length} assessment${data.items.length === 1 ? "" : "s"} in ${monthNames[month-1]} ${year}. Exports use the print-ready Assessment Monitoring layout — a range exports one sheet per month in a single file.</p>
      <div class="table-wrap desktop-table">${assessmentTable(data.items)}</div>
      <div class="mobile-records">${assessmentCards(data.items)}</div>
    </div>
  `;
  const apply = () => {
    state.report.month = Number($("rep-month").value);
    state.report.year = Number($("rep-year").value);
    state.report.q = $("rep-q").value;
    renderReports();
  };
  $("rep-month").onchange = apply;
  $("rep-year").onchange = apply;
  $("rep-q").addEventListener("input", debounce(apply, 250));

  const updateRangeLink = () => {
    const sm = String($("range-start-month").value).padStart(2, "0");
    const sy = $("range-start-year").value;
    const em = String($("range-end-month").value).padStart(2, "0");
    const ey = $("range-end-year").value;
    $("range-export-link").href = `/api/reports/export?start=${sy}-${sm}&end=${ey}-${em}`;
  };
  ["range-start-month", "range-start-year", "range-end-month", "range-end-year"].forEach((id) => {
    $(id).addEventListener("change", updateRangeLink);
  });
  updateRangeLink();

  bindRecordButtons();
}

async function renderSettings() {
  const data = await api("/api/settings");
  $("view-settings").innerHTML = `
    <div class="grid two">
      <div class="card">
        <h3>Excel data sources</h3>
        <p class="hint">The registries are read dynamically. Upload replacements any time, then refresh.</p>
        ${data.error ? `<p class="empty" style="color:var(--danger)">${escapeHtml(data.error)}</p>` : ""}
        <p><b>Schools / Assessment Centers</b><br><span class="muted">${escapeHtml(data.centers_file_name)} · ${data.center_records} rows · ${data.unique_centers} centers</span></p>
        <form class="row-actions" data-upload="centers">
          <input type="file" name="file" accept=".xlsx,.xls" required />
          <button class="ghost">Upload centers file</button>
        </form>
        <p style="margin-top:16px"><b>Province-Based Competency Assessors</b><br><span class="muted">${escapeHtml(data.province_assessors_file_name || data.assessors_file_name)} · ${data.province_assessor_records ?? data.assessor_records} rows · ${data.unique_province_assessors ?? data.unique_assessors} unique</span></p>
        <form class="row-actions" data-upload="province">
          <input type="file" name="file" accept=".xlsx,.xls" required />
          <button class="ghost">Upload province assessors</button>
        </form>
        <p style="margin-top:16px"><b>Region-Based Competency Assessors</b><br><span class="muted">${escapeHtml(data.region_assessors_file_name || "No region file uploaded yet")} · ${data.region_assessor_records || 0} rows · ${data.unique_region_assessors || 0} unique</span></p>
        <form class="row-actions" data-upload="region">
          <input type="file" name="file" accept=".xlsx,.xls" required />
          <button class="ghost">Upload region assessors</button>
        </form>
        <div class="row-actions" style="margin-top:16px">
          <button class="primary" id="reload-excel">Refresh / reload Excel data</button>
        </div>
        <p class="muted" style="margin-top:12px">Last loaded: ${escapeHtml(data.loaded_at || "never")}</p>
      </div>
      <div class="card">
        <h3>Transfer to another computer</h3>
        <p class="hint">Download a backup zip with assessments, TESDA representatives, and the Excel registries. On the other computer, open Settings and import that zip.</p>
        <div class="row-actions">
          <a class="primary" href="/api/backup/export" style="text-decoration:none">Export backup zip</a>
        </div>
        <form id="backup-import" class="row-actions" style="margin-top:14px">
          <input type="file" name="file" accept=".zip" required />
          <button class="ghost" type="submit">Import backup zip</button>
        </form>
      </div>
      <div class="card">
        <h3>UI theme</h3>
        <p class="hint">Choose a preset or set custom colors. Preferences are saved and restored after reload.</p>
        <div class="field">
          <label>Preset</label>
          <select id="theme-preset">
            <option value="default" ${data.theme?.preset === "default" ? "selected" : ""}>Default</option>
            <option value="light" ${data.theme?.preset === "light" ? "selected" : ""}>Light</option>
            <option value="dark" ${data.theme?.preset === "dark" ? "selected" : ""}>Dark</option>
            <option value="custom" ${data.theme?.preset === "custom" ? "selected" : ""}>Custom</option>
          </select>
        </div>
        <div class="theme-grid" style="margin-top:12px">
          ${[["primary","Primary"],["secondary","Secondary / accent"],["background","Background"],["text","Text"],["highlight","Highlight / active"]].map(([key, label]) => `
            <div class="field">
              <label>${label}</label>
              <input type="color" data-theme-color="${key}" value="${escapeHtml(data.theme?.[key] || "#0f766e")}" />
            </div>
          `).join("")}
        </div>
        <div class="row-actions" style="margin-top:16px">
          <button class="primary" id="theme-save" type="button">Save theme</button>
          <button class="ghost" id="theme-reset" type="button">Reset to Default</button>
        </div>
      </div>
      <div class="card">
        <h3>Reminder rules</h3>
        <p>Portal schedule reminder = assessment date minus 2 days. If that lands on a weekend, it's pushed back 2 more days so it always falls on a weekday.</p>
        <p>Exception: a continuous (multi-day) assessment whose range runs into a Saturday or Sunday counts the weekend normally (no push-back) — <i>unless</i> it begins on a Monday or Tuesday, in which case the weekday-only rule still applies.</p>
        <p>Results reminders are generated for every assessment date plus one day.</p>
        <div class="row-actions" style="margin-top:14px">
          <button class="ghost" id="recalc-dates">Recalculate all assessment dates</button>
        </div>
        <p class="muted" style="margin-top:8px">Run this once after a scheduling-rule change — it re-applies the current rules to every existing assessment. New assessments always use the current rules automatically; this only matters for ones created before a rule change.</p>
      </div>
    </div>
  `;
  document.querySelectorAll("[data-upload]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = new FormData(form);
      body.set("kind", form.dataset.upload);
      try {
        const res = await fetch("/api/settings/upload", { method: "POST", body });
        const json = await readJsonResponse(res);
        if (!res.ok || json.ok === false) throw new Error(json.error || "Upload failed");
        toast("Excel file updated and reloaded.");
        await renderSettings();
      } catch (err) {
        toast(err.message, "error");
      }
    });
  });
  $("backup-import")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = new FormData(event.currentTarget);
    if (!confirm("Importing a backup replaces assessments, representatives, and Excel registries on this computer. Continue?")) return;
    try {
      const res = await fetch("/api/backup/import", { method: "POST", body });
      const json = await readJsonResponse(res);
      if (!res.ok || json.ok === false) throw new Error(json.error || "Import failed");
      toast(`Backup imported: ${json.assessments} assessments, ${json.representatives} representatives.`);
      await renderSettings();
    } catch (err) {
      toast(err.message, "error");
    }
  });
  $("reload-excel").onclick = async () => {
    try {
      await api("/api/settings/reload", { method: "POST" });
      toast("Excel data reloaded.");
      await renderSettings();
    } catch (err) {
      toast(err.message, "error");
    }
  };
  $("recalc-dates").onclick = async () => {
    if (!confirm("Recalculate approved/schedule/results dates for every existing assessment using the current rules? This cannot be undone.")) return;
    try {
      const result = await api("/api/assessments/recalculate-dates", { method: "POST" });
      toast(`Recalculated ${result.total} assessments — ${result.changed} had date changes.`);
    } catch (err) {
      toast(err.message, "error");
    }
  };
  applyTheme(data.theme);
  const presets = data.theme_presets || {};
  const collectTheme = () => {
    const theme = {
      preset: $("theme-preset").value,
      primary: document.querySelector('[data-theme-color="primary"]').value,
      secondary: document.querySelector('[data-theme-color="secondary"]').value,
      background: document.querySelector('[data-theme-color="background"]').value,
      text: document.querySelector('[data-theme-color="text"]').value,
      highlight: document.querySelector('[data-theme-color="highlight"]').value,
    };
    return theme;
  };
  $("theme-preset").onchange = () => {
    const preset = $("theme-preset").value;
    const chosen = presets[preset];
    if (chosen) {
      Object.entries(chosen).forEach(([key, value]) => {
        const input = document.querySelector(`[data-theme-color="${key}"]`);
        if (input) input.value = value;
      });
    }
    applyTheme(collectTheme());
  };
  document.querySelectorAll("[data-theme-color]").forEach((input) => {
    input.addEventListener("input", () => {
      $("theme-preset").value = "custom";
      applyTheme(collectTheme());
    });
  });
  $("theme-save").onclick = async () => {
    try {
      const saved = await api("/api/settings/theme", { method: "POST", headers: jsonHeaders(), body: JSON.stringify(collectTheme()) });
      applyTheme(saved.theme);
      toast("Theme saved.");
    } catch (err) {
      toast(err.message, "error");
    }
  };
  $("theme-reset").onclick = async () => {
    try {
      const saved = await api("/api/settings/theme/reset", { method: "POST" });
      applyTheme(saved.theme);
      toast("Theme reset to default.");
      await renderSettings();
    } catch (err) {
      toast(err.message, "error");
    }
  };
}

function maybeNotify(data) {
  const key = `notified-${data.today}`;
  if (sessionStorage.getItem(key)) return;
  const messages = [
    ...data.schedule_today.map((item) => `Schedule reminder: create the portal schedule for the assessment on ${fmt(item.assessment_date)}. ${item.assessment.assessment_center} · ${item.assessment.qualification}`),
    ...data.results_today.map((item) => `Results reminder: show/submit results for the assessment conducted on ${fmt(item.assessment_date)}. ${item.assessment.assessment_center} · ${item.assessment.qualification}`),
  ];
  if (!messages.length) return;
  sessionStorage.setItem(key, "1");
  messages.forEach((text) => {
    toast(text);
    if (Notification.permission === "granted") new Notification("TESDA Assessment Scheduler", { body: text });
  });
}

function tickClock() {
  const now = new Date();
  $("clock-value").textContent = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

document.querySelectorAll(".nav button").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});
$("new-assessment-btn").addEventListener("click", () => {
  state.editingId = null;
  state.prefill = null;
  switchView("scheduler");
});
$("notify-btn").addEventListener("click", async () => {
  if (!("Notification" in window)) {
    toast("Desktop notifications are not available in this browser.", "error");
    return;
  }
  const permission = await Notification.requestPermission();
  toast(permission === "granted" ? "Desktop alerts enabled." : "Notifications were not enabled.");
});
$("modal").addEventListener("click", (event) => {
  if (event.target.id === "modal") closeModal();
});

$("menu-toggle")?.addEventListener("click", () => {
  $("rail")?.classList.toggle("collapsed");
});
$("rail")?.classList.add("collapsed");
tickClock();
setInterval(tickClock, 60_000);

(async function boot() {
  try {
    const settings = await api("/api/settings");
    applyTheme(settings.theme);
    if (settings.mirror_mode) showMirrorBanner();
  } catch {}
  switchView("dashboard");
})();

function showMirrorBanner() {
  const bar = document.createElement("div");
  bar.id = "mirror-banner";
  bar.style.cssText = "position:sticky;top:0;z-index:25;background:#7c2d12;color:#fff;padding:10px 16px;font-size:0.85rem;text-align:center;";
  bar.innerHTML = "⚠️ This is a <b>read-only mirror</b>. Anything entered here (new assessments, checklist ticks, Excel uploads) will be lost on the next deploy. Make changes in the app running on your computer and push to GitHub instead.";
  document.body.prepend(bar);
}
