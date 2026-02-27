let existingTestCaseId = '';
let workingTestCaseId = '';
let isAddMode = true;
let allTestCases = [];
let allTestCaseRuns = [];
let currentRunsPage = 1;
let editingRunId = '';

const FREQUENCY_PRESET_VALUES = ['30', '90', '180', '365'];
const RUNS_PAGE_SIZE = 8;

window.addEventListener('DOMContentLoaded', async () => {
    await initializeTestCaseForm();
});

window.addEventListener('pageshow', () => {
    const params = new URLSearchParams(window.location.search || '');
    if (String(params.get('id') || '').trim()) return;
    forceDefaultFrequencySelection();
});

async function initializeTestCaseForm() {
    const form = document.getElementById('test-case-add-form');
    if (!form) return;

    const params = new URLSearchParams(window.location.search || '');
    existingTestCaseId = String(params.get('id') || '').trim();
    isAddMode = !existingTestCaseId;

    const data = await loadData();
    const settings = await loadSettings();
    allTestCases = Array.isArray(data?.testCases) ? data.testCases : [];
    allTestCaseRuns = Array.isArray(data?.testCaseRuns) ? data.testCaseRuns : [];
    workingTestCaseId = existingTestCaseId || buildUniqueTestCaseId();

    populateCategorySelect(settings, allTestCases);
    initializeFrequencyControls();
    initializeRunsSectionEvents();
    initializeRunModalEvents();

    if (existingTestCaseId) {
        hydrateEditMode(allTestCases, existingTestCaseId);
    } else {
        hydrateAddMode();
    }
    setRunsSectionVisible(true);
    renderRunsTable();

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        await handleSubmit();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        closeRunModal();
    });
}

function getWorkingTestCaseId() {
    return String(workingTestCaseId || existingTestCaseId || '').trim();
}

function buildUniqueTestCaseId() {
    const existingIds = new Set(allTestCases.map((item) => String(item?.id || '').trim()).filter(Boolean));
    let nextId = buildTestCaseId();
    while (existingIds.has(nextId)) {
        nextId = buildTestCaseId();
    }
    return nextId;
}

function hydrateAddMode() {
    const title = document.getElementById('test-case-form-page-title');
    const submitBtn = document.getElementById('test-case-form-submit-btn');
    const priorityInput = document.getElementById('test-case-priority');
    const enabledInput = document.getElementById('test-case-enabled');
    if (title) title.textContent = 'Add Test Case';
    if (submitBtn) submitBtn.textContent = 'Save Test Case';
    if (priorityInput) priorityInput.value = 'medium';
    if (enabledInput) enabledInput.checked = true;
    document.title = 'Add Test Case - Smart Home Planner';
    forceDefaultFrequencySelection();
}

function hydrateEditMode(testCases, targetId) {
    const current = testCases.find((item) => String(item?.id || '').trim() === targetId);
    if (!current) {
        notify('Test case not found.', 'error');
        window.location.href = 'test-cases.html';
        return;
    }

    const title = document.getElementById('test-case-form-page-title');
    const submitBtn = document.getElementById('test-case-form-submit-btn');
    if (title) title.textContent = 'Edit Test Case';
    if (submitBtn) submitBtn.textContent = 'Save Changes';
    document.title = 'Edit Test Case - Smart Home Planner';

    const nameInput = document.getElementById('test-case-name');
    const categoryInput = document.getElementById('test-case-category');
    const priorityInput = document.getElementById('test-case-priority');
    const enabledInput = document.getElementById('test-case-enabled');
    const descriptionInput = document.getElementById('test-case-description');
    const stepsInput = document.getElementById('test-case-steps');
    const expectedInput = document.getElementById('test-case-expected');

    if (nameInput) nameInput.value = String(current.name || '').trim();
    if (categoryInput) {
        const categoryValue = String(current.category || '').trim();
        if (categoryValue) categoryInput.value = categoryValue;
    }
    if (priorityInput) {
        priorityInput.value = normalizeTestCasePriority(current.priority);
    }
    const frequency = Number.parseInt(current.frequencyDays, 10);
    setFrequencyValue(Number.isFinite(frequency) && frequency > 0 ? frequency : 180);
    if (enabledInput) enabledInput.checked = current.enabled !== false;
    if (descriptionInput) descriptionInput.value = String(current.description || '').trim();
    if (stepsInput) stepsInput.value = String(current.steps || '').trim();
    if (expectedInput) expectedInput.value = String(current.expectedResult || '').trim();
}

