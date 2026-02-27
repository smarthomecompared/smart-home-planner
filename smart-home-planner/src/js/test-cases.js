let testCases = [];
let testCaseRuns = [];
let settings = {};
let renderedRecords = [];
let runningTestCaseId = '';
let editingRunId = '';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const HEALTH_PRIORITY = {
    failed: 0,
    overdue: 1,
    'due-soon': 2,
    healthy: 3,
    disabled: 4
};

const TEST_CASE_PRIORITY_SORT = {
    high: 0,
    medium: 1,
    low: 2
};

const LAST_RUN_STATUS_SORT = {
    fail: 0,
    blocked: 1,
    pass: 2,
    'not-run': 3
};

document.addEventListener('DOMContentLoaded', async () => {
    initializeEventListeners();
    await loadState();
    renderPage();
});

function initializeEventListeners() {
    const searchInput = document.getElementById('test-case-search');
    if (searchInput) {
        searchInput.addEventListener('input', renderPage);
    }

    const categoryFilter = document.getElementById('test-case-category-filter');
    if (categoryFilter) {
        categoryFilter.addEventListener('change', renderPage);
    }

    const priorityFilter = document.getElementById('test-case-priority-filter');
    if (priorityFilter) {
        priorityFilter.addEventListener('change', renderPage);
    }

    const healthFilter = document.getElementById('test-case-health-filter');
    if (healthFilter) {
        healthFilter.addEventListener('change', renderPage);
    }

    const sortByInput = document.getElementById('test-case-sort-by');
    if (sortByInput) {
        sortByInput.addEventListener('change', renderPage);
    }

    const sortDirectionInput = document.getElementById('test-case-sort-direction');
    if (sortDirectionInput) {
        sortDirectionInput.addEventListener('change', renderPage);
    }

    const list = document.getElementById('test-cases-list');
    if (list) {
        list.addEventListener('click', (event) => {
            void handleListAction(event);
        });
    }

    initializeRunModalEvents();

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        closeRunModal();
    });
}

function initializeRunModalEvents() {
    const modal = document.getElementById('test-case-run-modal');
    if (!modal) return;

    const closeBtn = document.getElementById('test-case-run-modal-close');
    const cancelBtn = document.getElementById('test-case-run-modal-cancel');
    const saveBtn = document.getElementById('test-case-run-modal-save');
    const overlay = document.getElementById('test-case-run-modal-overlay');

    if (closeBtn) closeBtn.addEventListener('click', closeRunModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeRunModal);
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            void saveTestCaseRun();
        });
    }
}

async function loadState() {
    const data = await loadData();
    settings = await loadSettings();

    testCases = normalizeTestCases(data.testCases || []);
    testCaseRuns = normalizeTestCaseRuns(data.testCaseRuns || []);

    populateCategoryControls();
}

