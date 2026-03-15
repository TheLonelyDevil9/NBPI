/**
 * UI Utilities
 * DOM helpers, toast, haptic feedback, sound notifications
 */

// DOM helper
export const $ = id => document.getElementById(id);

// Toast notification
let toastTimeout = null;
export function showToast(msg) {
    const toast = $('toast');
    toast.textContent = msg;
    toast.classList.remove('hidden');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.add('hidden'), 3000);
}

/**
 * Show a confirmation dialog
 * @param {Object} options - Dialog options
 * @param {string} options.title - Dialog title
 * @param {string} options.message - Main message
 * @param {string} options.warning - Warning text (optional)
 * @param {string} options.confirmText - Confirm button text (default: 'Confirm')
 * @param {string} options.cancelText - Cancel button text (default: 'Cancel')
 * @param {boolean} options.danger - If true, confirm button is red (default: false)
 * @returns {Promise<boolean>} - Resolves to true if confirmed, false if cancelled
 */
export function showConfirmDialog(options) {
    return new Promise(resolve => {
        const {
            title = 'Confirm',
            message,
            warning = '',
            confirmText = 'Confirm',
            cancelText = 'Cancel',
            danger = false
        } = options;

        // Create dialog overlay
        const overlay = document.createElement('div');
        overlay.className = 'confirm-dialog-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'confirm-dialog';
        dialog.innerHTML = `
            <div class="confirm-dialog-title">${title}</div>
            <div class="confirm-dialog-message">${message}</div>
            ${warning ? `<div class="confirm-dialog-warning">${warning}</div>` : ''}
            <div class="confirm-dialog-actions">
                <button class="btn-secondary confirm-dialog-cancel">${cancelText}</button>
                <button class="${danger ? 'btn-cancel' : 'btn-primary'} confirm-dialog-confirm">${confirmText}</button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        // Focus the cancel button by default (safer)
        dialog.querySelector('.confirm-dialog-cancel').focus();

        // Handle clicks
        const cleanup = () => {
            overlay.remove();
        };

        dialog.querySelector('.confirm-dialog-cancel').onclick = () => {
            cleanup();
            resolve(false);
        };

        dialog.querySelector('.confirm-dialog-confirm').onclick = () => {
            cleanup();
            resolve(true);
        };

        // Close on overlay click
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                cleanup();
                resolve(false);
            }
        };

        // Close on Escape
        const handleKeydown = (e) => {
            if (e.key === 'Escape') {
                cleanup();
                resolve(false);
                document.removeEventListener('keydown', handleKeydown);
            }
        };
        document.addEventListener('keydown', handleKeydown);
    });
}

// Haptic feedback
export function haptic(duration = 10) {
    if ($('hapticToggle')?.checked && navigator.vibrate) {
        navigator.vibrate(duration);
    }
}

// Shared AudioContext (created once, reused)
let audioCtx = null;

// Play notification sound
export function playNotificationSound() {
    if (!$('soundToggle')?.checked) return;
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
        osc.frequency.setValueAtTime(1174.66, audioCtx.currentTime + 0.1); // D6
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.3);
    } catch (e) { /* Audio not supported */ }
}

// Debounce utility
export function debounce(fn, ms) {
    let t;
    return function () {
        const args = arguments;
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), ms);
    };
}

// Toggle collapsible sections
export function toggleCollapsible(id) {
    const el = $(id);
    el.classList.toggle('collapsed');
    localStorage.setItem('collapsed_' + id, el.classList.contains('collapsed'));
}

// Restore collapsible states from localStorage
export function restoreCollapsibleStates() {
    ['authCollapsible', 'advancedCollapsible', 'settingsCollapsible', 'safetyCollapsible'].forEach(id => {
        const el = $(id);
        if (el && localStorage.getItem('collapsed_' + id) === 'true') {
            el.classList.add('collapsed');
        } else if (el && localStorage.getItem('collapsed_' + id) === 'false') {
            el.classList.remove('collapsed');
        }
    });
}

// Toggle API key visibility
export function toggleApiKeyVisibility() {
    const input = $('apiKey');
    input.type = input.type === 'password' ? 'text' : 'password';
}

// Update character counter
export function updateCharCounter() {
    const len = $('prompt').value.length;
    $('charCounter').textContent = len.toLocaleString();
}

// Update aspect ratio preview
export function updateAspectPreview() {
    const val = $('ratio').value;
    const inner = $('aspectPreviewInner');
    if (!val) {
        inner.style.width = '20px';
        inner.style.height = '20px';
        return;
    }
    const [w, h] = val.split(':').map(Number);
    const maxSize = 22;
    if (w > h) {
        inner.style.width = maxSize + 'px';
        inner.style.height = Math.round(maxSize * h / w) + 'px';
    } else {
        inner.style.height = maxSize + 'px';
        inner.style.width = Math.round(maxSize * w / h) + 'px';
    }
}

// Update thinking label
export function updateThinkingLabel() {
    const v = parseInt($('thinkingBudget').value);
    $('thinkingLabel').textContent = v === -1 ? 'Auto' : v === 0 ? 'Off' : v.toLocaleString();
    const numInput = $('thinkingBudgetNum');
    if (numInput) numInput.value = v;
}

// Update placeholder text
export function updatePlaceholder(msg) {
    const placeholder = $('placeholder');
    const placeholderDiv = placeholder.querySelector('div');
    if (placeholderDiv) placeholderDiv.textContent = msg;
}

// Scroll to result smoothly
export function scrollToResult() {
    setTimeout(() => {
        $('imageBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
}

// Fullscreen Prompt Editor
export function openPromptEditor() {
    const modal = $('promptEditorModal');
    const textarea = $('promptEditorTextarea');
    const mainPrompt = $('prompt');

    // Copy current prompt to editor
    textarea.value = mainPrompt.value;
    updatePromptEditorCounter();

    modal.classList.add('open');

    // Focus textarea after animation
    setTimeout(() => textarea.focus(), 100);
}

export function closePromptEditor() {
    $('promptEditorModal').classList.remove('open');
}

export function applyPromptEditor() {
    const textarea = $('promptEditorTextarea');
    const mainPrompt = $('prompt');

    // Copy editor content back to main prompt
    mainPrompt.value = textarea.value;
    updateCharCounter();

    // Trigger persistence
    import('./persistence.js').then(m => m.persistAllInputs());

    closePromptEditor();
    showToast('Prompt updated');
}

export function updatePromptEditorCounter() {
    const len = $('promptEditorTextarea').value.length;
    $('promptEditorCounter').textContent = len.toLocaleString() + ' characters';
}

// Theme toggle
export function toggleTheme() {
    const isLight = $('lightThemeToggle')?.checked;
    document.documentElement.setAttribute('data-theme', isLight ? 'light' : 'dark');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
}

// Restore theme on load
export function restoreTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    const toggle = $('lightThemeToggle');
    if (toggle) {
        toggle.checked = savedTheme === 'light';
    }
}

// Make functions globally available for HTML onclick handlers
window.toggleCollapsible = toggleCollapsible;
window.toggleApiKeyVisibility = toggleApiKeyVisibility;
window.openPromptEditor = openPromptEditor;
window.closePromptEditor = closePromptEditor;
window.applyPromptEditor = applyPromptEditor;
window.toggleTheme = toggleTheme;
