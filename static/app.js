const state = {
  view: "dashboard",
  centers: [],
  representatives: [],
  assessments: [],
  calendar: { type: "approved", year: new Date().getFullYear(), month: new Date().getMonth() + 1, payload: null },
  finder: { query: "", selected: "", source: "province", picked: null },
  report: { year: new Date().getFullYear(), month: new Date().getMonth() + 1, q: "" },
  history: { qualification: "", assessor_type: "province", tab: "log" },
  schedulerPage: 1,
  reportPage: 1,
  theme: null,
  editingId: null,
  prefill: null,
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

const PAGE_SIZE = 10;

function paginate(items, page) {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  return { pageItems: items.slice(start, start + PAGE_SIZE), page: safePage, totalPages };
}

function bindPaginationControls(containerId, onPrev, onNext) {
  const container = $(containerId);
  if (!container) return;
  const prev = container.querySelector("[data-page-prev]");
  const next = container.querySelector("[data-page-next]");
  if (prev && !prev.disabled) prev.addEventListener("click", onPrev);
  if (next && !next.disabled) next.addEventListener("click", onNext);
}

function paginationControls(idPrefix, page, totalPages, total) {
  if (total <= PAGE_SIZE) return "";
  return `
    <div class="pagination" data-pagination="${idPrefix}">
      <span class="muted">Page ${page} of ${totalPages} · ${total} total</span>
      <div class="row-actions">
        <button type="button" class="ghost" data-page-prev ${page <= 1 ? "disabled" : ""}>Previous</button>
        <button type="button" class="ghost" data-page-next ${page >= totalPages ? "disabled" : ""}>Next</button>
      </div>
    </div>
  `;
}

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
  if (type === "continuous") return "Continuous";
  if (type === "multiple") return "Multiple Days (Non-Continuous)";
  return "Single Day";
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

function applyBranding(branding) {
  if (!branding) return;
  state.branding = branding;
  const mark = $("brand-mark");
  if (mark) {
    mark.innerHTML = branding.logo_url
      ? `<img src="${escapeHtml(branding.logo_url)}" alt="Logo" />`
      : escapeHtml(branding.initials || "TL");
    mark.classList.toggle("has-image", Boolean(branding.logo_url));
  }
  if ($("brand-kicker")) $("brand-kicker").textContent = branding.kicker || "";
  if ($("brand-title")) $("brand-title").textContent = branding.title || "";
  if ($("brand-sub")) $("brand-sub").textContent = branding.sub || "";
  document.title = branding.title ? `${branding.title} · Assessment Scheduler` : "Assessment Scheduler";
}

async function refreshLookups() {
  state.centers = await api("/api/centers");
  state.representatives = await api("/api/representatives");
  state.assessments = await api("/api/assessments");
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

function taskChecklist(items, kind) {
  if (!items.length) return `<p class="empty">Nothing due in this group.</p>`;
  return items.map((item) => {
    const a = item.assessment || item;
    const detail = kind === "schedule"
      ? `Create portal schedule for ${fmt(item.assessment_date)}`
      : kind === "results"
        ? `Submit results for ${fmt(item.assessment_date)}`
        : a.date_label;
    return `<div class="task ${item.done ? "task-done" : ""}">
      <label class="task-check">
        <input type="checkbox" data-dash-task-id="${escapeHtml(item.task_id)}" ${item.done ? "checked" : ""} />
        <b>${escapeHtml(detail)}</b>
      </label>
      <span>${escapeHtml(a.assessment_center)} · ${escapeHtml(a.qualification)}</span>
    </div>`;
  }).join("");
}

async function renderDashboard() {
  const data = await api("/api/dashboard");

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
        <p class="hint">Portal schedule reminders and results due ${fmt(data.today)}. Check them off once done.</p>
        ${taskChecklist(data.schedule_today, "schedule")}
        ${taskChecklist(data.results_today, "results")}
      </div>
      <div class="card">
        <h3>Today's assessments</h3>
        ${taskChecklist(data.assessments_today, "assessment")}
        <h3 style="margin-top:18px">Upcoming</h3>
        ${taskChecklist(data.upcoming, "assessment")}
      </div>
    </div>
  `;
  document.querySelectorAll("[data-dash-task-id]").forEach((box) => {
    box.addEventListener("change", async () => {
      const taskIdValue = box.dataset.dashTaskId;
      const wasChecked = box.checked;
      try {
        await api("/api/tasks/toggle", { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ task_id: taskIdValue, done: wasChecked }) });
      } catch (err) {
        toast(err.message, "error");
        box.checked = !wasChecked;
        return;
      }
      toast(wasChecked ? "Marked as done." : "Marked as not done.");
      renderDashboard();
    });
  });
  maybeNotify(data);
}

function fmt(iso) {
  if (!iso) return "—";
  let d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) d = new Date(iso);
  // Some Excel sheets store these as free text rather than real dates (e.g. "Lifetime",
  // a non-ISO format). When it genuinely can't be parsed, show the original text instead
  // of a useless "Invalid Date".
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

// --- Date math mirroring date_rules.py, used to preview/edit the Approved
// (portal schedule) dates client-side before the record is saved. ---
function parseLocalDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function addDays(date, delta) {
  const d = new Date(date);
  d.setDate(d.getDate() + delta);
  return d;
}
function isWeekendDate(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}
function previousBusinessDay(date) {
  let c = addDays(date, -1);
  while (isWeekendDate(c)) c = addDays(c, -1);
  return c;
}
function scheduleReminderDate(date) {
  // Always minus 2 business days (weekends skipped), per assessment date — matches
  // date_rules.py's schedule_reminder_for_assessment_date for both single and continuous.
  let r = date;
  for (let i = 0; i < 2; i++) r = previousBusinessDay(r);
  return r;
}
function assessmentDateRange(startIso, endIso) {
  const start = parseLocalDate(startIso);
  const end = parseLocalDate(endIso || startIso);
  const dates = [];
  let cur = start;
  while (cur <= end) {
    dates.push(toISODate(cur));
    cur = addDays(cur, 1);
  }
  return dates;
}
function calculatedApprovedDates(startIso, endIso, durationType, explicitDates) {
  let assessmentDates;
  if (durationType === "multiple") {
    assessmentDates = (explicitDates || []).filter(Boolean).slice().sort();
  } else if (durationType === "continuous" && endIso) {
    assessmentDates = startIso ? assessmentDateRange(startIso, endIso) : [];
  } else {
    assessmentDates = startIso ? [startIso] : [];
  }
  if (!assessmentDates.length) return [];
  return assessmentDates.map((iso) => ({
    assessment_date: iso,
    date: toISODate(scheduleReminderDate(parseLocalDate(iso))),
  }));
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
    duration_type: prefill.duration_type || "continuous",
    start_date: prefill.start_date || "",
    end_date: prefill.end_date || "",
    pax: prefill.pax || "",
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
    custom: Boolean(row.custom),
  }));

  const quals = current.assessment_center
    ? (state.centers.find((c) => c.name === current.assessment_center)?.qualifications || [])
    : [];
  const qualQuery = current.qualification ? `&qualification=${encodeURIComponent(current.qualification)}` : "";
  const [provinceAssessors, regionAssessors] = await Promise.all([
    api(`/api/assessors?source=province${qualQuery}`),
    api(`/api/assessors?source=region${qualQuery}`),
  ]);
  const assessorsBySource = { province: provinceAssessors, region: regionAssessors };

  // A saved assessor whose name isn't in the loaded registry (e.g. a previously entered
  // custom name, or one typed before the Excel file was refreshed) should still show as
  // free text instead of silently resetting to blank.
  assessorRows = assessorRows.map((row) => {
    if (!row.assessor || row.custom) return row;
    const list = assessorsBySource[row.assessor_type]?.assessors || [];
    const found = list.some((entry) => (typeof entry === "string" ? entry : entry.name) === row.assessor);
    return found ? row : { ...row, custom: true };
  });

  function assessorRowsHtml() {
    return assessorRows.map((row, index) => {
      const list = assessorsBySource[row.assessor_type].assessors;
      const nameSlot = row.custom
        ? `
          <div class="assessor-custom-wrap">
            <input type="text" class="assessor-custom-input" data-index="${index}" placeholder="Type assessor name" value="${escapeHtml(row.assessor)}" />
            <button type="button" class="linkish assessor-use-list" data-index="${index}">Use list</button>
          </div>
        `
        : `
          <select class="assessor-name-input" data-index="${index}">
            <option value="">Select assessor</option>
            ${optionList(list, row.assessor)}
            <option value="__custom__">+ Enter custom name…</option>
          </select>
        `;
      return `
        <div class="assessor-row">
          <span class="assessor-num">${index + 1}</span>
          <select class="assessor-type-input" data-index="${index}">
            <option value="province" ${row.assessor_type === "province" ? "selected" : ""}>Province-Based</option>
            <option value="region" ${row.assessor_type === "region" ? "selected" : ""}>Region-Based</option>
          </select>
          <div class="assessor-name-slot">${nameSlot}</div>
          <button type="button" class="ghost assessor-remove" data-index="${index}" ${assessorRows.length <= 1 ? "disabled" : ""}>Remove</button>
        </div>
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
        assessorRows[idx] = { assessor_type: sel.value, assessor: "", custom: false };
        redrawAssessorRows();
      });
    });
    document.querySelectorAll(".assessor-name-input").forEach((sel) => {
      sel.addEventListener("change", () => {
        const idx = Number(sel.dataset.index);
        if (sel.value === "__custom__") {
          assessorRows[idx] = { ...assessorRows[idx], assessor: "", custom: true };
          redrawAssessorRows();
          document.querySelector(`.assessor-custom-input[data-index="${idx}"]`)?.focus();
          return;
        }
        assessorRows[idx].assessor = sel.value;
      });
    });
    document.querySelectorAll(".assessor-custom-input").forEach((input) => {
      input.addEventListener("input", () => {
        const idx = Number(input.dataset.index);
        assessorRows[idx].assessor = input.value;
      });
    });
    document.querySelectorAll(".assessor-use-list").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.index);
        assessorRows[idx] = { ...assessorRows[idx], assessor: "", custom: false };
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

  // Non-continuous assessment dates (duration type "multiple"): an explicit, hand-picked
  // list of individual dates, e.g. 28, 30, 31 while skipping 29.
  let multiDates;
  if (prefill.assessment_dates && prefill.assessment_dates.length && prefill.duration_type === "multiple") {
    multiDates = prefill.assessment_dates.slice();
  } else if (editing && editing.duration_type === "multiple" && editing.assessment_dates && editing.assessment_dates.length) {
    multiDates = editing.assessment_dates.slice();
  } else {
    multiDates = [current.start_date || ""];
  }

  function multiDateRowsHtml() {
    return `<div class="multi-date-list">${multiDates.map((d, index) => `
      <div class="multi-date-row">
        <span class="assessor-num">${index + 1}</span>
        <input type="date" class="multi-date-input" data-index="${index}" value="${d || ""}" />
        <button type="button" class="ghost multi-date-remove" data-index="${index}" ${multiDates.length <= 1 ? "disabled" : ""}>Remove</button>
      </div>
    `).join("")}</div>`;
  }

  function redrawMultiDateRows() {
    $("multi-date-rows").innerHTML = multiDateRowsHtml();
    bindMultiDateRowEvents();
  }

  function bindMultiDateRowEvents() {
    document.querySelectorAll(".multi-date-input").forEach((input) => {
      input.addEventListener("change", () => {
        const idx = Number(input.dataset.index);
        multiDates[idx] = input.value;
        recomputeApprovedRows();
        redrawApprovedRows();
      });
    });
    document.querySelectorAll(".multi-date-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.index);
        if (multiDates.length <= 1) return;
        multiDates.splice(idx, 1);
        redrawMultiDateRows();
        recomputeApprovedRows();
        redrawApprovedRows();
      });
    });
  }

  // Approved (portal schedule) dates: auto-calculated from the assessment date(s), but each
  // one can optionally be edited by hand — e.g. the portal actually opened a different date.
  function currentFormDates() {
    const startInput = document.querySelector('input[name="start_date"]');
    const endInput = document.querySelector('input[name="end_date"]');
    const durationInput = document.querySelector('input[name="duration_type"]:checked');
    const durationType = durationInput ? durationInput.value : current.duration_type;
    return {
      start: startInput ? startInput.value : current.start_date,
      end: endInput ? endInput.value : current.end_date,
      durationType,
      multiDates: durationType === "multiple" ? multiDates.filter(Boolean) : [],
    };
  }

  let approvedRows;
  if (prefill.approved_dates && prefill.approved_dates.length) {
    approvedRows = prefill.approved_dates.map((row) => ({ ...row, manual: Boolean(row.manual) }));
  } else if (editing && editing.approved_dates && editing.approved_dates.length) {
    approvedRows = editing.approved_dates.map((row) => ({
      assessment_date: row.assessment_date,
      date: row.date,
      manual: Boolean(row.manual),
    }));
  } else {
    approvedRows = calculatedApprovedDates(current.start_date, current.end_date, current.duration_type, multiDates).map((row) => ({ ...row, manual: false }));
  }

  function recomputeApprovedRows() {
    const { start, end, durationType, multiDates: md } = currentFormDates();
    const autoRows = calculatedApprovedDates(start, end, durationType, md);
    approvedRows = autoRows.map((auto) => {
      const prev = approvedRows.find((row) => row.assessment_date === auto.assessment_date);
      if (prev && prev.manual) return { ...auto, date: prev.date, manual: true };
      return { ...auto, manual: false };
    });
  }

  function approvedRowsHtml() {
    if (!approvedRows.length) {
      return `<p class="hint">Pick an assessment date above to see the auto-calculated portal schedule date.</p>`;
    }
    return `<div class="approved-date-list">${approvedRows.map((row, index) => `
      <div class="approved-date-row">
        <span class="approved-date-label">${escapeHtml(fmt(row.assessment_date))}</span>
        <input type="date" class="approved-date-input" data-index="${index}" value="${row.date}" />
        ${row.manual
          ? `<span class="chip gold">Edited</span><button type="button" class="linkish approved-date-reset" data-index="${index}">Reset to auto</button>`
          : `<span class="muted">Auto-calculated</span>`}
      </div>
    `).join("")}</div>`;
  }

  function redrawApprovedRows() {
    $("approved-date-rows").innerHTML = approvedRowsHtml();
    bindApprovedRowEvents();
  }

  function bindApprovedRowEvents() {
    document.querySelectorAll(".approved-date-input").forEach((input) => {
      input.addEventListener("change", () => {
        const idx = Number(input.dataset.index);
        const { start, end, durationType, multiDates: md } = currentFormDates();
        const auto = calculatedApprovedDates(start, end, durationType, md)[idx];
        approvedRows[idx] = { ...approvedRows[idx], date: input.value, manual: !auto || input.value !== auto.date };
        redrawApprovedRows();
      });
    });
    document.querySelectorAll(".approved-date-reset").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.index);
        const { start, end, durationType, multiDates: md } = currentFormDates();
        const auto = calculatedApprovedDates(start, end, durationType, md)[idx];
        if (auto) approvedRows[idx] = { ...auto, manual: false };
        redrawApprovedRows();
      });
    });
  }

  state.schedulerSearch = state.schedulerSearch || "";
  state.schedulerTab = state.schedulerTab || "entry";
  state.schedulerPage = state.schedulerPage || 1;
  const tab = state.schedulerTab;
  const filteredRecords = filterAssessments(state.assessments, state.schedulerSearch);
  const recordsPaged = paginate(filteredRecords, state.schedulerPage);
  state.schedulerPage = recordsPaged.page;

  $("view-scheduler").innerHTML = `
    <div class="scheduler-layout">
      <div class="pill-tabs" role="tablist">
        <button type="button" class="tab-btn ${tab === "entry" ? "active" : ""}" data-tab="entry">${editing ? "Edit Entry" : "Assessment Entry"}</button>
        <button type="button" class="tab-btn ${tab === "records" ? "active" : ""}" data-tab="records">Records <span class="tab-count">${state.assessments.length}</span></button>
      </div>
      <div class="scheduler-panel" data-panel="entry" ${tab === "entry" ? "" : "hidden"}>
      <div class="card scheduler-form">
        <div class="scheduler-form-head">
          <p class="eyebrow-tag">${editing ? "Editing record" : "New record"}</p>
          <h3>${editing ? "Edit assessment" : "Assessment entry"}</h3>
          <p>Approved, schedule, and results dates are calculated automatically.</p>
        </div>
        <div class="scheduler-form-body">
        <form id="assessment-form" class="sched-grid">
          <p class="sched-section-label field full">Where &amp; what</p>
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

          <p class="sched-section-label field full">Schedule</p>
          <div class="field full">
            <label>Assessment Duration</label>
            <div class="duration-toggle duration-toggle-3">
              <input type="radio" id="duration-single" name="duration_type" value="single" ${current.duration_type === "single" ? "checked" : ""} />
              <label for="duration-single">Single Day</label>
              <input type="radio" id="duration-multiple" name="duration_type" value="multiple" ${current.duration_type === "multiple" ? "checked" : ""} />
              <label for="duration-multiple">Multiple (Skip Days)</label>
              <input type="radio" id="duration-continuous" name="duration_type" value="continuous" ${current.duration_type === "continuous" ? "checked" : ""} />
              <label for="duration-continuous">Continuous</label>
            </div>
          </div>
          <div class="field">
            <label>Number of Pax</label>
            <input type="number" min="1" name="pax" value="${escapeHtml(current.pax)}" required />
          </div>
          <div class="field" id="start-wrap" style="${current.duration_type === "multiple" ? "display:none" : ""}">
            <label id="start-label">${current.duration_type === "continuous" ? "Start Date" : "Assessment Date"}</label>
            <input type="date" name="start_date" value="${current.start_date || ""}" ${current.duration_type === "multiple" ? "" : "required"} />
          </div>
          <div class="field" id="end-wrap" style="${current.duration_type === "continuous" ? "" : "display:none"}">
            <label>End Date</label>
            <input type="date" name="end_date" value="${current.end_date || ""}" />
          </div>
          <div class="field full" id="multi-dates-wrap" style="${current.duration_type === "multiple" ? "" : "display:none"}">
            <label>Assessment Dates</label>
            <div id="multi-date-rows">${multiDateRowsHtml()}</div>
            <button type="button" class="ghost" id="add-multi-date">+ Add date</button>
            <p class="hint">Pick each day individually for a non-continuous schedule — e.g. 28, 30, 31, skipping 29.</p>
          </div>
          <div class="field full">
            <label>Approved / Portal Schedule Date${approvedRows.length === 1 ? "" : "(s)"}</label>
            <div id="approved-date-rows">${approvedRowsHtml()}</div>
            <p class="hint">Auto-calculated from the assessment date, but you can edit any date by hand if the portal schedule ended up different.</p>
          </div>

          <p class="sched-section-label field full">People</p>
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
            <textarea name="remarks" placeholder="Optional notes about this assessment">${escapeHtml(current.remarks || "")}</textarea>
          </div>

          <div class="field full row-actions">
            <button class="primary" type="submit">${editing ? "Update record" : "Save assessment"}</button>
            ${editing ? `<button class="ghost" type="button" id="cancel-edit">Cancel</button>` : ""}
          </div>
        </form>
        </div>
      </div>
      </div>
      <div class="scheduler-panel" data-panel="records" ${tab === "records" ? "" : "hidden"}>
      <div class="card scheduler-records">
        <div class="records-head">
          <h3>Assessment records <span class="records-count">· ${state.assessments.length} total</span></h3>
          <div class="records-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <input type="search" id="scheduler-search" placeholder="Search center, qualification, assessor, rep" value="${escapeHtml(state.schedulerSearch)}" />
          </div>
        </div>
        <div id="scheduler-record-list">${assessmentCards(recordsPaged.pageItems, state.schedulerSearch ? "No assessments match your search." : "No assessments yet.")}</div>
        <div id="scheduler-record-pagination">${paginationControls("scheduler", recordsPaged.page, recordsPaged.totalPages, filteredRecords.length)}</div>
      </div>
      </div>
    </div>
  `;

  document.querySelectorAll(".pill-tabs .tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.schedulerTab = btn.dataset.tab;
      renderScheduler({ prefill: state.prefill, assessment: editing });
    });
  });

  bindAssessorRowEvents();
  $("add-assessor").addEventListener("click", () => {
    assessorRows.push({ assessor_type: "province", assessor: "" });
    redrawAssessorRows();
  });
  bindApprovedRowEvents();
  bindMultiDateRowEvents();
  $("add-multi-date").addEventListener("click", () => {
    multiDates.push("");
    redrawMultiDateRows();
    recomputeApprovedRows();
    redrawApprovedRows();
  });

  function refreshSchedulerRecords() {
    const filtered = filterAssessments(state.assessments, state.schedulerSearch);
    const paged = paginate(filtered, state.schedulerPage);
    state.schedulerPage = paged.page;
    $("scheduler-record-list").innerHTML = assessmentCards(paged.pageItems, state.schedulerSearch ? "No assessments match your search." : "No assessments yet.");
    $("scheduler-record-pagination").innerHTML = paginationControls("scheduler", paged.page, paged.totalPages, filtered.length);
    bindRecordButtons();
    bindPaginationControls(
      "scheduler-record-pagination",
      () => { state.schedulerPage -= 1; refreshSchedulerRecords(); },
      () => { state.schedulerPage += 1; refreshSchedulerRecords(); }
    );
  }

  $("scheduler-search").addEventListener("input", (event) => {
    state.schedulerSearch = event.target.value;
    state.schedulerPage = 1;
    refreshSchedulerRecords();
  });
  refreshSchedulerRecords();

  const form = $("assessment-form");
  const endWrap = $("end-wrap");
  const startWrap = $("start-wrap");
  const multiDatesWrap = $("multi-dates-wrap");
  form.querySelectorAll('input[name="duration_type"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      const type = input.value;
      endWrap.style.display = type === "continuous" ? "" : "none";
      multiDatesWrap.style.display = type === "multiple" ? "" : "none";
      startWrap.style.display = type === "multiple" ? "none" : "";
      if (type === "multiple") {
        form.start_date.removeAttribute("required");
      } else {
        form.start_date.setAttribute("required", "required");
      }
      $("start-label").textContent = type === "continuous" ? "Start Date" : "Assessment Date";
      recomputeApprovedRows();
      redrawApprovedRows();
    });
  });
  form.start_date.addEventListener("change", () => {
    recomputeApprovedRows();
    redrawApprovedRows();
  });
  form.end_date.addEventListener("change", () => {
    recomputeApprovedRows();
    redrawApprovedRows();
  });
  form.assessment_center.addEventListener("change", async () => {
    state.prefill = { ...formValues(form), assessors: assessorRows.slice(), approved_dates: approvedRows.slice(), assessment_dates: multiDates.slice() };
    state.prefill.qualification = "";
    await renderScheduler({ prefill: state.prefill, assessment: editing });
  });
  form.qualification.addEventListener("change", async () => {
    state.prefill = { ...formValues(form), assessors: assessorRows.slice(), approved_dates: approvedRows.slice(), assessment_dates: multiDates.slice() };
    await renderScheduler({ prefill: state.prefill, assessment: editing });
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = formValues(form);
    payload.pax = Number(payload.pax);
    if (payload.duration_type === "single") payload.end_date = payload.start_date;
    if (payload.duration_type === "multiple") {
      const dates = multiDates.filter(Boolean);
      if (!dates.length) {
        toast("Add at least one assessment date.", "error");
        return;
      }
      payload.assessment_dates = dates;
      payload.start_date = dates.slice().sort()[0];
      payload.end_date = dates.slice().sort().slice(-1)[0];
    }
    payload.assessors = assessorRows
      .filter((row) => row.assessor)
      .map((row) => ({ name: row.assessor, assessor_type: row.assessor_type }));
    if (!payload.assessors.length) {
      toast("Add at least one assessor.", "error");
      return;
    }
    payload.approved_dates = approvedRows.map((row) => ({ assessment_date: row.assessment_date, date: row.date }));
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
      state.schedulerTab = "records";
      await renderScheduler();
    } catch (err) {
      toast(err.message, "error");
    }
  });
  $("cancel-edit")?.addEventListener("click", () => {
    state.editingId = null;
    state.prefill = null;
    state.schedulerTab = "records";
    renderScheduler();
  });
  bindRecordButtons();
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function jsonHeaders() {
  return { "Content-Type": "application/json" };
}