function populateCategorySelect(settings, testCases) {
    const select = document.getElementById('test-case-category');
    if (!select) return;

    const settingsCategories = Array.isArray(settings?.testCaseCategories)
        ? settings.testCaseCategories.map((value) => String(value || '').trim()).filter(Boolean)
        : [];
    const existingCategories = (testCases || [])
        .map((item) => String(item?.category || '').trim())
        .filter(Boolean);

    const categories = Array.from(new Set(['General', ...settingsCategories, ...existingCategories]))
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    select.innerHTML = categories.map((category) => (
        `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`
    )).join('');

    if (categories.length) {
        select.value = categories[0];
    }
}

function initializeFrequencyControls() {
    const presetInput = document.getElementById('test-case-frequency-preset');
    const daysInput = document.getElementById('test-case-frequency-days');
    const daysGroup = document.getElementById('test-case-frequency-days-group');
    if (!presetInput || !daysInput || !daysGroup) return;

    const toggleCustomDays = () => {
        const isCustom = presetInput.value === 'custom';
        daysGroup.hidden = !isCustom;
    };

    presetInput.addEventListener('change', toggleCustomDays);
    toggleCustomDays();
}

function forceDefaultFrequencySelection() {
    const presetInput = document.getElementById('test-case-frequency-preset');
    const daysInput = document.getElementById('test-case-frequency-days');
    const daysGroup = document.getElementById('test-case-frequency-days-group');
    if (!presetInput || !daysInput || !daysGroup) return;
    presetInput.value = '180';
    daysInput.value = '180';
    daysGroup.hidden = true;
}

function setFrequencyValue(days) {
    const presetInput = document.getElementById('test-case-frequency-preset');
    const daysInput = document.getElementById('test-case-frequency-days');
    const daysGroup = document.getElementById('test-case-frequency-days-group');
    if (!presetInput || !daysInput || !daysGroup) return;

    const normalizedDays = Number.parseInt(days, 10);
    const presetValue = String(normalizedDays);
    if (FREQUENCY_PRESET_VALUES.includes(presetValue)) {
        presetInput.value = presetValue;
        daysGroup.hidden = true;
        return;
    }

    presetInput.value = 'custom';
    daysGroup.hidden = false;
    daysInput.value = Number.isFinite(normalizedDays) && normalizedDays > 0 ? String(normalizedDays) : '180';
}

function getFrequencyDays() {
    const presetInput = document.getElementById('test-case-frequency-preset');
    const daysInput = document.getElementById('test-case-frequency-days');
    if (!presetInput || !daysInput) {
        return { value: NaN, input: null };
    }

    if (presetInput.value !== 'custom') {
        return { value: Number.parseInt(presetInput.value, 10), input: presetInput };
    }
    return { value: Number.parseInt(daysInput.value, 10), input: daysInput };
}

function buildTestCaseId() {
    return `test-case-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function buildTestRunId() {
    return `test-run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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

function formatRunStatusLabel(status) {
    if (status === 'fail') return 'Fail';
    if (status === 'blocked') return 'Blocked';
    return 'Pass';
}

function normalizeIsoDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString();
}