function normalizeTestCases(source) {
    return [...(source || [])]
        .map((item, index) => normalizeTestCase(item, index))
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function normalizeTestCase(item, index) {
    if (!item || typeof item !== 'object') return null;
    const id = String(item.id || '').trim() || buildId('test-case', index);
    const name = String(item.name || '').trim();
    if (!name) return null;

    const frequency = Number.parseInt(item.frequencyDays, 10);

    return {
        id,
        name,
        category: String(item.category || '').trim() || 'General',
        priority: normalizeTestCasePriority(item.priority),
        description: String(item.description || '').trim(),
        steps: String(item.steps || '').trim(),
        expectedResult: String(item.expectedResult || '').trim(),
        frequencyDays: Number.isFinite(frequency) && frequency > 0 ? frequency : 180,
        enabled: item.enabled !== false,
        createdAt: normalizeIsoDate(item.createdAt) || new Date().toISOString(),
        updatedAt: normalizeIsoDate(item.updatedAt) || normalizeIsoDate(item.createdAt) || new Date().toISOString()
    };
}

function normalizeTestCaseRuns(source) {
    return [...(source || [])]
        .map((item, index) => normalizeTestCaseRun(item, index))
        .filter(Boolean)
        .sort((a, b) => {
            const left = Date.parse(a.executedAt || '');
            const right = Date.parse(b.executedAt || '');
            const leftValue = Number.isFinite(left) ? left : 0;
            const rightValue = Number.isFinite(right) ? right : 0;
            return rightValue - leftValue;
        });
}

function normalizeTestCaseRun(item, index) {
    if (!item || typeof item !== 'object') return null;
    const testCaseId = String(item.testCaseId || '').trim();
    if (!testCaseId) return null;

    const normalizedStatus = normalizeRunStatus(item.status);

    return {
        id: String(item.id || '').trim() || buildId('test-run', index),
        testCaseId,
        status: normalizedStatus,
        notes: String(item.notes || '').trim(),
        executedAt: normalizeIsoDate(item.executedAt) || new Date().toISOString(),
        createdAt: normalizeIsoDate(item.createdAt) || normalizeIsoDate(item.executedAt) || new Date().toISOString()
    };
}

function normalizeRunStatus(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'fail') return 'fail';
    if (normalized === 'blocked') return 'blocked';
    return 'pass';
}

function normalizeTestCasePriority(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'high') return 'high';
    if (normalized === 'low') return 'low';
    return 'medium';
}

function formatTestCasePriority(value) {
    const normalized = normalizeTestCasePriority(value);
    if (normalized === 'high') return 'High';
    if (normalized === 'low') return 'Low';
    return 'Medium';
}

function normalizeIsoDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString();
}

function buildId(prefix, seed = 0) {
    const random = Math.random().toString(36).slice(2, 7);
    return `${prefix}-${Date.now()}-${seed}-${random}`;
}

function getCategories() {
    const fromSettings = Array.isArray(settings?.testCaseCategories)
        ? settings.testCaseCategories.map((value) => String(value || '').trim()).filter(Boolean)
        : [];
    const fromTestCases = testCases.map((item) => String(item?.category || '').trim()).filter(Boolean);
    const merged = Array.from(new Set([...fromSettings, ...fromTestCases, 'General']));
    return merged.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function populateCategoryControls() {
    const categories = getCategories();

    const filter = document.getElementById('test-case-category-filter');
    if (filter) {
        const previous = String(filter.value || 'all');
        filter.innerHTML = ['<option value="all">All Categories</option>', ...categories.map((category) => (
            `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`
        ))].join('');
        const hasPrevious = previous === 'all' || categories.includes(previous);
        filter.value = hasPrevious ? previous : 'all';
    }
}

function buildRecords() {
    const runsByTest = new Map();
    testCaseRuns.forEach((run) => {
        if (!run || !run.testCaseId) return;
        if (!runsByTest.has(run.testCaseId)) {
            runsByTest.set(run.testCaseId, []);
        }
        runsByTest.get(run.testCaseId).push(run);
    });

    const today = startOfDay(new Date());

    return testCases.map((testCase) => {
        const runs = (runsByTest.get(testCase.id) || [])
            .slice()
            .sort((a, b) => Date.parse(b.executedAt || '') - Date.parse(a.executedAt || ''));
        const latestRun = runs.length ? runs[0] : null;
        const nextDueDate = computeNextDueDate(testCase, latestRun);
        const daysUntilDue = nextDueDate ? diffDays(today, startOfDay(nextDueDate)) : null;
        const health = determineHealth(testCase, latestRun, daysUntilDue);

        const searchableText = [
            testCase.name,
            testCase.category,
            formatTestCasePriority(testCase.priority),
            testCase.description,
            testCase.steps,
            testCase.expectedResult,
            ...runs.slice(0, 3).map((run) => run.notes)
        ]
            .map((value) => String(value || '').trim().toLowerCase())
            .filter(Boolean)
            .join(' ');

        return {
            testCase,
            runs,
            latestRun,
            nextDueDate,
            daysUntilDue,
            health,
            searchableText
        };
    });
}

function determineHealth(testCase, latestRun, daysUntilDue) {
    if (testCase.enabled === false) return 'disabled';
    if (latestRun && latestRun.status === 'fail') return 'failed';
    if (Number.isFinite(daysUntilDue) && daysUntilDue < 0) return 'overdue';
    if (Number.isFinite(daysUntilDue) && daysUntilDue <= 7) return 'due-soon';
    return 'healthy';
}

function startOfDay(value) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
}

