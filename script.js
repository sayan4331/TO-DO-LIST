// ===== Taskflow — Premium To-Do List =====
// Persistent, animated, feature-rich task manager

(function () {
  'use strict';

  // ── Constants ──
  const STORAGE_KEY = 'taskflow_tasks';
  const CIRCUMFERENCE = 2 * Math.PI * 22; // r=22

  // ── DOM Cache ──
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const taskInput = $('#taskInput');
  const btnAdd = $('#btnAdd');
  const taskList = $('#taskList');
  const searchInput = $('#searchInput');
  const categorySelect = $('#categorySelect');
  const dueDateInput = $('#dueDateInput');
  const toastContainer = $('#toastContainer');
  const progressRing = $('#progressRing');
  const progressPercent = $('#progressPercent');
  const progressDetail = $('#progressDetail');

  // Stats
  const statTotal = $('#statTotal');
  const statCompleted = $('#statCompleted');
  const statPending = $('#statPending');

  // Counts in filter buttons
  const countAll = $('#countAll');
  const countActive = $('#countActive');
  const countCompleted = $('#countCompleted');

  // ── State ──
  let tasks = [];
  let currentFilter = 'all';
  let currentSearch = '';
  let selectedPriority = 'low';
  let undoStack = [];

  // ── Initialize ──
  function init() {
    loadTasks();
    render();
    bindEvents();
  }

  // ── Persistence ──
  function loadTasks() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      tasks = data ? JSON.parse(data) : [];
    } catch {
      tasks = [];
    }
  }

  function saveTasks() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  }

  // ── Event Binding ──
  function bindEvents() {
    // Add task
    btnAdd.addEventListener('click', addTask);
    taskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addTask();
    });

    // Priority buttons
    $$('.priority-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.priority-btn').forEach((b) => b.classList.remove('active', 'high', 'medium', 'low'));
        const p = btn.dataset.priority;
        btn.classList.add('active', p);
        selectedPriority = p;
      });
    });

    // Filter buttons
    $$('.filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        render();
      });
    });

    // Search
    searchInput.addEventListener('input', (e) => {
      currentSearch = e.target.value.toLowerCase().trim();
      render();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Ctrl+Z → Undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
        return;
      }
      // "/" → focus search (when not already in an input)
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
        e.preventDefault();
        searchInput.focus();
      }
    });
  }

  // ── Add Task ──
  function addTask() {
    const text = taskInput.value.trim();
    if (!text) {
      shakeElement(taskInput);
      showToast('Please enter a task', 'error');
      return;
    }

    const task = {
      id: generateId(),
      text,
      completed: false,
      priority: selectedPriority,
      category: categorySelect.value,
      dueDate: dueDateInput.value || null,
      createdAt: Date.now(),
    };

    tasks.unshift(task);
    saveTasks();
    render();

    // Reset input
    taskInput.value = '';
    dueDateInput.value = '';
    taskInput.focus();

    showToast(`Task added: "${truncate(text, 30)}"`, 'success');
  }

  // ── Toggle Complete ──
  function toggleComplete(id) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;

    pushUndo('toggle', { ...task });
    task.completed = !task.completed;
    saveTasks();
    render();

    if (task.completed) {
      showToast(`Completed: "${truncate(task.text, 30)}"`, 'success');
      spawnConfetti();
    }
  }

  // ── Delete Task ──
  function deleteTask(id) {
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx === -1) return;

    const removed = tasks[idx];
    pushUndo('delete', { ...removed, _index: idx });

    // Animate removal
    const el = taskList.querySelector(`[data-id="${id}"]`);
    if (el) {
      el.classList.add('removing');
      el.addEventListener('animationend', () => {
        tasks.splice(tasks.indexOf(removed), 1);
        saveTasks();
        render();
      }, { once: true });
    } else {
      tasks.splice(idx, 1);
      saveTasks();
      render();
    }

    showToast(`Deleted: "${truncate(removed.text, 30)}"`, 'info', true);
  }

  // ── Edit Task ──
  function startEdit(id) {
    const el = taskList.querySelector(`[data-id="${id}"]`);
    if (!el) return;

    el.classList.add('editing');
    const input = el.querySelector('.edit-input');
    const task = tasks.find((t) => t.id === id);
    input.value = task.text;
    input.focus();
    input.select();

    const finishEdit = () => {
      const newText = input.value.trim();
      if (newText && newText !== task.text) {
        pushUndo('edit', { ...task });
        task.text = newText;
        saveTasks();
        showToast('Task updated', 'success');
      }
      render();
    };

    input.addEventListener('blur', finishEdit, { once: true });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      }
      if (e.key === 'Escape') {
        input.value = task.text; // revert
        input.blur();
      }
    });
  }

  // ── Undo System ──
  function pushUndo(action, data) {
    undoStack.push({ action, data, timestamp: Date.now() });
    // Keep stack manageable
    if (undoStack.length > 20) undoStack.shift();
  }

  function undo() {
    if (undoStack.length === 0) {
      showToast('Nothing to undo', 'info');
      return;
    }

    const entry = undoStack.pop();

    switch (entry.action) {
      case 'delete': {
        const { _index, ...taskData } = entry.data;
        tasks.splice(_index, 0, taskData);
        break;
      }
      case 'toggle': {
        const t = tasks.find((t) => t.id === entry.data.id);
        if (t) t.completed = entry.data.completed;
        break;
      }
      case 'edit': {
        const t = tasks.find((t) => t.id === entry.data.id);
        if (t) t.text = entry.data.text;
        break;
      }
    }

    saveTasks();
    render();
    showToast('Action undone', 'info');
  }

  // ── Render ──
  function render() {
    const filtered = getFilteredTasks();
    updateStats();
    updateProgress();
    renderTaskList(filtered);
  }

  function getFilteredTasks() {
    return tasks.filter((task) => {
      // Filter
      if (currentFilter === 'active' && task.completed) return false;
      if (currentFilter === 'completed' && !task.completed) return false;

      // Search
      if (currentSearch && !task.text.toLowerCase().includes(currentSearch)) return false;

      return true;
    });
  }

  function renderTaskList(filtered) {
    if (filtered.length === 0) {
      taskList.innerHTML = renderEmptyState();
      return;
    }

    // Sort: incomplete first (high→medium→low), then completed
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const sorted = [...filtered].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    taskList.innerHTML = sorted.map((task, i) => renderTaskItem(task, i)).join('');

    // Bind per-item events
    taskList.querySelectorAll('.task-item').forEach((el) => {
      const id = el.dataset.id;

      el.querySelector('.task-checkbox input').addEventListener('change', () => toggleComplete(id));
      el.querySelector('.action-btn.edit').addEventListener('click', () => startEdit(id));
      el.querySelector('.action-btn.delete').addEventListener('click', () => deleteTask(id));
    });
  }

  function renderTaskItem(task, index) {
    const categoryLabel = getCategoryLabel(task.category);
    const dueDateInfo = getDueDateInfo(task.dueDate);

    return `
      <div class="task-item ${task.completed ? 'completed' : ''} priority-${task.priority}"
           data-id="${task.id}" style="animation-delay: ${index * 40}ms">
        <label class="task-checkbox">
          <input type="checkbox" ${task.completed ? 'checked' : ''} aria-label="Mark as ${task.completed ? 'incomplete' : 'complete'}">
          <span class="checkmark"></span>
        </label>
        <div class="task-content">
          <span class="task-text">${escapeHTML(task.text)}</span>
          <input class="edit-input" type="text" aria-label="Edit task text">
          <div class="task-meta">
            ${categoryLabel ? `<span class="task-badge category">${categoryLabel}</span>` : ''}
            ${dueDateInfo ? `<span class="task-badge due-date ${dueDateInfo.status}">${dueDateInfo.label}</span>` : ''}
          </div>
        </div>
        <div class="task-actions">
          <button class="action-btn edit" title="Edit task" aria-label="Edit task">✎</button>
          <button class="action-btn delete" title="Delete task" aria-label="Delete task">✕</button>
        </div>
      </div>
    `;
  }

  function renderEmptyState() {
    if (currentSearch) {
      return `
        <div class="empty-state">
          <span class="empty-icon">🔍</span>
          <h3>No matching tasks</h3>
          <p>Try a different search term</p>
        </div>
      `;
    }

    if (currentFilter === 'completed') {
      return `
        <div class="empty-state">
          <span class="empty-icon">🎯</span>
          <h3>No completed tasks yet</h3>
          <p>Check off tasks to see them here</p>
        </div>
      `;
    }

    if (currentFilter === 'active') {
      return `
        <div class="empty-state">
          <span class="empty-icon">🎉</span>
          <h3>All tasks completed!</h3>
          <p>You're all caught up — great work!</p>
        </div>
      `;
    }

    return `
      <div class="empty-state">
        <span class="empty-icon">📝</span>
        <h3>Your task list is empty</h3>
        <p>Add your first task above to get started</p>
      </div>
    `;
  }

  // ── Stats & Progress ──
  function updateStats() {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.completed).length;
    const pending = total - completed;

    animateNumber(statTotal, total);
    animateNumber(statCompleted, completed);
    animateNumber(statPending, pending);

    countAll.textContent = total;
    countActive.textContent = pending;
    countCompleted.textContent = completed;
  }

  function updateProgress() {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.completed).length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

    const offset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;
    progressRing.style.strokeDashoffset = offset;
    progressPercent.textContent = `${pct}%`;

    if (total === 0) {
      progressDetail.textContent = 'No tasks yet — add one to start!';
    } else if (completed === total) {
      progressDetail.textContent = '🎉 All tasks completed! Amazing!';
    } else {
      progressDetail.textContent = `${completed} of ${total} tasks completed`;
    }
  }

  // ── Helpers ──
  function generateId() {
    return `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function truncate(str, max) {
    return str.length > max ? str.slice(0, max) + '…' : str;
  }

  function getCategoryLabel(cat) {
    const map = {
      work: '💼 Work',
      personal: '🏠 Personal',
      health: '💪 Health',
      study: '📚 Study',
      finance: '💰 Finance',
      social: '👥 Social',
    };
    return map[cat] || '';
  }

  function getDueDateInfo(dateStr) {
    if (!dateStr) return null;

    const due = new Date(dateStr + 'T23:59:59');
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const diff = Math.ceil((dueDay - today) / (1000 * 60 * 60 * 24));

    const options = { month: 'short', day: 'numeric' };
    const label = due.toLocaleDateString('en-US', options);

    if (diff < 0) return { label: `Overdue · ${label}`, status: 'overdue' };
    if (diff === 0) return { label: `Today · ${label}`, status: 'today' };
    if (diff === 1) return { label: `Tomorrow · ${label}`, status: '' };
    return { label, status: '' };
  }

  function animateNumber(el, target) {
    const current = parseInt(el.textContent) || 0;
    if (current === target) return;

    const duration = 400;
    const startTime = performance.now();

    function step(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(current + (target - current) * eased);
      if (progress < 1) requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  }

  // ── Toast Notifications ──
  function showToast(message, type = 'info', showUndo = false) {
    const icons = { success: '✓', error: '✗', info: 'ℹ' };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <span>${escapeHTML(message)}</span>
      ${showUndo ? '<button class="undo-btn">Undo</button>' : ''}
    `;

    if (showUndo) {
      toast.querySelector('.undo-btn').addEventListener('click', () => {
        undo();
        dismissToast(toast);
      });
    }

    toastContainer.appendChild(toast);

    // Auto-dismiss
    const timer = setTimeout(() => dismissToast(toast), 3500);
    toast._timer = timer;
  }

  function dismissToast(toast) {
    if (!toast.parentNode) return;
    clearTimeout(toast._timer);
    toast.classList.add('removing');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }

  // ── Micro-interactions ──
  function shakeElement(el) {
    el.style.animation = 'none';
    el.offsetHeight; // reflow
    el.style.animation = 'shake 0.4s ease';
    el.addEventListener('animationend', () => (el.style.animation = ''), { once: true });
  }

  function spawnConfetti() {
    const colors = ['#a855f7', '#6c5ce7', '#22c55e', '#f59e0b', '#3b82f6', '#ec4899'];
    const container = document.body;

    for (let i = 0; i < 12; i++) {
      const particle = document.createElement('div');
      particle.textContent = ['✦', '●', '◆', '★'][Math.floor(Math.random() * 4)];
      Object.assign(particle.style, {
        position: 'fixed',
        left: `${40 + Math.random() * 20}%`,
        top: `${50 + Math.random() * 20}%`,
        color: colors[Math.floor(Math.random() * colors.length)],
        fontSize: `${0.6 + Math.random() * 0.8}rem`,
        pointerEvents: 'none',
        zIndex: '9999',
        animation: `confetti ${0.6 + Math.random() * 0.5}s ease forwards`,
        animationDelay: `${Math.random() * 0.2}s`,
      });
      container.appendChild(particle);
      particle.addEventListener('animationend', () => particle.remove());
    }
  }

  // Add shake keyframes dynamically
  const shakeStyle = document.createElement('style');
  shakeStyle.textContent = `
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      20% { transform: translateX(-6px); }
      40% { transform: translateX(6px); }
      60% { transform: translateX(-4px); }
      80% { transform: translateX(4px); }
    }
  `;
  document.head.appendChild(shakeStyle);

  // ── Boot ──
  document.addEventListener('DOMContentLoaded', init);
})();