function itemAssessors(item) {
  return item.assessors && item.assessors.length
    ? item.assessors
    : [{ name: item.assessor, assessor_type: item.assessor_type }];
}

function assessorChipLabel(item) {
  const list = itemAssessors(item);
  if (list.length > 1) return `${list.length} Assessors`;
  return list[0].assessor_type === "region" ? "Region-Based" : "Province-Based";
}

function assessorsSummary(item) {
  return itemAssessors(item)
    .map((a) => `${a.name} (${a.assessor_type === "region" ? "Region-Based" : "Province-Based"})`)
    .join("; ");
}

function filterAssessments(items, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    const haystack = [
      item.assessment_center,
      item.qualification,
      item.tesda_representative,
      item.remarks,
      assessorsSummary(item),
    ].join(" ").toLowerCase();
    return haystack.includes(q);
  });
}

function assessmentCards(items, emptyMessage) {
  if (!items.length) return `<p class="empty">${escapeHtml(emptyMessage || "No assessments yet.")}</p>`;
  return `<div class="assessment-list">${items.map((item) => `
    <article class="assessment-card ${item.duration_type === "single" ? "is-single" : ""}">
      <div class="assessment-card-top">
        <div class="assessment-card-id">
          <h4>${escapeHtml(item.assessment_center)}</h4>
          <p>${escapeHtml(item.qualification)}</p>
        </div>
        <div class="assessment-card-date">${escapeHtml(item.date_label)}</div>
      </div>
      <div class="assessment-card-badges">
        <span class="chip">${escapeHtml(durationLabel(item.duration_type))}</span>
        <span class="chip gold">${escapeHtml(assessorChipLabel(item))}</span>
        <span class="chip">${item.pax} pax</span>
      </div>
      <div class="assessment-card-divider"></div>
      <dl class="assessment-card-grid">
        <div class="span-2">
          <dt>Assessors</dt>
          <dd>${escapeHtml(assessorsSummary(item))}</dd>
        </div>
        <div>
          <dt>TESDA Representative</dt>
          <dd>${escapeHtml(item.tesda_representative || "None")}</dd>
        </div>
        ${item.remarks ? `
        <div class="span-2">
          <dt>Remarks</dt>
          <dd>${escapeHtml(item.remarks)}</dd>
        </div>` : ""}
      </dl>
      <div class="assessment-card-foot">
        <div class="assessment-card-dates">
          <span>Approved: <b>${escapeHtml(item.approved_date_list.map(fmt).join("; ") || "—")}</b>${(item.approved_dates || []).some((p) => p.manual) ? ` <span class="chip gold">Edited</span>` : ""}</span>
          <span>Results: <b>${escapeHtml(item.results_reminder_list.map(fmt).join("; ") || "—")}</b></span>
        </div>
        <div class="row-actions">
          <button class="ghost" data-edit="${item.id}">Edit</button>
          <button class="danger" data-delete="${item.id}">Delete</button>
        </div>
      </div>
    </article>
  `).join("")}</div>`;
}