function diffDays(fromDate, toDate) {
    return Math.round((toDate.getTime() - fromDate.getTime()) / MS_PER_DAY);
}

function computeNextDueDate(testCase, latestRun) {
    const anchorRaw = latestRun?.executedAt || testCase.updatedAt || testCase.createdAt;
    const anchor = new Date(anchorRaw);
    if (Number.isNaN(anchor.getTime())) return null;
    const next = new Date(anchor.getTime() + (testCase.frequencyDays * MS_PER_DAY));
    return Number.isNaN(next.getTime()) ? null : next;
}

function applyFilters(records) {
    const query = String(document.getElementById('test-case-search')?.value || '').trim().toLowerCase();
    const category = String(document.getElementById('test-case-category-filter')?.value || 'all');
    const priorityRaw = String(document.getElementById('test-case-priority-filter')?.value || 'all').trim().toLowerCase();
    const priority = priorityRaw === 'all' ? 'all' : normalizeTestCasePriority(priorityRaw);
    const health = String(document.getElementById('test-case-health-filter')?.value || 'all');
    const terms = query ? query.split(/\s+/).filter(Boolean) : [];

    return records.filter((record) => {
        if (category !== 'all' && record.testCase.category !== category) return false;
        if (priority !== 'all' && record.testCase.priority !== priority) return false;
        if (health !== 'all' && record.health !== health) return false;
        if (!terms.length) return true;
        return terms.every((term) => record.searchableText.includes(term));
    });
}

function getLatestRunStatusSortValue(record) {
    const status = record?.latestRun ? normalizeRunStatus(record.latestRun.status) : 'not-run';
    return LAST_RUN_STATUS_SORT[status] ?? 99;
}

function compareText(left, right) {
    return String(left || '').localeCompare(String(right || ''), undefined, { sensitivity: 'base' });
}

function compareDueDate(left, right) {
    const leftValue = left?.nextDueDate instanceof Date ? left.nextDueDate.getTime() : Number.POSITIVE_INFINITY;
    const rightValue = right?.nextDueDate instanceof Date ? right.nextDueDate.getTime() : Number.POSITIVE_INFINITY;
    return leftValue - rightValue;
}

function sortRecords(records) {
    const sortBy = String(document.getElementById('test-case-sort-by')?.value || 'health').trim();
    const sortDirection = String(document.getElementById('test-case-sort-direction')?.value || 'asc').trim().toLowerCase();
    const directionFactor = sortDirection === 'desc' ? -1 : 1;

    return [...records].sort((left, right) => {
        let result = 0;

        if (sortBy === 'category') {
            result = compareText(left.testCase.category, right.testCase.category);
        } else if (sortBy === 'priority') {
            const leftPriority = TEST_CASE_PRIORITY_SORT[left.testCase.priority] ?? 99;
            const rightPriority = TEST_CASE_PRIORITY_SORT[right.testCase.priority] ?? 99;
            result = leftPriority - rightPriority;
        } else if (sortBy === 'last-run-status') {
            result = getLatestRunStatusSortValue(left) - getLatestRunStatusSortValue(right);
        } else if (sortBy === 'next-due') {
            result = compareDueDate(left, right);
        } else {
            const leftHealth = HEALTH_PRIORITY[left.health] ?? 99;
            const rightHealth = HEALTH_PRIORITY[right.health] ?? 99;
            result = leftHealth - rightHealth;
            if (result === 0) {
                const leftPriority = TEST_CASE_PRIORITY_SORT[left.testCase.priority] ?? 99;
                const rightPriority = TEST_CASE_PRIORITY_SORT[right.testCase.priority] ?? 99;
                result = leftPriority - rightPriority;
            }
        }

        if (result !== 0) return result * directionFactor;

        const dueFallback = compareDueDate(left, right);
        if (dueFallback !== 0) return dueFallback * directionFactor;

        return compareText(left.testCase.name, right.testCase.name) * directionFactor;
    });
}