function formatDateTime(value) {
    const parsed = new Date(String(value || ''));
    if (Number.isNaN(parsed.getTime())) return 'Unknown';
    return parsed.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function toLocalDateTimeValue(date = new Date()) {
    const value = new Date(date);
    if (Number.isNaN(value.getTime())) return '';
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    const hours = String(value.getHours()).padStart(2, '0');
    const minutes = String(value.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function localDateTimeToIso(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString();
}

function setRunsSectionVisible(visible) {
    const section = document.getElementById('test-case-runs-section');
    if (!section) return;
    section.hidden = !visible;
}

function getCurrentTestCaseRuns() {
    const targetTestCaseId = getWorkingTestCaseId();
    if (!targetTestCaseId) return [];
    return allTestCaseRuns
        .filter((run) => String(run?.testCaseId || '').trim() === targetTestCaseId)
        .slice()
        .sort((a, b) => Date.parse(String(b?.executedAt || '')) - Date.parse(String(a?.executedAt || '')));
}

function getPageTokens(totalPages, currentPage) {
    if (totalPages <= 7) {
        return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const tokens = [1];
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);

    if (start > 2) tokens.push('...');
    for (let page = start; page <= end; page += 1) {
        tokens.push(page);
    }
    if (end < totalPages - 1) tokens.push('...');
    tokens.push(totalPages);

    return tokens;
}

function renderRunsTable() {
    const body = document.getElementById('test-case-runs-table-body');
    const empty = document.getElementById('test-case-runs-empty');
    const pagination = document.getElementById('test-case-runs-pagination');
    const info = document.getElementById('test-case-runs-pagination-info');
    const prevBtn = document.getElementById('test-case-runs-prev-btn');
    const nextBtn = document.getElementById('test-case-runs-next-btn');
    const pageNumbers = document.getElementById('test-case-runs-page-numbers');

    if (!body || !empty || !pagination || !info || !prevBtn || !nextBtn || !pageNumbers) return;

    const runs = getCurrentTestCaseRuns();
    if (!runs.length) {
        body.innerHTML = '';
        empty.hidden = false;
        pagination.hidden = true;
        return;
    }

    empty.hidden = true;

    const totalPages = Math.max(1, Math.ceil(runs.length / RUNS_PAGE_SIZE));
    if (currentRunsPage > totalPages) {
        currentRunsPage = totalPages;
    }
    if (currentRunsPage < 1) {
        currentRunsPage = 1;
    }

    const startIndex = (currentRunsPage - 1) * RUNS_PAGE_SIZE;
    const endIndex = Math.min(startIndex + RUNS_PAGE_SIZE, runs.length);
    const pageRuns = runs.slice(startIndex, endIndex);

    body.innerHTML = pageRuns.map((run) => {
        const status = normalizeRunStatus(run.status);
        const notes = String(run.notes || '').trim();
        return `
            <tr data-run-id="${escapeHtml(run.id)}">
                <td>${escapeHtml(formatDateTime(run.executedAt))}</td>
                <td><span class="test-runs-outcome ${escapeHtml(status)}">${escapeHtml(formatRunStatusLabel(status))}</span></td>
                <td><div class="test-runs-notes">${escapeHtml(notes || '—')}</div></td>
                <td class="test-runs-actions">
                    <button class="btn btn-secondary btn-sm" type="button" data-run-action="edit" data-run-id="${escapeHtml(run.id)}">Edit</button>
                    <button class="btn btn-danger btn-sm" type="button" data-run-action="delete" data-run-id="${escapeHtml(run.id)}">Delete</button>
                </td>
            </tr>
        `;
    }).join('');

    pagination.hidden = false;
    info.textContent = `Showing ${startIndex + 1}-${endIndex} of ${runs.length}`;

    prevBtn.disabled = currentRunsPage <= 1;
    nextBtn.disabled = currentRunsPage >= totalPages;

    const tokens = getPageTokens(totalPages, currentRunsPage);
    pageNumbers.innerHTML = tokens.map((token) => {
        if (token === '...') {
            return '<button class="test-runs-page-btn" type="button" disabled>…</button>';
        }
        const isActive = token === currentRunsPage;
        return `<button class="test-runs-page-btn${isActive ? ' is-active' : ''}" type="button" data-run-page="${token}">${token}</button>`;
    }).join('');
}

function initializeRunsSectionEvents() {
    const addBtn = document.getElementById('test-case-run-add-btn');
    const body = document.getElementById('test-case-runs-table-body');
    const prevBtn = document.getElementById('test-case-runs-prev-btn');
    const nextBtn = document.getElementById('test-case-runs-next-btn');
    const pageNumbers = document.getElementById('test-case-runs-page-numbers');

    if (addBtn) {
        addBtn.addEventListener('click', () => openRunModal());
    }

    if (body) {
        body.addEventListener('click', (event) => {
            void handleRunsTableAction(event);
        });
    }

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            currentRunsPage = Math.max(1, currentRunsPage - 1);
            renderRunsTable();
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            currentRunsPage += 1;
            renderRunsTable();
        });
    }

    if (pageNumbers) {
        pageNumbers.addEventListener('click', (event) => {
            const pageBtn = event.target.closest('[data-run-page]');
            if (!pageBtn) return;
            const nextPage = Number.parseInt(pageBtn.getAttribute('data-run-page'), 10);
            if (!Number.isFinite(nextPage) || nextPage < 1) return;
            currentRunsPage = nextPage;
            renderRunsTable();
        });
    }
}

