var appBuildDateTime = "";
let currentFilePayload = null;
let currentJsonData = null;
let isStructuredView = true;

function buildDebugApiUrl(path) {
    if (typeof window.buildAppUrl === 'function') {
        return window.buildAppUrl(path);
    }
    const cleanPath = String(path || '').replace(/^\/+/, '');
    return `/${cleanPath}`;
}

function formatBytes(bytes) {
    const size = Number(bytes) || 0;
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTimestamp(epochSeconds) {
    const date = new Date((Number(epochSeconds) || 0) * 1000);
    return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString();
}

function renderBuildStampInfo() {
    const stampEl = document.getElementById('debug-build-stamp');
    if (!stampEl) return;
    const buildDateTime = typeof appBuildDateTime === 'string' ? appBuildDateTime.trim() : '';
    stampEl.textContent = buildDateTime || 'Not available';
}

async function fetchDebugFiles() {
    const response = await fetch(buildDebugApiUrl('api/debug/files'), { cache: 'no-store' });
    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `List request failed (${response.status})`);
    }
    const payload = await response.json();
    return Array.isArray(payload.files) ? payload.files : [];
}

async function fetchDebugFile(name) {
    const response = await fetch(
        `${buildDebugApiUrl('api/debug/file')}?name=${encodeURIComponent(name)}`,
        { cache: 'no-store' }
    );
    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `File request failed (${response.status})`);
    }
    return response.json();
}

function setMessage(text, isError = false) {
    const meta = document.getElementById('debug-file-meta');
    if (!meta) return;
    meta.textContent = text;
    meta.classList.toggle('debug-meta-error', Boolean(isError));
}

function clearViewer() {
    const content = document.getElementById('debug-file-content');
    if (content) {
        content.textContent = '';
        content.classList.remove('is-json');
    }
    currentFilePayload = null;
    currentJsonData = null;
    isStructuredView = true;
    updateJsonToggle(false);
}

function renderJsonViewer(contentEl, data) {
    if (!contentEl) return;
    contentEl.classList.add('is-json');
    contentEl.textContent = '';
    const rootNode = buildJsonNode(data, null, 0);
    if (rootNode) {
        contentEl.appendChild(rootNode);
    }
}

function updateJsonToggle(isVisible) {
    const toggle = document.getElementById('debug-json-toggle');
    if (!toggle) return;
    toggle.hidden = !isVisible;
    toggle.disabled = !isVisible;
    toggle.setAttribute('aria-pressed', isStructuredView ? 'true' : 'false');
    toggle.textContent = isStructuredView ? 'Plain text' : 'Structured view';
}

function renderFileContent() {
    const contentEl = document.getElementById('debug-file-content');
    if (!contentEl || !currentFilePayload) return;
    const previewText = currentFilePayload.content || '';
    const sizeLabel = formatBytes(currentFilePayload.size);
    const nameLabel = currentFilePayload.name || 'file';

    if (currentJsonData && isStructuredView) {
        renderJsonViewer(contentEl, currentJsonData);
        setMessage(`${nameLabel} • ${sizeLabel} • Structured view`);
        return;
    }

    contentEl.classList.remove('is-json');
    contentEl.textContent = previewText;
    const label = currentJsonData ? 'Plain text' : 'Text file';
    setMessage(`${nameLabel} • ${sizeLabel} • ${label}`);
}

function handleJsonToggle() {
    if (!currentJsonData) return;
    isStructuredView = !isStructuredView;
    updateJsonToggle(true);
    renderFileContent();
}

function formatJsonMeta(count, singularLabel, pluralLabel) {
    const safeCount = Number.isFinite(count) ? count : 0;
    if (safeCount === 0) {
        return `No ${pluralLabel}`;
    }
    if (safeCount === 1) {
        return `1 ${singularLabel}`;
    }
    return `${safeCount} ${pluralLabel}`;
}

function buildJsonNode(value, key, depth) {
    const isArray = Array.isArray(value);
    const isObject = value !== null && typeof value === 'object' && !isArray;

    if (isArray || isObject) {
        const details = document.createElement('details');
        details.className = 'json-node';
        details.open = true;

        const summary = document.createElement('summary');
        if (key !== null && key !== undefined) {
            summary.appendChild(buildJsonKey(String(key)));
            summary.appendChild(document.createTextNode(': '));
        }

        const count = isArray ? value.length : Object.keys(value || {}).length;
        const meta = document.createElement('span');
        meta.className = 'json-meta';
        meta.textContent = isArray
            ? formatJsonMeta(count, 'item', 'items')
            : formatJsonMeta(count, 'field', 'fields');
        summary.appendChild(meta);
        details.appendChild(summary);

        const children = document.createElement('div');
        children.className = 'json-children';

        if (isArray) {
            value.forEach((item, index) => {
                children.appendChild(buildJsonNode(item, index, depth + 1));
            });
        } else {
            Object.keys(value || {}).forEach((childKey) => {
                children.appendChild(buildJsonNode(value[childKey], childKey, depth + 1));
            });
        }

        if (!children.childNodes.length) {
            const empty = document.createElement('div');
            empty.className = 'json-row';
            empty.appendChild(buildJsonValue(null, true));
            children.appendChild(empty);
        }

        details.appendChild(children);
        return details;
    }

    const row = document.createElement('div');
    row.className = 'json-row';
    if (key !== null && key !== undefined) {
        row.appendChild(buildJsonKey(String(key)));
        row.appendChild(document.createTextNode(': '));
    }
    row.appendChild(buildJsonValue(value));
    return row;
}