function renderPage() {
    const allRecords = buildRecords();
    const filteredRecords = applyFilters(allRecords);
    renderedRecords = sortRecords(filteredRecords);

    renderSummary(allRecords);
    renderList(renderedRecords);
}

function renderSummary(records) {
    const target = document.getElementById('test-cases-summary');
    if (!target) return;

    const total = records.length;
    const passed = records.filter((record) => record.latestRun && record.latestRun.status === 'pass').length;
    const failed = records.filter((record) => record.health === 'failed').length;
    const overdue = records.filter((record) => record.health === 'overdue').length;
    const dueSoon = records.filter((record) => record.health === 'due-soon').length;

    target.innerHTML = `
        <div class="test-summary-card">
            <div class="test-summary-label">Total Tests</div>
            <div class="test-summary-value">${total}</div>
        </div>
        <div class="test-summary-card success">
            <div class="test-summary-label">Passed</div>
            <div class="test-summary-value">${passed}</div>
        </div>
        <div class="test-summary-card error">
            <div class="test-summary-label">Failed</div>
            <div class="test-summary-value">${failed}</div>
        </div>
        <div class="test-summary-card warning">
            <div class="test-summary-label">Overdue</div>
            <div class="test-summary-value">${overdue}</div>
        </div>
        <div class="test-summary-card warning">
            <div class="test-summary-label">Due In 7 Days</div>
            <div class="test-summary-value">${dueSoon}</div>
        </div>
    `;
}

function renderList(records) {
    const list = document.getElementById('test-cases-list');
    const empty = document.getElementById('test-cases-empty');
    if (!list || !empty) return;

    if (!testCases.length) {
        list.innerHTML = '';
        empty.hidden = false;
        empty.querySelector('h3').textContent = 'No test cases yet';
        empty.querySelector('p').textContent = 'Create your first manual test to start tracking operational checks.';
        return;
    }

    if (!records.length) {
        list.innerHTML = '';
        empty.hidden = false;
        empty.querySelector('h3').textContent = 'No matching test cases';
        empty.querySelector('p').textContent = 'Adjust filters or search terms to see results.';
        return;
    }

    empty.hidden = true;

    list.innerHTML = records.map((record) => buildTestCaseCardMarkup(record)).join('');
}

function buildTestCaseCardMarkup(record) {
    const { testCase, latestRun, nextDueDate, daysUntilDue } = record;
    const isDisabled = testCase.enabled === false;
    const priorityValue = normalizeTestCasePriority(testCase.priority);
    const priorityLabel = formatTestCasePriority(priorityValue);
    const priorityClass = `priority-${priorityValue}`;
    const nextDueLabel = nextDueDate ? formatDate(nextDueDate.toISOString()) : 'Not scheduled';

    return `
        <article class="test-case-card${isDisabled ? ' is-disabled' : ''}" data-test-case-id="${escapeHtml(testCase.id)}">
            <div class="test-case-head">
                <div class="test-case-title-wrap">
                    <h3 class="test-case-title">${escapeHtml(testCase.name)}</h3>
                    ${testCase.description
                        ? `<div class="test-case-subtitle">${escapeHtml(testCase.description)}</div>`
                        : ''}
                    <div class="test-case-badges">
                        <span class="test-badge">${escapeHtml(testCase.category)}</span>
                        ${isDisabled ? '<span class="test-badge state-disabled">Disabled</span>' : ''}
                        <span class="test-badge ${escapeHtml(priorityClass)}">${escapeHtml(priorityLabel)} Priority</span>
                    </div>
                </div>
                <div class="test-case-actions">
                    <button class="btn btn-secondary btn-sm" type="button" data-test-case-action="edit">Edit</button>
                    <button class="btn btn-danger btn-sm" type="button" data-test-case-action="delete">Delete</button>
                </div>
            </div>

            <div class="test-case-body">
                <div class="test-case-meta-grid">
                    <div class="test-meta">
                        <span class="test-meta-label">Frequency</span>
                        <span class="test-meta-value">${escapeHtml(formatFrequencyLabel(testCase.frequencyDays))}</span>
                    </div>
                    ${isDisabled ? '' : `
                        <div class="test-meta">
                            <span class="test-meta-label">Next Due</span>
                            <span class="test-meta-value">${escapeHtml(nextDueLabel)}</span>
                        </div>
                        <div class="test-meta">
                            <span class="test-meta-label">Due Window</span>
                            ${buildDueWindowMarkup(daysUntilDue, testCase.enabled)}
                        </div>
                    `}
                </div>

                <div class="test-case-runs">
                    ${buildLastRunMarkup(latestRun)}
                </div>
            </div>
        </article>
    `;
}