async function handleRunsTableAction(event) {
    const actionBtn = event.target.closest('[data-run-action]');
    if (!actionBtn) return;

    const action = String(actionBtn.getAttribute('data-run-action') || '').trim();
    const runId = String(actionBtn.getAttribute('data-run-id') || '').trim();
    if (!runId) return;

    if (action === 'edit') {
        openRunModal(runId);
        return;
    }

    if (action === 'delete') {
        await deleteRun(runId);
    }
}

function initializeRunModalEvents() {
    const closeBtn = document.getElementById('test-case-run-modal-close');
    const cancelBtn = document.getElementById('test-case-run-modal-cancel');
    const saveBtn = document.getElementById('test-case-run-modal-save');
    const overlay = document.getElementById('test-case-run-modal-overlay');

    if (closeBtn) closeBtn.addEventListener('click', closeRunModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeRunModal);
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            void saveRun();
        });
    }
}

function openRunModal(runId = '') {
    const targetTestCaseId = getWorkingTestCaseId();
    if (!targetTestCaseId) return;

    const modal = document.getElementById('test-case-run-modal');
    const modalTitle = document.getElementById('test-case-run-modal-title');
    const subtitle = document.getElementById('test-case-run-modal-subtitle');
    const statusInput = document.getElementById('test-case-run-status');
    const dateInput = document.getElementById('test-case-run-at');
    const notesInput = document.getElementById('test-case-run-notes');
    const saveBtn = document.getElementById('test-case-run-modal-save');
    if (!modal || !modalTitle || !subtitle || !statusInput || !dateInput || !notesInput || !saveBtn) return;

    editingRunId = String(runId || '').trim();
    const currentRun = editingRunId
        ? allTestCaseRuns.find((run) => String(run?.id || '').trim() === editingRunId && String(run?.testCaseId || '').trim() === targetTestCaseId)
        : null;

    const currentTestCase = allTestCases.find((testCase) => String(testCase?.id || '').trim() === targetTestCaseId);
    const draftName = String(document.getElementById('test-case-name')?.value || '').trim();
    subtitle.textContent = String(currentTestCase?.name || draftName || 'New test case').trim();

    modalTitle.textContent = currentRun ? 'Edit Test Run' : 'Add Test Run';
    saveBtn.textContent = currentRun ? 'Save Changes' : 'Save Run';

    statusInput.value = currentRun ? normalizeRunStatus(currentRun.status) : 'pass';
    dateInput.value = toLocalDateTimeValue(currentRun ? new Date(currentRun.executedAt) : new Date());
    notesInput.value = currentRun ? String(currentRun.notes || '') : '';

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
    editingRunId = '';

    if (modalTitle) modalTitle.textContent = 'Add Test Run';
    if (saveBtn) saveBtn.textContent = 'Save Run';
}

async function saveRun() {
    const targetTestCaseId = getWorkingTestCaseId();
    if (!targetTestCaseId) return;

    const statusInput = document.getElementById('test-case-run-status');
    const dateInput = document.getElementById('test-case-run-at');
    const notesInput = document.getElementById('test-case-run-notes');
    if (!statusInput || !dateInput || !notesInput) return;

    const status = normalizeRunStatus(statusInput.value);
    const executedAt = localDateTimeToIso(dateInput.value);
    if (!executedAt) {
        notify('Run date is required.', 'error');
        dateInput.focus();
        return;
    }

    const now = new Date().toISOString();
    const notes = String(notesInput.value || '').trim();

    const wasEditing = Boolean(editingRunId);
    if (wasEditing) {
        const runIndex = allTestCaseRuns.findIndex((run) => (
            String(run?.id || '').trim() === editingRunId &&
            String(run?.testCaseId || '').trim() === targetTestCaseId
        ));
        if (runIndex < 0) {
            notify('Test run not found.', 'error');
            closeRunModal();
            return;
        }

        const current = allTestCaseRuns[runIndex] || {};
        allTestCaseRuns[runIndex] = {
            ...current,
            status,
            notes,
            executedAt,
            updatedAt: now
        };
    } else {
        allTestCaseRuns.push({
            id: buildTestRunId(),
            testCaseId: targetTestCaseId,
            status,
            notes,
            executedAt,
            createdAt: now
        });
    }

    if (!isAddMode) {
        await saveData({
            testCaseRuns: allTestCaseRuns
        });
    }

    closeRunModal();
    renderRunsTable();
    notify(wasEditing ? 'Test run updated.' : 'Test run added.', 'success');
}

