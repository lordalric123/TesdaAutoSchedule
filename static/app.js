const state = {
  view: "dashboard",
  centers: [],
  representatives: [],
  assessments: [],
  calendar: { type: "approved", year: new Date().getFullYear(), month: new Date().getMonth() + 1, payload: null },
  finder: { query: "", selected: "", source: "" },
  report: { year: new Date().getFullYear(), month: new Date().getMonth() + 1, q: "" },
  history: { qualification: "", assessor_type: "", tab: "log" },
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
    duration_type: "single",
    start_date: "",
    end_date: "",
    pax: "",
    tesda_representative: prefill.tesda_representative || "",
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
      return `
        <div class="assessor-row">
          <select class="assessor-type-input" data-index="${index}">
            <option value="province" ${row.assessor_type === "province" ? "selected" : ""}>Province-Based</option>
            <option value="region" ${row.assessor_type === "region" ? "selected" : ""}>Region-Based</option>
          </select>
          <select class="assessor-name-input" data-index="${index}">
            <option value="">Select assessor</option>
            ${optionList(list, row.assessor)}
          </select>
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
        assessorRows[idx] = { assessor_type: sel.value, assessor: "" };
        redrawAssessorRows();
      });
    });
    document.querySelectorAll(".assessor-name-input").forEach((sel) => {
      sel.addEventListener("change", () => {
        const idx = Number(sel.dataset.index);
        assessorRows[idx].assessor = sel.value;
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
            <select name="duration_type">
              <option value="single" ${current.duration_type === "single" ? "selected" : ""}>Single Day</option>
              <option value="continuous" ${current.duration_type === "continuous" ? "selected" : ""}>Continuous / Multiple Days</option>
            </select>
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
          <div class="field full row-actions">
            <button class="primary" type="submit">${editing ? "Update record" : "Save assessment"}</button>
            ${editing ? `<button class="ghost" type="button" id="cancel-edit">Cancel</button>` : ""}
          </div>
        </form>
      </div>
      <div class="card scheduler-records">
        <h3>Assessment records</h3>
        ${assessmentCards(state.assessments)}
      </div>
    </div>
  `;

  bindAssessorRowEvents();
  $("add-assessor").addEventListener("click", () => {
    assessorRows.push({ assessor_type: "province", assessor: "" });
    redrawAssessorRows();
  });

  const form = $("assessment-form");
  const duration = form.duration_type;
  const endWrap = $("end-wrap");
  duration.addEventListener("change", () => {
    const continuous = duration.value === "continuous";
    endWrap.style.display = continuous ? "" : "none";
    $("start-label").textContent = continuous ? "Start Date" : "Assessment Date";
  });
  form.assessment_center.addEventListener("change", async () => {
    state.prefill = { ...formValues(form), assessors: assessorRows.slice() };
    state.prefill.qualification = "";
    await renderScheduler({ prefill: state.prefill, assessment: editing });
  });
  form.qualification.addEventListener("change", async () => {
    state.prefill = { ...formValues(form), assessors: assessorRows.slice() };
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
    if (!payload.assessors.length) {
      toast("Add at least one assessor.", "error");
      return;
    }
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

function assessmentCards(items) {
  if (!items.length) return `<p class="empty">No assessments yet.</p>`;
  return `<div class="record-list">${items.map((item) => `
    <article class="record-card">
      <h4>${escapeHtml(item.assessment_center)}</h4>
      <div class="muted">${escapeHtml(item.qualification)}</div>
      <div class="record-meta">
        <span class="chip">${escapeHtml(durationLabel(item.duration_type))}</span>
        <span class="chip gold">${escapeHtml(assessorChipLabel(item))}</span>
        <span>${escapeHtml(item.date_label)}</span>
        <span class="muted">${item.pax} pax</span>
      </div>
      <div><b>Assessors:</b> ${escapeHtml(assessorsSummary(item))}</div>
      <div><b>TESDA Representative:</b> ${escapeHtml(item.tesda_representative || "None")}</div>
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

async function renderFinder() {
  const query = state.finder.query;
  const source = state.finder.source || "";
  const data = await api(`/api/finder?q=${encodeURIComponent(query)}&qualification=${encodeURIComponent(state.finder.selected)}&source=${encodeURIComponent(source)}`);
  const sourceLabel = source === "region" ? "Region-Based" : source === "province" ? "Province-Based" : "All";
  $("view-finder").innerHTML = `
    <div class="card">
      <div class="toolbar">
        <input id="finder-q" placeholder="Search qualification, e.g. Computer" value="${escapeHtml(query)}" />
        <button class="ghost" id="finder-clear">Clear</button>
      </div>
      <div class="grid two">
        <div>
          <h3>Qualifications</h3>
          <div class="finder-list">
            ${data.suggestions.length ? data.suggestions.map((q) => `
              <button class="pick ${q === data.qualification ? "selected" : ""}" data-qual="${escapeHtml(q)}">${escapeHtml(q)}</button>
            `).join("") : `<p class="empty">No qualifications match that search.</p>`}
          </div>
        </div>
        <div>
          ${data.qualification ? `
            <p class="hint">Qualification: <b>${escapeHtml(data.qualification)}</b><br>
            Assessors found: ${data.assessor_count} · Assessment centers found: ${data.center_count}</p>
            <div class="grid two">
              <div>
                <div class="row-actions" style="margin-bottom:10px">
                  <h3 style="margin:0">Available assessors</h3>
                  <span class="chip ${source === "" ? "gold" : ""}" data-source-filter="" style="cursor:pointer">All</span>
                  <span class="chip ${source === "province" ? "gold" : ""}" data-source-filter="province" style="cursor:pointer">Province-Based</span>
                  <span class="chip ${source === "region" ? "gold" : ""}" data-source-filter="region" style="cursor:pointer">Region-Based</span>
                </div>
                ${data.assessors.length ? data.assessors.map((a) => `
                  <div class="task">
                    <b>${escapeHtml(a.display_name || a.name)}</b>
                    <span>${escapeHtml(a.assessor_type === "region" ? "Region-Based" : "Province-Based")} · ${escapeHtml(a.address || "No address")} · ${escapeHtml(a.designation || a.company || "")}</span>
                    <div class="row-actions" style="margin-top:8px">
                      <button class="ghost" data-pick-assessor="${escapeHtml(a.name)}" data-pick-assessor-type="${escapeHtml(a.assessor_type || "province")}">Use assessor</button>
                    </div>
                  </div>
                `).join("") : `<p class="empty">No ${sourceLabel.toLowerCase()} assessors found for this qualification.</p>`}
              </div>
              <div>
                <h3>Assessment centers</h3>
                ${data.centers.length ? data.centers.map((c) => `
                  <div class="task">
                    <b>${escapeHtml(c.name)}</b>
                    <span>${escapeHtml(c.address || "")}${c.manager ? " · " + escapeHtml(c.manager) : ""}</span>
                    <div class="row-actions" style="margin-top:8px">
                      <button class="ghost" data-pick-center="${escapeHtml(c.name)}">Use center</button>
                    </div>
                  </div>
                `).join("") : `<p class="empty">No assessment centers found for this qualification.</p>`}
              </div>
            </div>
            <div class="row-actions" style="margin-top:16px">
              <button class="primary" id="create-from-finder">Create assessment</button>
            </div>
          ` : `<p class="empty">Select a qualification to see assessors and centers.</p>`}
        </div>
      </div>
    </div>
  `;
  const box = $("finder-q");
  box.addEventListener("input", debounce(() => {
    state.finder.query = box.value;
    state.finder.selected = "";
    renderFinder();
  }, 250));
  $("finder-clear").onclick = () => { state.finder = { query: "", selected: "", source: state.finder.source }; renderFinder(); };
  document.querySelectorAll("[data-qual]").forEach((btn) => {
    btn.onclick = () => { state.finder.selected = btn.dataset.qual; renderFinder(); };
  });
  document.querySelectorAll("[data-source-filter]").forEach((chip) => {
    chip.onclick = () => { state.finder.source = chip.dataset.sourceFilter; renderFinder(); };
  });
  let picked = { qualification: data.qualification, assessment_center: "", assessor: "", assessor_type: "province" };
  document.querySelectorAll("[data-pick-center]").forEach((btn) => {
    btn.onclick = () => { picked.assessment_center = btn.dataset.pickCenter; toast(`Center set: ${picked.assessment_center}`); };
  });
  document.querySelectorAll("[data-pick-assessor]").forEach((btn) => {
    btn.onclick = () => {
      picked.assessor = btn.dataset.pickAssessor;
      picked.assessor_type = btn.dataset.pickAssessorType || "province";
      toast(`Assessor set: ${picked.assessor}`);
    };
  });
  $("create-from-finder")?.addEventListener("click", () => {
    state.editingId = null;
    state.prefill = picked;
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
        <a class="primary" href="/api/reports/export?year=${year}&month=${month}" style="text-decoration:none">Export Assessment Schedule</a>
      </div>
      <p class="hint">${data.items.length} assessment${data.items.length === 1 ? "" : "s"} in ${monthNames[month-1]} ${year}. Export uses the simplified Assessment Monitoring layout.</p>
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
        <p>Single-day portal schedule = assessment date minus 2 days, with weekend adjustment to the preceding weekday.</p>
        <p>Continuous assessments keep exactly minus 2 calendar days, including Saturday and Sunday.</p>
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
  } catch {}
  switchView("dashboard");
})();
