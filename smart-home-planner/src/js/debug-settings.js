var appBuildDateTime = "";

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
    }
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
        const contentEl = document.getElementById('debug-file-content');
        if (!contentEl) return;

        let previewText = payload.content || '';
        if (payload.isJson) {
            try {
                previewText = JSON.stringify(JSON.parse(previewText), null, 2);
            } catch (_error) {
                // Keep raw content if parsing fails unexpectedly.
            }
        }

        contentEl.textContent = previewText;
        setMessage(
            `${payload.name} • ${formatBytes(payload.size)} • ${payload.isJson ? 'JSON' : 'Text'}`
        );
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

    await refreshFiles();
}

document.addEventListener('DOMContentLoaded', initializeDebugSettings);