function buildLastRunMarkup(latestRun) {
    if (!latestRun) {
        return `
            <div class="test-run-item is-empty">
                <div class="test-run-top">
                    <span class="test-run-status-chip not-run">Not Run</span>
                    <span class="test-run-date">No execution date</span>
                </div>
                <div class="test-run-notes-wrap">
                    <div class="test-run-notes-label">Notes</div>
                    <div class="test-run-details">No runs recorded yet.</div>
                </div>
            </div>
        `;
    }

    const status = normalizeRunStatus(latestRun.status);
    const statusLabel = formatRunStatus(status);
    const executedAtLabel = formatDateTime(latestRun.executedAt);
    const notes = latestRun.notes ? latestRun.notes : 'No notes';

    return `
        <div class="test-run-item status-${escapeHtml(status)}" data-test-run-id="${escapeHtml(latestRun.id)}">
            <div class="test-run-top">
                <span class="test-run-status-chip ${escapeHtml(status)}">${escapeHtml(statusLabel)}</span>
                <span class="test-run-date">${escapeHtml(executedAtLabel)}</span>
            </div>
            <div class="test-run-notes-wrap">
                <div class="test-run-notes-label">Notes</div>
                <div class="test-run-details">${escapeHtml(notes)}</div>
            </div>
        </div>
    `;
}

function formatRunStatus(value) {
    if (value === 'fail') return 'Fail';
    if (value === 'blocked') return 'Blocked';
    return 'Pass';
}