async function deleteRun(runId) {
    const targetTestCaseId = getWorkingTestCaseId();
    if (!targetTestCaseId) return;
    const normalizedRunId = String(runId || '').trim();
    if (!normalizedRunId) return;

    const current = allTestCaseRuns.find((run) => (
        String(run?.id || '').trim() === normalizedRunId &&
        String(run?.testCaseId || '').trim() === targetTestCaseId
    ));
    if (!current) return;

    const confirmed = await showConfirm('Delete this test run?', {
        title: 'Delete test run',
        confirmText: 'Delete',
        cancelText: 'Cancel'
    });
    if (!confirmed) return;

    allTestCaseRuns = allTestCaseRuns.filter((run) => String(run?.id || '').trim() !== normalizedRunId);
    if (!isAddMode) {
        await saveData({
            testCaseRuns: allTestCaseRuns
        });
    }

    renderRunsTable();
    notify('Test run deleted.', 'success');
}

function notify(message, type = 'success') {
    const normalized = type === 'error' ? 'error' : 'success';
    if (typeof showToast === 'function') {
        showToast(message, normalized);
        return;
    }
    if (normalized === 'error') {
        console.error(message);
        return;
    }
    console.log(message);
}

async function handleSubmit() {
    const nameInput = document.getElementById('test-case-name');
    const categoryInput = document.getElementById('test-case-category');
    const priorityInput = document.getElementById('test-case-priority');
    const enabledInput = document.getElementById('test-case-enabled');
    const descriptionInput = document.getElementById('test-case-description');
    const stepsInput = document.getElementById('test-case-steps');
    const expectedInput = document.getElementById('test-case-expected');

    if (!nameInput || !categoryInput || !priorityInput || !enabledInput || !descriptionInput || !stepsInput || !expectedInput) {
        return;
    }

    const name = String(nameInput.value || '').trim();
    if (!name) {
        notify('Test case name is required.', 'error');
        nameInput.focus();
        return;
    }

    const frequency = getFrequencyDays();
    const frequencyDays = frequency.value;
    if (!Number.isFinite(frequencyDays) || frequencyDays < 1) {
        notify('Frequency must be at least 1 day.', 'error');
        frequency.input?.focus();
        return;
    }

    const category = String(categoryInput.value || '').trim() || 'General';
    const priority = normalizeTestCasePriority(priorityInput.value);
    const now = new Date().toISOString();

    let nextTestCases = [...allTestCases];
    if (existingTestCaseId) {
        const index = nextTestCases.findIndex((item) => String(item?.id || '').trim() === existingTestCaseId);
        if (index < 0) {
            notify('Test case not found.', 'error');
            window.location.href = 'test-cases.html';
            return;
        }

        const current = nextTestCases[index] || {};
        nextTestCases[index] = {
            ...current,
            id: existingTestCaseId,
            name,
            category,
            priority,
            description: String(descriptionInput.value || '').trim(),
            steps: String(stepsInput.value || '').trim(),
            expectedResult: String(expectedInput.value || '').trim(),
            frequencyDays,
            enabled: enabledInput.checked,
            createdAt: current.createdAt || now,
            updatedAt: now
        };
    } else {
        const newTestCaseId = getWorkingTestCaseId() || buildUniqueTestCaseId();
        nextTestCases.push({
            id: newTestCaseId,
            name,
            category,
            priority,
            description: String(descriptionInput.value || '').trim(),
            steps: String(stepsInput.value || '').trim(),
            expectedResult: String(expectedInput.value || '').trim(),
            frequencyDays,
            enabled: enabledInput.checked,
            createdAt: now,
            updatedAt: now
        });
    }

    allTestCases = nextTestCases;

    await saveData({
        testCases: nextTestCases,
        testCaseRuns: allTestCaseRuns
    });

    notify(existingTestCaseId ? 'Test case updated.' : 'Test case saved.', 'success');
    window.location.href = 'test-cases.html';
}
