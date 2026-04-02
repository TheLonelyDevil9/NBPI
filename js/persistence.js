/**
 * Persistence Module
 * LocalStorage save/restore for inputs and settings
 */

import { $, updateThinkingLabel, debounce } from './ui.js';
import { persistCurrentProviderState, providerSupports, restoreProviderModelSelection } from './providers/index.js';

// Persist a single input value
export function persistInput(key, value) {
    localStorage.setItem('input_' + key, JSON.stringify(value));
}

// Load a persisted input value
export function loadPersistedInput(key, defaultValue) {
    try {
        const val = localStorage.getItem('input_' + key);
        return val !== null ? JSON.parse(val) : defaultValue;
    } catch { return defaultValue; }
}

// Persist all inputs (called from setup)
export function persistAllInputs() {
    persistInput('prompt', $('prompt').value);
    persistInput('ratio', $('ratio').value);
    persistInput('resolution', $('resolution').value);
    persistInput('variations', $('variations')?.value || '1');
    persistInput('searchToggle', $('searchToggle').checked);
    persistInput('thinkingToggle', $('thinkingToggle').checked);
    persistInput('thinkingBudget', $('thinkingBudget').value);
    persistInput('soundToggle', $('soundToggle')?.checked);
    persistInput('hapticToggle', $('hapticToggle')?.checked);
    // Safety settings
    persistInput('safetyHarassment', $('safetyHarassment')?.value);
    persistInput('safetyHateSpeech', $('safetyHateSpeech')?.value);
    persistInput('safetySexuallyExplicit', $('safetySexuallyExplicit')?.value);
    persistInput('safetyDangerous', $('safetyDangerous')?.value);
    persistInput('filenamePrefix', $('filenamePrefix')?.value || '');
    // authMode and refImages are persisted by their respective modules
}

// Restore all inputs
export function restoreAllInputs() {
    $('prompt').value = loadPersistedInput('prompt', '');
    $('ratio').value = loadPersistedInput('ratio', '');
    $('resolution').value = loadPersistedInput('resolution', '4K');
    if ($('variations')) $('variations').value = loadPersistedInput('variations', '1');
    $('searchToggle').checked = loadPersistedInput('searchToggle', false);
    $('thinkingToggle').checked = loadPersistedInput('thinkingToggle', true);
    $('thinkingBudget').value = loadPersistedInput('thinkingBudget', '-1');

    const savedSound = loadPersistedInput('soundToggle', false);
    const savedHaptic = loadPersistedInput('hapticToggle', true);
    if ($('soundToggle')) $('soundToggle').checked = savedSound;
    if ($('hapticToggle')) $('hapticToggle').checked = savedHaptic;

    // Safety settings
    const safetyDefaults = {
        safetyHarassment: 'BLOCK_MEDIUM_AND_ABOVE',
        safetyHateSpeech: 'BLOCK_MEDIUM_AND_ABOVE',
        safetySexuallyExplicit: 'BLOCK_NONE',
        safetyDangerous: 'BLOCK_MEDIUM_AND_ABOVE'
    };
    Object.entries(safetyDefaults).forEach(([id, defaultVal]) => {
        const el = $(id);
        if (el) el.value = loadPersistedInput(id, defaultVal);
    });

    updateThinkingLabel();
    $('thinkingRow').style.display = $('thinkingToggle').checked ? 'block' : 'none';

    // Filename prefix
    const prefixEl = $('filenamePrefix');
    if (prefixEl) {
        prefixEl.value = loadPersistedInput('filenamePrefix', '');
        const clearBtn = $('clearPrefixBtn');
        if (clearBtn) clearBtn.classList.toggle('hidden', !prefixEl.value);
    }
}

// Setup input persistence listeners
export function setupInputPersistence() {
    const persist = debounce(persistAllInputs, 1000);
    $('prompt').addEventListener('input', persist);
    $('ratio').addEventListener('change', persist);
    $('resolution').addEventListener('change', persist);
    if ($('variations')) $('variations').addEventListener('input', persist);
    $('searchToggle').addEventListener('change', persist);
    $('thinkingToggle').addEventListener('change', persist);
    $('thinkingBudget').addEventListener('input', persist);
    $('thinkingBudgetNum')?.addEventListener('input', persist);
    $('soundToggle')?.addEventListener('change', persist);
    $('hapticToggle')?.addEventListener('change', persist);
    // Safety settings
    ['safetyHarassment', 'safetyHateSpeech', 'safetySexuallyExplicit', 'safetyDangerous']
        .forEach(id => $(id)?.addEventListener('change', persist));
    // Filename prefix
    const prefixEl = $('filenamePrefix');
    if (prefixEl) {
        prefixEl.addEventListener('input', () => {
            const clearBtn = $('clearPrefixBtn');
            if (clearBtn) clearBtn.classList.toggle('hidden', !prefixEl.value);
            persist();
        });
    }
}

// Save last used model
export function saveLastModel() {
    persistCurrentProviderState();
}

// Restore last used model
export function restoreLastModel() {
    setTimeout(() => {
        restoreProviderModelSelection();
        updateThinkingNote();
    }, 100);
}

// Update thinking note for specific models
export function updateThinkingNote() {
    const note = $('thinkingNote');
    if (note) {
        const model = providerSupports('thinking') ? $('modelSelect').value : '';
        const isProModel = model.includes('gemini-3-pro');
        note.style.display = isProModel ? 'block' : 'none';
    }
}

