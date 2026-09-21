'use strict';

const API = '/api';

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

let currentFilter = 'ALL';
let refreshInterval = null;

function toast(msg, type = 'info') {
  const container = $('#toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 4000);
}

async function apiGet(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
}

async function apiPost(path, body = {}) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `API ${path} failed`);
  return data;
}

// Views
function switchView(viewName) {
  $$('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.view === viewName));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${viewName}`));
  $('#viewTitle').textContent = viewName.charAt(0).toUpperCase() + viewName.slice(1);
  const subtitles = {
    dashboard: 'Master Agent Orchestration System',
    tasks: 'Task Management & Execution History',
    agents: 'Agent Status & Statistics',
    logs: 'System Logs & Task Logs',
    communication: 'Inter-Agent Communication Bus',
    settings: 'System Configuration'
  };
  $('#viewSubtitle').textContent = subtitles[viewName] || '';

  // Load view data
  if (viewName === 'dashboard') { loadDashboard(); }
  else if (viewName === 'tasks') { loadAllTasks(); }
  else if (viewName === 'agents') { loadAgents(); }
  else if (viewName === 'logs') { loadLogs(); }
  else if (viewName === 'communication') { loadCommunication(); }
  else if (viewName === 'settings') { loadSettings(); }
}

// Dashboard
async function loadDashboard() {
  try {
    const [status, tasksData, safeMode] = await Promise.all([
      apiGet('/status'),
      apiGet('/tasks?limit=10'),
      apiGet('/safe-mode')
    ]);

    // Stats
    const byStatus = tasksData.stats.byStatus;
    $('#statTotal').textContent = tasksData.stats.total;
    $('#statPending').textContent = byStatus.PENDING || 0;
    $('#statCompleted').textContent = byStatus.COMPLETED || 0;
    $('#statFailed').textContent = byStatus.FAILED || 0;
    $('#statBlocked').textContent = status.agents?.rakshak?.blockedCount || 0;
    $('#healthSafeMode').textContent = safeMode.enabled ? 'ON' : 'OFF';
    $('#healthSafeMode').className = 'health-value ' + (safeMode.enabled ? 'green' : 'red');
    $('#healthQueue').textContent = tasksData.stats.queueLength;
    $('#healthLastTask').textContent = tasksData.tasks[0] ? tasksData.tasks[0].task_id.slice(0, 16) + '...' : 'None';

    // Safe mode badge
    const badge = $('#safeModeBadge');
    badge.textContent = safeMode.enabled ? 'ON' : 'OFF';
    badge.className = 'badge ' + (safeMode.enabled ? 'on' : 'off');
    $('#safeModeCard').className = 'safe-mode-card ' + (safeMode.enabled ? '' : 'danger');

    // Recent tasks
    const recentEl = $('#recentTasks');
    if (tasksData.tasks.length === 0) {
      recentEl.innerHTML = '<div class="empty">No tasks yet. Send a command above.</div>';
    } else {
      recentEl.innerHTML = tasksData.tasks.map(t => `
        <div class="task-item" data-task-id="${t.task_id}">
          <div class="task-item-header">
            <div class="task-command" title="${escapeHtml(t.command)}">${escapeHtml(t.command.slice(0, 80))}</div>
            <div class="task-meta">
              <span class="task-status ${t.status}">${t.status}</span>
              <span class="task-time">${timeAgo(t.created_at)}</span>
            </div>
          </div>
          <div style="font-size:11px; color:var(--text2); margin-top:4px;">${t.plan ? `${t.plan.total_steps} steps • ${t.plan.intent}` : 'No plan'} • ${t.assigned_agent || 'unassigned'}</div>
        </div>
      `).join('');
      recentEl.querySelectorAll('.task-item').forEach(el => {
        el.addEventListener('click', () => showTaskDetail(el.dataset.taskId));
      });
    }

    // Indicators
    const agents = status.agents;
    if (agents) {
      updateIndicator('Saarthi', agents.saarthi?.status || status.status);
      updateIndicator('Rakshak', agents.rakshak?.status);
      updateIndicator('Niyojak', agents.niyojak?.status);
      updateIndicator('Samanvayak', agents.samanvayak?.status);
      updateIndicator('Vikas', agents.vikas?.status);
    }

  } catch (err) {
    console.error('Dashboard load failed', err);
    toast('Failed to load dashboard: ' + err.message, 'error');
  }
}

function updateIndicator(name, status) {
  const el = $(`#indicator${name}`);
  if (!el) return;
  const dot = el.querySelector('.dot');
  if (!dot) return;
  if (status === 'BUSY') { dot.className = 'dot yellow'; }
  else if (status === 'ERROR') { dot.className = 'dot red'; }
  else if (status === 'IDLE') { dot.className = 'dot green'; }
  else { dot.className = 'dot gray'; }
}

async function loadAllTasks() {
  try {
    const data = await apiGet('/tasks?limit=50');
    const listEl = $('#allTasksList');
    let filtered = data.tasks;
    if (currentFilter !== 'ALL') filtered = data.tasks.filter(t => t.status === currentFilter);

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="empty">No tasks with status ${currentFilter}</div>`;
      return;
    }

    listEl.innerHTML = filtered.map(t => `
      <div class="task-item" data-task-id="${t.task_id}">
        <div class="task-item-header">
          <div class="task-command" title="${escapeHtml(t.command)}">${escapeHtml(t.command.slice(0, 100))}</div>
          <div class="task-meta">
            <span class="task-status ${t.status}">${t.status}</span>
            <span class="task-time">${timeAgo(t.created_at)}</span>
          </div>
        </div>
        <div style="display:flex; gap:12px; font-size:11px; color:var(--text2); margin-top:6px; flex-wrap:wrap;">
          <span>ID: ${t.task_id.slice(0, 20)}...</span>
          <span>Steps: ${t.plan?.total_steps || 0}</span>
          <span>Agent: ${t.assigned_agent || 'none'}</span>
          <span>Intent: ${t.plan?.intent || 'unknown'}</span>
        </div>
      </div>
    `).join('');

    listEl.querySelectorAll('.task-item').forEach(el => {
      el.addEventListener('click', () => showTaskDetail(el.dataset.taskId));
    });

  } catch (err) {
    toast('Failed to load tasks: ' + err.message, 'error');
  }
}

async function showTaskDetail(taskId) {
  try {
    const task = await apiGet(`/tasks/${taskId}`);
    const card = $('#taskDetailCard');
    const content = $('#taskDetailContent');
    card.classList.remove('hidden');
    $('#taskDetailTitle').textContent = `Task: ${taskId.slice(0, 24)}...`;

    content.innerHTML = `
      <div class="task-detail-grid">
        <div class="detail-section"><h4>Command</h4><pre>${escapeHtml(task.command)}</pre></div>
        <div class="detail-section"><h4>Status & Meta</h4><pre>Status: ${task.status}
Created: ${task.created_at}
Updated: ${task.updated_at}
Assigned: ${task.assigned_agent || 'none'}
Safe Mode: ${task.safe_mode}
Current Step: ${task.current_step}/${task.steps?.length || 0}</pre></div>
        ${task.plan ? `<div class="detail-section"><h4>Plan (${task.plan.plan_id}) - Intent: ${task.plan.intent}</h4><pre>${task.plan.steps.map(s => `${s.order}. ${s.title} [${s.permission}] - ${s.status || 'PENDING'}\n   ${s.description}`).join('\n\n')}</pre></div>` : ''}
        ${task.result ? `<div class="detail-section"><h4>Result - ${task.result.success ? 'SUCCESS' : 'FAILED'}</h4><pre>${escapeHtml(task.result.summary || task.result.message || JSON.stringify(task.result, null, 2).slice(0, 2000))}</pre></div>` : ''}
        ${task.result?.report ? `<div class="detail-section"><h4>Detailed Report</h4><pre>${escapeHtml(typeof task.result.report === 'string' ? task.result.report : JSON.stringify(task.result.report, null, 2).slice(0, 5000))}</pre></div>` : ''}
        ${task.result?.findings ? `<div class="detail-section"><h4>Findings (${task.result.findings.length})</h4><pre>${task.result.findings.map((f,i)=>`${i+1}. ${f}`).join('\n')}</pre></div>` : ''}
        ${task.result?.suggestions ? `<div class="detail-section"><h4>Suggestions (${task.result.suggestions.length})</h4><pre>${task.result.suggestions.map((s,i)=>`${i+1}. ${s}`).join('\n')}</pre></div>` : ''}
        <div class="detail-section"><h4>Logs (last 20)</h4><pre>${task.logs.slice(-20).map(l=>`[${l.timestamp.split('T')[1].split('.')[0]}] [${l.level}] ${l.message}`).join('\n')}</pre></div>
        ${task.permissions_checked?.length ? `<div class="detail-section"><h4>Guard Checks (Rakshak)</h4><pre>${task.permissions_checked.map(c=>`${c.allowed ? '✅' : '❌'} [${c.permission}] ${c.action?.slice(0,80)} - ${c.reason}`).join('\n')}</pre></div>` : ''}
      </div>
    `;
    card.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    toast('Failed to load task detail: ' + err.message, 'error');
  }
}

async function loadAgents() {
  try {
    const data = await apiGet('/agents');
    const grid = $('#agentsGrid');
    const agents = [
      { key: 'saarthi', name: 'SP SAARTHI', icon: '🧠', role: 'Master Agent', color: '#6366f1', data: data.saarthi },
      { key: 'rakshak', name: 'SP RAKSHAK', icon: '🛡️', role: 'Guardian', color: '#10b981', data: data.rakshak },
      { key: 'niyojak', name: 'SP NIYOJAK', icon: '📝', role: 'Planner', color: '#3b82f6', data: data.niyojak },
      { key: 'samanvayak', name: 'SP SAMANVAYAK', icon: '👔', role: 'Manager', color: '#f59e0b', data: data.samanvayak },
      { key: 'vikas', name: 'SP VIKAS', icon: '👷', role: 'Development Worker', color: '#8b5cf6', data: data.vikas }
    ];

    grid.innerHTML = agents.map(a => `
      <div class="agent-card">
        <div class="agent-card-header">
          <div class="agent-icon" style="background:${a.color}20; border:1px solid ${a.color}40;">${a.icon}</div>
          <div><h3>${a.name}</h3><div class="role">${a.role} • ${a.data?.status || 'IDLE'}</div></div>
        </div>
        <div class="agent-stats">
          <div class="agent-stat"><span>Status</span><span><span class="dot ${a.data?.status === 'BUSY' ? 'yellow' : a.data?.status === 'ERROR' ? 'red' : 'green'}"></span> ${a.data?.status || 'IDLE'}</span></div>
          <div class="agent-stat"><span>Current Task</span><span>${a.data?.currentTask ? a.data.currentTask.slice(0,16)+'...' : 'None'}</span></div>
          <div class="agent-stat"><span>Completed</span><span>${a.data?.stats?.tasksCompleted || a.data?.completedTasks || a.data?.plansCreated || 0}</span></div>
          <div class="agent-stat"><span>Failed</span><span>${a.data?.stats?.tasksFailed || 0}</span></div>
          ${a.key === 'rakshak' ? `<div class="agent-stat"><span>Blocked</span><span>${a.data?.blockedCount || 0}</span></div><div class="agent-stat"><span>Allowed</span><span>${a.data?.allowedCount || 0}</span></div>` : ''}
          ${a.key === 'samanvayak' ? `<div class="agent-stat"><span>Running</span><span>${a.data?.runningCount || 0}</span></div><div class="agent-stat"><span>Queue</span><span>${a.data?.queueLength || 0}</span></div>` : ''}
          <div class="agent-stat"><span>Description</span><span style="text-align:right; max-width:180px;">${a.data?.description || ''}</span></div>
        </div>
      </div>
    `).join('');

  } catch (err) {
    toast('Failed to load agents: ' + err.message, 'error');
  }
}

async function loadLogs() {
  try {
    const taskFilter = $('#logTaskFilter').value;
    const url = taskFilter ? `/logs?taskId=${taskFilter}&limit=200` : '/logs?limit=200';
    const data = await apiGet(url);
    $('#logViewer').textContent = data.logs.length ? data.logs.join('\n') : 'No logs yet';

    // Populate task filter
    const tasks = await apiGet('/tasks?limit=50');
    const select = $('#logTaskFilter');
    const current = select.value;
    select.innerHTML = '<option value="">All Logs</option>' + tasks.tasks.map(t => `<option value="${t.task_id}" ${current===t.task_id?'selected':''}>${t.task_id.slice(0,16)}... - ${t.command.slice(0,30)}</option>`).join('');

  } catch (err) {
    $('#logViewer').textContent = 'Failed to load logs: ' + err.message;
  }
}

async function loadCommunication() {
  try {
    const data = await apiGet('/communication?limit=100');
    $('#commStats').innerHTML = `
      <div class="comm-stat"><div style="font-size:20px; font-weight:700;">${data.stats.totalMessages}</div><div style="font-size:11px; color:var(--text2);">Total Messages</div></div>
      <div class="comm-stat"><div style="font-size:14px; font-weight:600;">${data.stats.registeredAgents.join(', ')}</div><div style="font-size:11px; color:var(--text2);">Registered Agents</div></div>
      <div class="comm-stat"><div style="font-size:12px;">${data.stats.lastMessage ? data.stats.lastMessage.type : 'None'}</div><div style="font-size:11px; color:var(--text2);">Last Message Type</div></div>
    `;
    const msgs = data.messages.slice().reverse();
    $('#commMessages').innerHTML = msgs.length ? msgs.map(m => `
      <div class="comm-msg">
        <div class="comm-msg-header"><span>${m.from} → ${m.to} [${m.type}]</span><span>${timeAgo(m.timestamp)}</span></div>
        <div class="comm-msg-body">${escapeHtml(JSON.stringify(m.payload).slice(0, 200))}${JSON.stringify(m.payload).length>200?'...':''}</div>
        ${m.taskId ? `<div style="font-size:10px; color:var(--text3); margin-top:4px;">Task: ${m.taskId.slice(0,20)}...</div>` : ''}
      </div>
    `).join('') : '<div class="empty">No communication yet</div>';
  } catch (err) {
    toast('Failed to load communication: ' + err.message, 'error');
  }
}

async function loadSettings() {
  try {
    const safeMode = await apiGet('/safe-mode');
    $('#settingSafeMode').textContent = safeMode.enabled ? 'ON - Protected' : 'OFF - Unsafe';
    $('#settingSafeMode').style.color = safeMode.enabled ? 'var(--green)' : 'var(--red)';
  } catch (err) {
    toast('Failed to load settings: ' + err.message, 'error');
  }
}

// Command execution
async function executeCommand(asyncMode = false) {
  const input = $('#commandInput');
  const cmd = input.value.trim();
  if (!cmd) { toast('Please enter a command', 'warn'); return; }

  const resultEl = $('#commandResult');
  resultEl.classList.remove('hidden');
  resultEl.innerHTML = '<div style="text-align:center; padding:20px;">⏳ Processing command...<br><small>SP Saarthi is orchestrating: SAARTHI → RAKSHAK → NIYOJAK → SAMANVAYAK → VIKAS</small></div>';

  try {
    if (asyncMode) {
      const data = await apiPost('/tasks', { command: cmd });
      resultEl.innerHTML = `<div style="color:var(--green);">✅ Task accepted (Async)</div><pre>Task ID: ${data.task_id}\nStatus: ${data.status}\nPoll: ${data.poll_url}\n\nTask is running in background. Check Tasks tab for progress.</pre>`;
      toast('Task queued: ' + data.task_id.slice(0,16), 'success');
      // Poll for result
      pollTask(data.task_id, resultEl);
    } else {
      const report = await apiPost('/execute', { command: cmd });
      if (report.success) {
        resultEl.innerHTML = `<div style="color:var(--green); font-weight:700; margin-bottom:10px;">✅ ${escapeHtml(report.summary || 'Task completed successfully')}</div>
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(120px,1fr)); gap:10px; margin-bottom:12px; font-size:12px;">
            <div>Duration: ${report.duration}ms</div><div>Steps: ${report.execution.completedSteps}/${report.execution.totalSteps}</div><div>Findings: ${report.findings.length}</div><div>Safe Mode: ${report.safeMode ? 'ON' : 'OFF'}</div>
          </div>
          <div style="margin-bottom:12px;"><strong>Findings (${report.findings.length}):</strong><pre>${report.findings.map((f,i)=>`${i+1}. ${f}`).join('\n') || 'None'}</pre></div>
          <div style="margin-bottom:12px;"><strong>Suggestions:</strong><pre>${report.suggestions.map((s,i)=>`${i+1}. ${s}`).join('\n') || 'None'}</pre></div>
          <details><summary style="cursor:pointer; font-weight:600;">Detailed Report</summary><pre style="margin-top:8px; max-height:400px; overflow-y:auto;">${escapeHtml(report.report || JSON.stringify(report, null, 2).slice(0,5000))}</pre></details>
        `;
        toast('Command executed successfully', 'success');
      } else {
        resultEl.innerHTML = `<div style="color:var(--red); font-weight:700;">❌ Task failed or blocked</div><pre>${escapeHtml(report.reason || report.error || JSON.stringify(report, null, 2).slice(0,2000))}</pre>`;
        toast('Command failed: ' + (report.reason || report.error), 'error');
      }
      loadDashboard();
    }
  } catch (err) {
    resultEl.innerHTML = `<div style="color:var(--red);">❌ Error: ${escapeHtml(err.message)}</div>`;
    toast('Execution failed: ' + err.message, 'error');
  }
}

async function pollTask(taskId, resultEl) {
  let attempts = 0;
  const interval = setInterval(async () => {
    attempts++;
    if (attempts > 60) { clearInterval(interval); return; }
    try {
      const task = await apiGet(`/tasks/${taskId}`);
      if (task.status === 'COMPLETED' || task.status === 'FAILED') {
        clearInterval(interval);
        if (task.result?.success) {
          resultEl.innerHTML = `<div style="color:var(--green); font-weight:700;">✅ Task ${task.status}</div><pre>${escapeHtml(task.result.summary || '')}\n\nFindings:\n${(task.result.findings||[]).map((f,i)=>`${i+1}. ${f}`).join('\n')}\n\nReport:\n${escapeHtml((task.result.report||'').slice(0,3000))}</pre>`;
          toast('Task completed: ' + taskId.slice(0,16), 'success');
        } else {
          resultEl.innerHTML = `<div style="color:${task.status==='FAILED'?'var(--red)':'var(--yellow)'}">Status: ${task.status}</div><pre>${escapeHtml(JSON.stringify(task.result||task.error||{}, null,2).slice(0,2000))}</pre>`;
        }
        loadDashboard();
      } else {
        resultEl.innerHTML = `<div>⏳ Task ${task.status}... (${attempts}s)<br><small>Current step: ${task.current_step}/${task.steps?.length||0} - ${task.steps?.[task.current_step]?.title||''}</small><br><div style="margin-top:8px; background:var(--bg); height:6px; border-radius:3px; overflow:hidden;"><div style="width:${Math.round((task.current_step/(task.steps?.length||1))*100)}%; height:100%; background:var(--primary);"></div></div></div>`;
      }
    } catch (e) {
      console.error('Poll failed', e);
    }
  }, 2000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff/1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s/60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m/60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h/24)}d ago`;
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  // Nav
  $$('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Command
  $('#sendCommand').addEventListener('click', () => executeCommand(false));
  $('#sendCommandAsync').addEventListener('click', () => executeCommand(true));
  $('#commandInput').addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') executeCommand(false);
  });
  $$('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $('#commandInput').value = chip.dataset.cmd;
      executeCommand(false);
    });
  });

  // Safe mode toggle
  $('#toggleSafeMode').addEventListener('click', async () => {
    try {
      const res = await apiPost('/safe-mode/toggle', {});
      toast(res.message, res.enabled ? 'success' : 'warn');
      loadDashboard();
    } catch (e) { toast(e.message, 'error'); }
  });
  $('#settingToggleSafe')?.addEventListener('click', async () => {
    try {
      const res = await apiPost('/safe-mode/toggle', {});
      toast(res.message, res.enabled ? 'success' : 'warn');
      loadSettings();
      loadDashboard();
    } catch (e) { toast(e.message, 'error'); }
  });

  // Tasks
  $('#refreshTasks')?.addEventListener('click', loadDashboard);
  $('#refreshAllTasks')?.addEventListener('click', loadAllTasks);
  $('#clearCompleted')?.addEventListener('click', async () => {
    try {
      const res = await apiPost('/tasks/clear/completed', {});
      toast(res.message, 'success');
      loadAllTasks();
    } catch (e) { toast(e.message, 'error'); }
  });
  $$('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      loadAllTasks();
    });
  });
  $('#closeTaskDetail')?.addEventListener('click', () => $('#taskDetailCard').classList.add('hidden'));

  // Logs
  $('#refreshLogs')?.addEventListener('click', loadLogs);
  $('#logTaskFilter')?.addEventListener('change', loadLogs);

  // Communication
  $('#refreshComm')?.addEventListener('click', loadCommunication);

  // Settings
  $('#settingClearTasks')?.addEventListener('click', async () => {
    try {
      const res = await apiPost('/tasks/clear/completed', {});
      toast(res.message, 'success');
    } catch (e) { toast(e.message, 'error'); }
  });

  // Initial load
  loadDashboard();

  // Auto refresh dashboard every 5s
  refreshInterval = setInterval(() => {
    const activeView = document.querySelector('.view.active');
    if (activeView?.id === 'view-dashboard') loadDashboard();
  }, 5000);
});