function assessmentTable(items) {
  if (!items.length) return `<p class="empty">No assessments yet.</p>`;
  return `<table>
    <thead><tr>
      <th>Center / Qualification</th><th>Dates</th><th>People</th><th>Calculated dates</th><th>Remarks</th><th></th>
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
          <td class="muted">${escapeHtml(item.remarks || "—")}</td>
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
      state.schedulerTab = "entry";
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
  const pendingCount = events.filter((e) => !e.done).length;
  const blocks = events.map((event) => {
    if (event.kind === "assessment" && uniqueAssessments.includes(event.assessment.id)) return "";
    if (event.kind === "assessment") uniqueAssessments.push(event.assessment.id);
    const icon = event.kind === "approved" ? "Approved Date" : event.kind === "results" ? "Results Reminder" : "Assessment";
    const a = event.assessment;
    return `<div class="event-block ${event.done ? "event-done" : ""}">
      <label class="task-check">
        <input type="checkbox" data-task-id="${escapeHtml(event.task_id)}" ${event.done ? "checked" : ""} />
        <span class="chip ${event.kind === "results" ? "rose" : event.kind === "assessment" ? "gold" : ""}">${icon}</span>
        ${event.done ? `<span class="chip" style="background:rgba(74,222,128,0.15);color:var(--ok)">Done</span>` : ""}
      </label>
      <h3 style="margin-top:8px">${escapeHtml(event.title)}</h3>
      <p>${escapeHtml(event.detail)}</p>
      <p class="muted">${escapeHtml(a.assessment_center)} · ${escapeHtml(a.qualification)} · ${escapeHtml(a.date_label)}</p>
      <button class="ghost" data-open="${a.id}">View / edit assessment</button>
    </div>`;
  }).join("");
  openModal(`
    <div class="modal-head">
      <div><p class="eyebrow">${iso} — ${pendingCount === 0 ? "All done" : `${pendingCount} pending`}</p><h2>${fmt(iso)} — ${events.length} ${events.length === 1 ? "Task" : "Tasks"}</h2></div>
      <button class="ghost" id="close-modal">Close</button>
    </div>
    ${blocks}
  `);
  $("close-modal").onclick = closeModal;
  document.querySelectorAll("[data-task-id]").forEach((box) => {
    box.addEventListener("change", () => toggleTask(box.dataset.taskId, box.checked, iso));
  });
  document.querySelectorAll("[data-open]").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeModal();
      state.editingId = btn.dataset.open;
      state.schedulerTab = "entry";
      switchView("scheduler");
    });
  });
}

async function toggleTask(taskId, done, iso) {
  try {
    await api("/api/tasks/toggle", { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ task_id: taskId, done }) });
  } catch (err) {
    toast(err.message, "error");
    return;
  }
  const events = state.calendar.payload?.events?.[iso] || [];
  events.forEach((ev) => { if (ev.task_id === taskId) ev.done = done; });
  const compact = state.calendar.payload?.compact?.[iso];
  const pending = events.filter((ev) => !ev.done).length;
  if (compact) compact.pending = pending;
  const dayBtn = document.querySelector(`.day[data-day="${iso}"]`);
  const alertEl = dayBtn?.querySelector(".day-alert");
  if (alertEl) {
    alertEl.textContent = pending === 0 ? `${events.length} done ✓` : `${pending} pending`;
    alertEl.classList.toggle("day-alert-done", pending === 0);
  }
  toast(done ? "Marked as done." : "Marked as not done.");
  showDay(iso);
}

// Full detail card for a Finder assessor — every field the Excel sheet carries for them,
// not just a name and a "Use assessor" button.
function finderAssessorKey(a) {
  return `${a.assessor_type || "province"}:${a.identity_key || a.name}`;
}

function titleCaseLabel(header) {
  return String(header || "")
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bNo\.?\b/i, "No.");
}

function isIsoDateLike(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function finderAssessorCardHtml(a, picked, expanded) {
  const assessorType = a.assessor_type || "province";
  const isPicked = picked.assessor === a.name && picked.assessor_type === assessorType;
  const key = finderAssessorKey(a);
  const isExpanded = Boolean(expanded[key]);
  // Show every column exactly as it appears in the source Excel file — not just a
  // curated subset — in the file's own column order, so nothing the sheet carries
  // (expiry dates, a code #, or any other field) is ever left out.
  const details = (a.raw_fields || [])
    .map(([header, value]) => [titleCaseLabel(header), isIsoDateLike(value) ? fmt(value) : value])
    .filter(([, value]) => value);
  const summary = [a.designation, a.company].filter(Boolean).join(" · ");
  return `
    <div class="task finder-assessor-card ${isPicked ? "task-picked" : ""}">
      <div class="finder-assessor-head">
        <div class="finder-assessor-name">
          <b>${escapeHtml(a.display_name || a.name)}</b>
          ${!isExpanded && summary ? `<span class="muted" style="font-size:0.82rem">${escapeHtml(summary)}</span>` : ""}
        </div>
        <div class="row-actions" style="align-items:center; gap:8px; flex-wrap:nowrap">
          <span class="chip ${assessorType === "region" ? "gold" : ""}">${assessorType === "region" ? "Region-Based" : "Province-Based"}</span>
          ${details.length ? `<button type="button" class="linkish finder-assessor-toggle" data-assessor-key="${escapeHtml(key)}">${isExpanded ? "Hide details ▴" : "Show details ▾"}</button>` : ""}
        </div>
      </div>
      ${isExpanded && details.length ? `<dl class="assessment-card-grid" style="margin-top:8px">
        ${details.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
      </dl>` : ""}
      ${isExpanded && a.qualifications && a.qualifications.length ? `<p class="muted" style="font-size:0.8rem; margin-top:8px">Accredited for: ${escapeHtml(a.qualifications.join("; "))}</p>` : ""}
      <div class="row-actions" style="margin-top:10px">
        <button class="ghost" data-pick-assessor="${escapeHtml(a.name)}" data-pick-assessor-type="${escapeHtml(assessorType)}">
          ${isPicked ? "Selected ✓" : "Use assessor"}
        </button>
      </div>
    </div>
  `;
}

async function renderFinder() {
  const query = state.finder.query;
  // Always fetch the full (unfiltered) assessor list and split it client-side for the two
  // source tabs. This means switching tabs never re-fetches and never loses the in-progress
  // pick — the bug where choosing "Region-Based" reset whatever the user had already selected.
  const data = await api(`/api/finder?q=${encodeURIComponent(query)}&qualification=${encodeURIComponent(state.finder.selected)}`);
  const source = state.finder.source === "region" ? "region" : "province";

  // Reset the in-progress pick only when the qualification actually changes, not on every
  // re-render (tab switches, search debounce, etc. all call renderFinder()).
  if (!state.finder.picked || state.finder.picked.qualification !== data.qualification) {
    state.finder.picked = { qualification: data.qualification, assessment_center: "", assessor: "", assessor_type: "province" };
  }
  const picked = state.finder.picked;
  state.finder.expanded = state.finder.expanded || {};

  const provinceAssessors = data.assessors.filter((a) => (a.assessor_type || "province") === "province");
  const regionAssessors = data.assessors.filter((a) => a.assessor_type === "region");
  const activeAssessors = source === "region" ? regionAssessors : provinceAssessors;

  $("view-finder").innerHTML = `
    <div class="card">
      <div class="scheduler-form-head" style="margin:-18px -18px 16px;">
        <p class="eyebrow-tag">Qualification Finder</p>
        <h3>${data.qualification ? escapeHtml(data.qualification) : "Find a qualification"}</h3>
        <p>Look up who's eligible to assess a qualification and where, then jump straight into scheduling.</p>
      </div>
      <div class="toolbar">
        <input id="finder-q" placeholder="Search qualification, e.g. Computer" value="${escapeHtml(query)}" style="flex:1; min-width:180px" />
        <select id="finder-qual-select" style="flex:2; min-width:220px">
          <option value="">${data.suggestions.length ? "Select a qualification…" : "No qualifications match that search"}</option>
          ${data.suggestions.map((q) => `<option value="${escapeHtml(q)}" ${q === data.qualification ? "selected" : ""}>${escapeHtml(q)}</option>`).join("")}
        </select>
        <button class="ghost" id="finder-clear">Clear</button>
      </div>
      ${data.qualification ? `
        <p class="hint" style="margin-top:14px">Assessors found: ${data.assessor_count} · Assessment centers found: ${data.center_count}</p>

        <div class="pill-tabs" id="finder-source-tabs">
          <button type="button" class="tab-btn ${source === "province" ? "active" : ""}" data-source="province">
            <span class="tab-dot"></span>Province-Based <span class="tab-count">${provinceAssessors.length}</span>
          </button>
          <button type="button" class="tab-btn ${source === "region" ? "active" : ""}" data-source="region" data-region>
            <span class="tab-dot"></span>Region-Based <span class="tab-count">${regionAssessors.length}</span>
          </button>
        </div>

        <div class="grid two" style="margin-top:14px; align-items:start">
          <div>
            <div class="row-actions" style="justify-content:space-between; align-items:center; margin-bottom:10px">
              <h3 style="margin:0">Available assessors</h3>
              ${activeAssessors.length ? `<div class="row-actions">
                <button type="button" class="linkish" id="finder-expand-all">Expand all</button>
                <button type="button" class="linkish" id="finder-collapse-all">Collapse all</button>
              </div>` : ""}
            </div>
            ${activeAssessors.length ? activeAssessors.map((a) => finderAssessorCardHtml(a, picked, state.finder.expanded)).join("") : `<p class="empty">No ${source === "region" ? "region-based" : "province-based"} assessors found for this qualification.</p>`}
          </div>
          <div>
            <h3 style="margin:0 0 10px">Assessment centers</h3>
            ${data.centers.length ? data.centers.map((c) => `
              <div class="task ${picked.assessment_center === c.name ? "task-picked" : ""}">
                <b>${escapeHtml(c.name)}</b>
                <span>${escapeHtml(c.address || "")}${c.manager ? " · " + escapeHtml(c.manager) : ""}</span>
                ${c.telephone ? `<span>Tel: ${escapeHtml(c.telephone)}</span>` : ""}
                ${c.sector ? `<span>Sector: ${escapeHtml(c.sector)}</span>` : ""}
                <div class="row-actions" style="margin-top:8px">
                  <button class="ghost" data-pick-center="${escapeHtml(c.name)}">${picked.assessment_center === c.name ? "Selected ✓" : "Use center"}</button>
                </div>
              </div>
            `).join("") : `<p class="empty">No assessment centers found for this qualification.</p>`}
          </div>
        </div>
        <div class="row-actions" style="margin-top:16px; align-items:center">
          <button class="primary" id="create-from-finder">Create assessment</button>
          ${picked.assessment_center || picked.assessor ? `<span class="muted">${escapeHtml([picked.assessment_center, picked.assessor].filter(Boolean).join(" · "))}</span>` : ""}
        </div>
      ` : `<p class="empty" style="margin-top:14px">Select a qualification above to see assessors and centers.</p>`}
    </div>
  `;
  const box = $("finder-q");
  box.addEventListener("input", debounce(() => {
    state.finder.query = box.value;
    state.finder.selected = "";
    renderFinder();
  }, 250));
  $("finder-clear").onclick = () => {
    state.finder = { query: "", selected: "", source: state.finder.source, picked: null };
    renderFinder();
  };
  $("finder-qual-select").addEventListener("change", (event) => {
    state.finder.selected = event.target.value;
    renderFinder();
  });
  document.querySelectorAll("#finder-source-tabs .tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.finder.source = btn.dataset.source;
      renderFinder();
    });
  });
  document.querySelectorAll(".finder-assessor-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.assessorKey;
      state.finder.expanded[key] = !state.finder.expanded[key];
      renderFinder();
    });
  });
  $("finder-expand-all")?.addEventListener("click", () => {
    activeAssessors.forEach((a) => { state.finder.expanded[finderAssessorKey(a)] = true; });
    renderFinder();
  });
  $("finder-collapse-all")?.addEventListener("click", () => {
    activeAssessors.forEach((a) => { state.finder.expanded[finderAssessorKey(a)] = false; });
    renderFinder();
  });
  document.querySelectorAll("[data-pick-center]").forEach((btn) => {
    btn.onclick = () => {
      state.finder.picked.assessment_center = btn.dataset.pickCenter;
      toast(`Center set: ${state.finder.picked.assessment_center}`);
      renderFinder();
    };
  });
  document.querySelectorAll("[data-pick-assessor]").forEach((btn) => {
    btn.onclick = () => {
      state.finder.picked.assessor = btn.dataset.pickAssessor;
      state.finder.picked.assessor_type = btn.dataset.pickAssessorType || "province";
      toast(`Assessor set: ${state.finder.picked.assessor}`);
      renderFinder();
    };
  });
  $("create-from-finder")?.addEventListener("click", () => {
    state.editingId = null;
    state.prefill = picked;
    state.schedulerTab = "entry";
    switchView("scheduler", { prefill: picked });
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
  state.history.exportStart = state.history.exportStart || "";
  state.history.exportEnd = state.history.exportEnd || "";
  const params = new URLSearchParams();
  if (qualification) params.set("qualification", qualification);
  if (assessor_type) params.set("assessor_type", assessor_type);
  const data = await api(`/api/assessor-rotation?${params.toString()}`);
  const sourceLabel = assessor_type === "region" ? "region-based" : assessor_type === "province" ? "province-based" : "";

  const rotationPanel = !data.qualification ? `
    <p class="empty">Select a qualification above to see its assessor rotation — who's assessed it, when they last did, and who's next in line.</p>
  ` : `
    <p class="hint">Rotation for <b>${escapeHtml(data.qualification)}</b>${sourceLabel ? ` · ${sourceLabel} assessors only` : ""} · sorted so whoever has gone longest without an assignment (or has never been assigned) is listed first. Click a row to see full assessment history.</p>
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
    `).join("")}</div>` : `<p class="empty">No ${sourceLabel || ""} assessors found for this qualification.</p>`}
  `;

  state.historyLogPage = state.historyLogPage || 1;
  const logPaged = paginate(data.assessment_log, state.historyLogPage);
  state.historyLogPage = logPaged.page;
  const logPanel = `
    <p class="hint">${data.qualification ? `Every recorded assessment for <b>${escapeHtml(data.qualification)}</b>` : "Every recorded assessment across all qualifications"}${sourceLabel ? ` involving a ${sourceLabel} assessor` : ""}, most recent first.</p>
    ${data.assessment_log.length ? `<div class="table-wrap desktop-table"><table>
      <thead><tr><th>Date</th>${data.qualification ? "" : "<th>Qualification</th>"}<th>Assessment Center</th><th>Assessor(s)</th><th>Pax</th></tr></thead>
      <tbody>
        ${logPaged.pageItems.map((item) => `
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
    <div class="mobile-records">${logPaged.pageItems.map((item) => `
      <article class="record-card" data-open-assessment="${item.id}" style="cursor:pointer">
        <h4>${escapeHtml(item.date_label)}</h4>
        <div class="muted">${data.qualification ? "" : `${escapeHtml(item.qualification)} · `}${escapeHtml(item.assessment_center)} · ${item.pax} pax</div>
        <div>${item.assessors.map((a) => `${escapeHtml(a.name)} (${a.assessor_type === "region" ? "Region" : "Province"})`).join(", ")}</div>
      </article>
    `).join("")}</div>
    <div id="history-log-pagination">${paginationControls("history-log", logPaged.page, logPaged.totalPages, data.assessment_log.length)}</div>` : `<p class="empty">No recorded assessments yet.</p>`}
  `;

  $("view-history").innerHTML = `
    <div class="card">
      <div class="scheduler-form-head" style="margin:-18px -18px 16px;">
        <p class="eyebrow-tag">Assessor History</p>
        <h3>${data.qualification ? escapeHtml(data.qualification) : "All qualifications"}</h3>
        <p>Track who has assessed what, spot who's overdue for a turn, and review every past assessment.</p>
      </div>
      <div class="field full" style="max-width:420px">
        <label>Qualification</label>
        <select id="hist-qual">
          <option value="">All qualifications</option>
          ${optionList(data.qualifications, data.qualification)}
        </select>
      </div>

      <div class="row-actions" style="margin-top:16px; justify-content:space-between; align-items:center">
        <div class="pill-tabs" id="hist-source-tabs">
          <button type="button" class="tab-btn ${assessor_type === "province" ? "active" : ""}" data-source="province"><span class="tab-dot"></span>Province-Based</button>
          <button type="button" class="tab-btn ${assessor_type === "region" ? "active" : ""}" data-source="region" data-region><span class="tab-dot"></span>Region-Based</button>
          <button type="button" class="tab-btn ${assessor_type === "" ? "active" : ""}" data-source="">All</button>
        </div>
        <button class="ghost" id="hist-reset" type="button">Clear filters</button>
      </div>

      <div class="row-actions" style="margin-top:14px; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px">
        <div class="pill-tabs tabs-sm">
          <button type="button" class="tab-btn ${tab === "rotation" ? "active" : ""}" id="tab-rotation">Rotation Order</button>
          <button type="button" class="tab-btn ${tab === "log" ? "active" : ""}" id="tab-log">Assessment History</button>
        </div>
        <button class="ghost" type="button" id="hist-export-btn">Export to Excel…</button>
      </div>

      <div style="margin-top:16px">
        ${tab === "rotation" ? rotationPanel : logPanel}
      </div>
    </div>
  `;

  const applyHistory = () => {
    state.history = {
      qualification: $("hist-qual").value,
      assessor_type: state.history.assessor_type,
      tab: state.history.tab,
    };
    state.historyLogPage = 1;
    renderHistory();
  };
  $("hist-qual").onchange = applyHistory;
  $("hist-reset").onclick = () => {
    state.history = { qualification: "", assessor_type: "province", tab: state.history.tab };
    state.historyLogPage = 1;
    renderHistory();
  };
  document.querySelectorAll("#hist-source-tabs .tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.history.assessor_type = btn.dataset.source;
      state.historyLogPage = 1;
      renderHistory();
    });
  });
  $("tab-rotation")?.addEventListener("click", () => { state.history.tab = "rotation"; renderHistory(); });
  $("tab-log")?.addEventListener("click", () => { state.history.tab = "log"; renderHistory(); });
  document.querySelectorAll("[data-assessor-row]").forEach((el) => {
    el.addEventListener("click", () => showAssessorHistory(data.rotation[Number(el.dataset.assessorRow)], data.qualification));
  });
  document.querySelectorAll("[data-open-assessment]").forEach((el) => {
    el.addEventListener("click", () => {
      state.editingId = el.dataset.openAssessment;
      state.schedulerTab = "entry";
      switchView("scheduler");
    });
  });
  bindPaginationControls(
    "history-log-pagination",
    () => { state.historyLogPage -= 1; renderHistory(); },
    () => { state.historyLogPage += 1; renderHistory(); }
  );
  $("hist-export-btn").addEventListener("click", () => openExportHistoryModal());
}