function formatDate(value) {
    const raw = typeof value === 'string' ? value : String(value || '');
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function formatDateTime(value) {
    const raw = typeof value === 'string' ? value : String(value || '');
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getDueWindowInfo(daysUntilDue, enabled) {
    if (!enabled) {
        return {
            text: 'Disabled',
            status: 'Disabled',
            stateClass: 'is-disabled'
        };
    }
    if (!Number.isFinite(daysUntilDue)) {
        return {
            text: 'Unknown',
            status: 'Unknown',
            stateClass: 'is-unknown'
        };
    }
    if (daysUntilDue < 0) {
        const lateDays = Math.abs(daysUntilDue);
        return {
            text: `${lateDays} day${lateDays === 1 ? '' : 's'} late`,
            status: 'Overdue',
            stateClass: 'is-overdue'
        };
    }
    if (daysUntilDue === 0) {
        return {
            text: 'Due today',
            status: 'Due Soon',
            stateClass: 'is-due-soon'
        };
    }
    if (daysUntilDue <= 7) {
        return {
            text: `${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'} remaining`,
            status: 'Due Soon',
            stateClass: 'is-due-soon'
        };
    }
    return {
        text: `${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'} remaining`,
        status: 'On Track',
        stateClass: 'is-healthy'
    };
}

function buildDueWindowMarkup(daysUntilDue, enabled) {
    const dueWindow = getDueWindowInfo(daysUntilDue, enabled);
    return `
        <span class="test-meta-value due-window-value ${escapeHtml(dueWindow.stateClass)}">
            <span class="due-window-state">${escapeHtml(dueWindow.status)}</span>
            <span class="due-window-text">${escapeHtml(dueWindow.text)}</span>
        </span>
    `;
}

function formatFrequencyLabel(frequencyDays) {
    const value = Number.parseInt(frequencyDays, 10);
    if (!Number.isFinite(value) || value < 1) return 'Every 30 days';
    if (value === 30) return 'Every 1 month';
    if (value === 90) return 'Every 3 months';
    if (value === 180) return 'Every 6 months';
    if (value === 365) return 'Every 1 year';
    return `Every ${value} day${value === 1 ? '' : 's'}`;
}

function formatMultiline(value) {
    return escapeHtml(String(value || '')).replace(/\n/g, '<br>');
}

function toLocalDateTimeValue(date = new Date()) {
    const value = new Date(date);
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    const hours = String(value.getHours()).padStart(2, '0');
    const minutes = String(value.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function localDateTimeToIso(value) {
    const raw = String(value || '').trim();
    if (!raw) return new Date().toISOString();
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
    return parsed.toISOString();
}

function openRunModal(testCaseId, runId = '') {
    const target = testCases.find((item) => item.id === testCaseId);
    if (!target) return;

    runningTestCaseId = testCaseId;
    editingRunId = String(runId || '').trim();

    const modal = document.getElementById('test-case-run-modal');
    const modalTitle = document.getElementById('test-case-run-modal-title');
    const subtitle = document.getElementById('test-case-run-modal-subtitle');
    const statusInput = document.getElementById('test-case-run-status');
    const runAtInput = document.getElementById('test-case-run-at');
    const notesInput = document.getElementById('test-case-run-notes');
    const saveBtn = document.getElementById('test-case-run-modal-save');

    if (!modal || !modalTitle || !subtitle || !statusInput || !runAtInput || !notesInput || !saveBtn) return;

    const existingRun = editingRunId
        ? testCaseRuns.find((run) => run.id === editingRunId && run.testCaseId === testCaseId)
        : null;

    subtitle.textContent = target.name;
    modalTitle.textContent = existingRun ? 'Edit Test Run' : 'Run Test Case';
    saveBtn.textContent = existingRun ? 'Save Changes' : 'Save Run';
    statusInput.value = existingRun ? normalizeRunStatus(existingRun.status) : 'pass';
    runAtInput.value = toLocalDateTimeValue(existingRun ? new Date(existingRun.executedAt) : new Date());
    notesInput.value = existingRun ? String(existingRun.notes || '') : '';

    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');

    requestAnimationFrame(() => {
        statusInput.focus();
    });
}

function closeRunModal() {
    const modal = document.getElementById('test-case-run-modal');
    const modalTitle = document.getElementById('test-case-run-modal-title');
    const saveBtn = document.getElementById('test-case-run-modal-save');
    if (!modal || modal.classList.contains('is-hidden')) return;
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
    runningTestCaseId = '';
    editingRunId = '';
    if (modalTitle) {
        modalTitle.textContent = 'Run Test Case';
    }
    if (saveBtn) {
        saveBtn.textContent = 'Save Run';
    }
}

async function saveTestCaseRun() {
    if (!runningTestCaseId) {
        closeRunModal();
        return;
    }

    const statusInput = document.getElementById('test-case-run-status');
    const runAtInput = document.getElementById('test-case-run-at');
    const notesInput = document.getElementById('test-case-run-notes');
    if (!statusInput || !runAtInput || !notesInput) return;

    const status = normalizeRunStatus(statusInput.value);
    const nextExecutedAt = localDateTimeToIso(runAtInput.value);
    const nextNotes = String(notesInput.value || '').trim();
    const now = new Date().toISOString();

    const wasEditing = Boolean(editingRunId);
    if (wasEditing) {
        const runIndex = testCaseRuns.findIndex((run) => run.id === editingRunId && run.testCaseId === runningTestCaseId);
        if (runIndex < 0) {
            notify('Test run not found.', 'error');
            closeRunModal();
            return;
        }
        const current = testCaseRuns[runIndex];
        testCaseRuns[runIndex] = {
            ...current,
            status,
            notes: nextNotes,
            executedAt: nextExecutedAt,
            updatedAt: now
        };
    } else {
        testCaseRuns.push({
            id: buildId('test-run'),
            testCaseId: runningTestCaseId,
            status,
            notes: nextNotes,
            executedAt: nextExecutedAt,
            createdAt: now
        });
    }

    testCaseRuns = normalizeTestCaseRuns(testCaseRuns);
    await persistTestData();

    closeRunModal();
    renderPage();
    notify(wasEditing ? 'Test run updated.' : 'Test run saved.', 'success');
}

async function deleteTestRun(testCaseId, runId) {
    const normalizedRunId = String(runId || '').trim();
    if (!normalizedRunId) return;
    const targetRun = testCaseRuns.find((run) => run.id === normalizedRunId && run.testCaseId === testCaseId);
    if (!targetRun) return;

    const confirmed = await showConfirm('Delete this test run?', {
        title: 'Delete test run',
        confirmText: 'Delete',
        cancelText: 'Cancel'
    });
    if (!confirmed) return;

    testCaseRuns = testCaseRuns.filter((run) => run.id !== normalizedRunId);
    await persistTestData();
    renderPage();
    notify('Test run deleted.', 'success');
}

async function deleteTestCase(testCaseId) {
    const target = testCases.find((item) => item.id === testCaseId);
    if (!target) return;

    const confirmed = await showConfirm(`Delete test case "${target.name}" and all its run history?`, {
        title: 'Delete test case',
        confirmText: 'Delete',
        cancelText: 'Cancel'
    });
    if (!confirmed) return;

    testCases = testCases.filter((item) => item.id !== testCaseId);
    testCaseRuns = testCaseRuns.filter((run) => run.testCaseId !== testCaseId);

    await persistTestData();
    populateCategoryControls();
    renderPage();
    notify('Test case deleted.', 'success');
}

async function persistTestData() {
    await saveData({
        testCases,
        testCaseRuns
    });
}

async function handleListAction(event) {
    const runActionBtn = event.target.closest('[data-test-run-action]');
    if (runActionBtn) {
        const runAction = runActionBtn.getAttribute('data-test-run-action');
        const runItem = runActionBtn.closest('.test-run-item');
        const card = runActionBtn.closest('.test-case-card');
        const testCaseId = String(card?.dataset.testCaseId || '').trim();
        const runId = String(runItem?.dataset.testRunId || '').trim();
        if (!testCaseId || !runId) return;

        if (runAction === 'edit') {
            openRunModal(testCaseId, runId);
            return;
        }
        if (runAction === 'delete') {
            await deleteTestRun(testCaseId, runId);
            return;
        }
    }

    const actionButton = event.target.closest('[data-test-case-action]');
    if (!actionButton) return;

    const card = actionButton.closest('.test-case-card');
    if (!card) return;

    const testCaseId = String(card.dataset.testCaseId || '').trim();
    if (!testCaseId) return;

    const action = actionButton.getAttribute('data-test-case-action');
    if (action === 'edit') {
        window.location.href = `test-case-add.html?id=${encodeURIComponent(testCaseId)}`;
        return;
    }
    if (action === 'delete') {
        await deleteTestCase(testCaseId);
        return;
    }
}

function notify(message, type = 'success') {
    const normalized = type === 'error' ? 'error' : 'success';
    if (typeof showToast === 'function') {
        showToast(message, normalized);
        return;
    }
    if (normalized === 'error') {
        console.error(message);
    } else {
        console.log(message);
    }
}