function buildJsonKey(text) {
    const span = document.createElement('span');
    span.className = 'json-key';
    span.textContent = text;
    return span;
}

function buildJsonValue(value, isEmptyContainer = false) {
    const span = document.createElement('span');
    span.className = 'json-value';

    if (isEmptyContainer) {
        span.textContent = 'Empty';
        span.classList.add('json-empty');
        return span;
    }

    if (value === null) {
        span.textContent = 'null';
        span.classList.add('json-null');
        return span;
    }

    const type = typeof value;
    if (type === 'string') {
        span.textContent = value;
        span.classList.add('json-string');
        return span;
    }
    if (type === 'number') {
        span.textContent = String(value);
        span.classList.add('json-number');
        return span;
    }
    if (type === 'boolean') {
        span.textContent = String(value);
        span.classList.add('json-boolean');
        return span;
    }

    span.textContent = String(value);
    return span;
}

async function onFileSelected(fileName, listItem) {
    const list = document.getElementById('debug-file-list');
    if (list) {
        list.querySelectorAll('.is-active').forEach(item => item.classList.remove('is-active'));
    }
    if (listItem) {
        listItem.classList.add('is-active');
    }

    clearViewer();
    setMessage(`Loading ${fileName}...`);

    try {
        const payload = await fetchDebugFile(fileName);
        currentFilePayload = payload;
        currentJsonData = null;
        isStructuredView = true;

        if (payload.isJson) {
            try {
                const parsed = JSON.parse(payload.content || '');
                currentJsonData = parsed;
                updateJsonToggle(true);
                renderFileContent();
                return;
            } catch (_error) {
                // Keep raw content if parsing fails unexpectedly.
            }
        }

        updateJsonToggle(false);
        renderFileContent();
    } catch (error) {
        setMessage(error?.message || 'Failed to load file.', true);
    }
}

function downloadTextFile(fileName, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName || 'download.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

async function onFileDownload(fileName) {
    setMessage(`Preparing download for ${fileName}...`);
    try {
        const payload = await fetchDebugFile(fileName);
        downloadTextFile(payload.name || fileName, payload.content || '');
        setMessage(`Downloaded ${payload.name || fileName}`);
    } catch (error) {
        setMessage(error?.message || 'Failed to download file.', true);
    }
}

function renderFileList(files) {
    const list = document.getElementById('debug-file-list');
    const empty = document.getElementById('debug-files-empty');
    if (!list || !empty) return;

    list.innerHTML = '';
    if (!files.length) {
        empty.classList.remove('is-hidden');
        return;
    }

    empty.classList.add('is-hidden');
    files.forEach((file) => {
        const item = document.createElement('li');
        item.className = 'debug-file-item';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'debug-file-btn';
        button.innerHTML = `
            <span class="debug-file-name">${escapeHtml(file.name || 'unknown')}</span>
            <span class="debug-file-info">${formatBytes(file.size)} • ${formatTimestamp(file.modifiedAt)}</span>
        `;
        button.addEventListener('click', () => onFileSelected(file.name, item));

        const downloadBtn = document.createElement('button');
        downloadBtn.type = 'button';
        downloadBtn.className = 'btn btn-secondary btn-sm debug-download-btn';
        downloadBtn.textContent = 'Download';
        downloadBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            onFileDownload(file.name);
        });

        item.appendChild(button);
        item.appendChild(downloadBtn);
        list.appendChild(item);
    });
}

async function refreshFiles() {
    clearViewer();
    setMessage('Loading files...');
    try {
        const files = await fetchDebugFiles();
        renderFileList(files);
        setMessage(`Found ${files.length} file(s) in /data.`);
    } catch (error) {
        renderFileList([]);
        setMessage(error?.message || 'Failed to load files.', true);
    }
}

async function initializeDebugSettings() {
    renderBuildStampInfo();

    const refreshBtn = document.getElementById('debug-refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshFiles);
    }
    const jsonToggle = document.getElementById('debug-json-toggle');
    if (jsonToggle) {
        jsonToggle.addEventListener('click', handleJsonToggle);
    }

    await refreshFiles();
}

document.addEventListener('DOMContentLoaded', initializeDebugSettings);