function openExportHistoryModal() {
  state.history.exportType = state.history.exportType || state.history.assessor_type || "";
  state.history.exportStart = state.history.exportStart || "";
  state.history.exportEnd = state.history.exportEnd || "";
  state.history.exportGroupBy = state.history.exportGroupBy || "month";

  const whatOptions = [
    { value: "", label: "All" },
    { value: "province", label: "Province-Based" },
    { value: "region", label: "Region-Based" },
  ];
  const periodOptions = [
    { value: "month", label: "Split by Month" },
    { value: "year", label: "Whole Year" },
  ];

  openModal(`
    <div class="modal-head">
      <div>
        <p class="eyebrow">Assessor History</p>
        <h2>Export to Excel</h2>
        <p class="muted">Every qualification is always included — choose what to export and, optionally, an inclusive date range.</p>
      </div>
      <button class="ghost" id="close-modal">Close</button>
    </div>
    <div class="field full">
      <label>What</label>
      <div class="duration-toggle duration-toggle-3" id="export-what-toggle">
        ${whatOptions.map((opt, i) => `
          <input type="radio" id="export-what-${i}" name="export_what" value="${opt.value}" ${state.history.exportType === opt.value ? "checked" : ""} />
          <label for="export-what-${i}">${opt.label}</label>
        `).join("")}
      </div>
    </div>
    <div class="field full">
      <label>Period <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">(how sheets are split)</span></label>
      <div class="duration-toggle" id="export-period-toggle">
        ${periodOptions.map((opt, i) => `
          <input type="radio" id="export-period-${i}" name="export_period" value="${opt.value}" ${state.history.exportGroupBy === opt.value ? "checked" : ""} />
          <label for="export-period-${i}">${opt.label}</label>
        `).join("")}
      </div>
      <p class="hint" style="margin-top:6px">"Split by Month" gives one sheet per month, as before. "Whole Year" gives one sheet per calendar year, listing every assignment of assessors for that year.</p>
    </div>
    <div class="field full">
      <label>When <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">(optional, inclusive)</span></label>
      <div class="row-actions" style="align-items:center; flex-wrap:wrap; gap:10px">
        <span class="muted" style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.06em">From</span>
        <input type="date" id="export-start" value="${state.history.exportStart}" style="padding:8px 10px" />
        <span class="muted" style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.06em">To</span>
        <input type="date" id="export-end" value="${state.history.exportEnd}" style="padding:8px 10px" />
      </div>
      <p class="hint" style="margin-top:6px">Leave both blank to export the full history, or set a range to narrow it.</p>
    </div>
    <div class="field full row-actions">
      <button class="primary" type="button" id="export-confirm">Export to Excel</button>
      <button class="ghost" type="button" id="export-cancel">Cancel</button>
    </div>
  `);

  $("close-modal").onclick = closeModal;
  $("export-cancel").onclick = closeModal;
  $("export-start").addEventListener("change", (e) => { state.history.exportStart = e.target.value; });
  $("export-end").addEventListener("change", (e) => { state.history.exportEnd = e.target.value; });
  document.querySelectorAll('input[name="export_what"]').forEach((input) => {
    input.addEventListener("change", () => { if (input.checked) state.history.exportType = input.value; });
  });
  document.querySelectorAll('input[name="export_period"]').forEach((input) => {
    input.addEventListener("change", () => { if (input.checked) state.history.exportGroupBy = input.value; });
  });
  $("export-confirm").addEventListener("click", () => {
    const start = state.history.exportStart;
    const end = state.history.exportEnd;
    if (start && end && end < start) {
      toast("End date must be on or after the start date.", "error");
      return;
    }
    const exportParams = new URLSearchParams();
    exportParams.set("assessor_type", state.history.exportType || "");
    exportParams.set("group_by", state.history.exportGroupBy || "month");
    if (start) exportParams.set("start_date", start);
    if (end) exportParams.set("end_date", end);
    window.location.href = `/api/assessor-rotation/export?${exportParams.toString()}`;
    closeModal();
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
  state.repsPage = state.repsPage || 1;
  const repsPaged = paginate(people, state.repsPage);
  state.repsPage = repsPaged.page;
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
        ${people.length ? repsPaged.pageItems.map((p) => `
          <div class="task">
            <b>${escapeHtml(p.name)}</b>
            <span>${escapeHtml(p.position || "TESDA Representative")} ${p.contact ? "· " + escapeHtml(p.contact) : ""}</span>
            <div class="row-actions" style="margin-top:8px">
              <button class="ghost" data-rep-edit="${p.id}">Edit</button>
              <button class="danger" data-rep-del="${p.id}">Delete</button>
            </div>
          </div>
        `).join("") : `<p class="empty">No representatives yet. Add the people you assign to assessments.</p>`}
        <div id="reps-pagination">${paginationControls("reps", repsPaged.page, repsPaged.totalPages, people.length)}</div>
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
  bindPaginationControls(
    "reps-pagination",
    () => { state.repsPage -= 1; renderReps(); },
    () => { state.repsPage += 1; renderReps(); }
  );
}

async function renderReports() {
  const { year, month, q } = state.report;
  state.report.range = state.report.range || { startYear: year, startMonth: month, endYear: year, endMonth: month };
  const range = state.report.range;
  state.reportPage = state.reportPage || 1;
  const data = await api(`/api/reports?year=${year}&month=${month}&q=${encodeURIComponent(q)}`);
  const reportPaged = paginate(data.items, state.reportPage);
  state.reportPage = reportPaged.page;
  $("view-reports").innerHTML = `
    <div class="card">
      <div class="toolbar">
        <select id="rep-month">${monthNames.map((name, i) => `<option value="${i+1}" ${i+1===month?"selected":""}>${name}</option>`).join("")}</select>
        <input id="rep-year" type="number" value="${year}" style="width:110px" />
        <input id="rep-q" placeholder="Search center, qualification, assessor" value="${escapeHtml(q)}" />
        <a class="primary" href="/api/reports/export?year=${year}&month=${month}" style="text-decoration:none">Export This Month</a>
      </div>
      <p class="hint">${data.items.length} assessment${data.items.length === 1 ? "" : "s"} in ${monthNames[month-1]} ${year}. Export uses the simplified Assessment Monitoring layout.</p>
      <div class="table-wrap desktop-table" id="reports-table">${assessmentTable(reportPaged.pageItems)}</div>
      <div class="mobile-records" id="reports-cards">${assessmentCards(reportPaged.pageItems)}</div>
      <div id="reports-pagination">${paginationControls("reports", reportPaged.page, reportPaged.totalPages, data.items.length)}</div>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>Export a month range</h3>
      <p class="hint">Pick a start and end month. Each assessment is placed in exactly one sheet — its start month if that's within the range, otherwise the earliest month in range it overlaps — so a schedule spanning two months is never duplicated.</p>
      <div class="toolbar">
        <span class="muted" style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.06em">From</span>
        <select id="range-start-month">${monthNames.map((name, i) => `<option value="${i+1}" ${i+1===range.startMonth?"selected":""}>${name}</option>`).join("")}</select>
        <input id="range-start-year" type="number" value="${range.startYear}" style="width:110px" />
        <span class="muted" style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.06em">To</span>
        <select id="range-end-month">${monthNames.map((name, i) => `<option value="${i+1}" ${i+1===range.endMonth?"selected":""}>${name}</option>`).join("")}</select>
        <input id="range-end-year" type="number" value="${range.endYear}" style="width:110px" />
        <button type="button" class="primary" id="range-export-btn">Export month range</button>
      </div>
    </div>
  `;
  const apply = () => {
    state.report.month = Number($("rep-month").value);
    state.report.year = Number($("rep-year").value);
    state.report.q = $("rep-q").value;
    state.reportPage = 1;
    renderReports();
  };
  $("rep-month").onchange = apply;
  $("rep-year").onchange = apply;
  $("rep-q").addEventListener("input", debounce(apply, 250));

  const syncRange = () => {
    range.startMonth = Number($("range-start-month").value);
    range.startYear = Number($("range-start-year").value);
    range.endMonth = Number($("range-end-month").value);
    range.endYear = Number($("range-end-year").value);
  };
  ["range-start-month", "range-start-year", "range-end-month", "range-end-year"].forEach((id) => {
    $(id).addEventListener("change", syncRange);
  });
  $("range-export-btn").addEventListener("click", () => {
    syncRange();
    const startIndex = range.startYear * 12 + (range.startMonth - 1);
    const endIndex = range.endYear * 12 + (range.endMonth - 1);
    if (endIndex < startIndex) {
      toast("End month must be on or after the start month.", "error");
      return;
    }
    const params = new URLSearchParams({
      start_year: range.startYear,
      start_month: range.startMonth,
      end_year: range.endYear,
      end_month: range.endMonth,
    });
    window.location.href = `/api/reports/export-range?${params.toString()}`;
  });
  bindPaginationControls(
    "reports-pagination",
    () => { state.reportPage -= 1; renderReports(); },
    () => { state.reportPage += 1; renderReports(); }
  );
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
        <h3>Branding / Logo</h3>
        <p class="hint">Customize the logo and organization name shown in the sidebar.</p>
        <div class="branding-preview">
          <div class="brand-mark ${data.branding?.logo_url ? "has-image" : ""}" id="branding-mark-preview">
            ${data.branding?.logo_url ? `<img src="${escapeHtml(data.branding.logo_url)}" alt="Logo" />` : escapeHtml(data.branding?.initials || "TL")}
          </div>
          <div class="row-actions" style="flex-wrap:wrap">
            <label class="ghost" style="cursor:pointer; display:inline-flex; align-items:center;">
              Upload logo image
              <input type="file" id="logo-upload" accept="image/png,image/jpeg,image/webp,image/svg+xml" style="display:none" />
            </label>
            ${data.branding?.logo_url ? `<button class="ghost" id="logo-remove" type="button">Remove logo</button>` : ""}
          </div>
          <p class="muted" style="font-size:0.78rem">PNG, JPG, WEBP, or SVG, up to 3 MB. Without a logo, the initials below are shown instead.</p>
        </div>
        <form id="branding-form" class="form-grid" style="margin-top:14px">
          <div class="field"><label>Initials (shown without a logo)</label><input name="initials" maxlength="4" value="${escapeHtml(data.branding?.initials || "")}" /></div>
          <div class="field"><label>Kicker text</label><input name="kicker" value="${escapeHtml(data.branding?.kicker || "")}" placeholder="e.g. TESDA Region VIII" /></div>
          <div class="field full"><label>Organization name</label><input name="title" required value="${escapeHtml(data.branding?.title || "")}" placeholder="e.g. Southern Leyte" /></div>
          <div class="field full"><label>Subtitle</label><input name="sub" value="${escapeHtml(data.branding?.sub || "")}" placeholder="e.g. Competency Assessment Control" /></div>
          <div class="field full row-actions">
            <button class="primary" type="submit">Save branding</button>
          </div>
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
        <p>Portal schedule = assessment date minus 2 business days (weekends skipped), calculated separately for each assessment date — including every day of a continuous/multi-day run.</p>
        <p>Any approved/portal schedule date can also be edited by hand in Assessment Entry if the actual portal date ends up different.</p>
        <p>Results reminders are generated for every assessment date plus one day.</p>
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
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Upload failed");
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
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Import failed");
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
  $("branding-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = formValues(event.currentTarget);
    try {
      const res = await api("/api/settings/branding", { method: "POST", headers: jsonHeaders(), body: JSON.stringify(payload) });
      applyBranding(res.branding);
      toast("Branding saved.");
      await renderSettings();
    } catch (err) {
      toast(err.message, "error");
    }
  });
  $("logo-upload").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const body = new FormData();
    body.set("file", file);
    try {
      const res = await fetch("/api/settings/branding/logo", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");
      applyBranding(json.branding);
      toast("Logo updated.");
      await renderSettings();
    } catch (err) {
      toast(err.message, "error");
    }
  });
  $("logo-remove")?.addEventListener("click", async () => {
    try {
      const res = await api("/api/settings/branding/logo/reset", { method: "POST" });
      applyBranding(res.branding);
      toast("Logo removed.");
      await renderSettings();
    } catch (err) {
      toast(err.message, "error");
    }
  });
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
  state.schedulerTab = "entry";
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
    applyBranding(settings.branding);
  } catch {}
  switchView("dashboard");
})();
