/**
 * Saved Prompts Module
 * Save, load, delete prompts with nicknames using IndexedDB
 */

import { getDB } from './history.js';
import { $, showToast, haptic } from './ui.js';

let savedPrompts = [];
let dropdownOpen = false;

// Load all saved prompts from IndexedDB
export async function loadSavedPrompts() {
    const db = getDB();
    if (!db) return;

    return new Promise((resolve) => {
        const tx = db.transaction('savedPrompts', 'readonly');
        const store = tx.objectStore('savedPrompts');
        const items = [];

        store.index('createdAt').openCursor(null, 'prev').onsuccess = e => {
            const cursor = e.target.result;
            if (cursor) {
                items.push(cursor.value);
                cursor.continue();
            } else {
                savedPrompts = items;
                updatePromptsCount();
                resolve(items);
            }
        };
    });
}

// Save current prompt to IndexedDB with nickname
export function saveCurrentPrompt() {
    const db = getDB();
    const promptText = $('prompt').value.trim();

    if (!promptText) {
        showToast('Enter a prompt first');
        return;
    }

    if (!db) {
        showToast('Database not ready');
        return;
    }

    // Check for duplicates
    if (savedPrompts.some(p => p.text === promptText)) {
        showToast('Prompt already saved');
        return;
    }

    // Ask for a nickname
    const defaultName = promptText.slice(0, 30).trim();
    const name = prompt('Name this prompt:', defaultName);
    if (name === null) return; // User cancelled

    const tx = db.transaction('savedPrompts', 'readwrite');
    tx.objectStore('savedPrompts').add({
        id: 'prompt-' + Date.now(),
        text: promptText,
        name: (name || defaultName).trim(),
        createdAt: Date.now()
    });

    tx.oncomplete = () => {
        loadSavedPrompts();
        showToast('Prompt saved');
        haptic(15);
    };

    tx.onerror = () => {
        showToast('Failed to save');
    };
}

// Delete a saved prompt
export function deletePrompt(id, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }

    const db = getDB();
    if (!db) return;

    const tx = db.transaction('savedPrompts', 'readwrite');
    tx.objectStore('savedPrompts').delete(id);

    tx.oncomplete = () => {
        loadSavedPrompts().then(() => renderPromptsDropdown());
        showToast('Prompt deleted');
        haptic(15);
    };
}

// Rename a saved prompt
export function renamePrompt(id, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }

    const db = getDB();
    if (!db) return;

    const p = savedPrompts.find(p => p.id === id);
    if (!p) return;

    const newName = prompt('Rename prompt:', p.name || p.text.slice(0, 30));
    if (newName === null || !newName.trim()) return;

    const tx = db.transaction('savedPrompts', 'readwrite');
    const store = tx.objectStore('savedPrompts');
    store.get(id).onsuccess = e => {
        const item = e.target.result;
        if (item) {
            item.name = newName.trim();
            store.put(item);
        }
    };

    tx.oncomplete = () => {
        loadSavedPrompts().then(() => renderPromptsDropdown());
        showToast('Renamed');
    };
}

// Use a saved prompt (load into textarea)
export function usePrompt(id) {
    const p = savedPrompts.find(p => p.id === id);
    if (p) {
        $('prompt').value = p.text;
        $('prompt').dispatchEvent(new Event('input'));
        closePromptsDropdown();
        showToast('Prompt loaded');
        haptic(10);
    }
}

// Toggle dropdown visibility
export function togglePromptsDropdown() {
    if (dropdownOpen) {
        closePromptsDropdown();
    } else {
        openPromptsDropdown();
    }
}

function openPromptsDropdown() {
    renderPromptsDropdown();
    $('promptsDropdown').classList.remove('hidden');
    dropdownOpen = true;
}

export function closePromptsDropdown() {
    $('promptsDropdown').classList.add('hidden');
    dropdownOpen = false;
}

export function isDropdownOpen() {
    return dropdownOpen;
}

/** Get the current saved prompts array */
export function getSavedPrompts() {
    return savedPrompts;
}

// Render the prompts dropdown list
function renderPromptsDropdown() {
    const list = $('savedPromptsList');
    const emptyMsg = $('noPromptsMsg');

    if (savedPrompts.length === 0) {
        list.innerHTML = '';
        emptyMsg.classList.remove('hidden');
        return;
    }

    emptyMsg.classList.add('hidden');
    list.innerHTML = savedPrompts.map(p => {
        const displayName = escapeHtml(p.name || p.text.slice(0, 50));
        const subtitle = escapeHtml(p.text.length > 60 ? p.text.slice(0, 60) + '...' : p.text);
        return '<div class="dropdown-item" onclick="usePrompt(\'' + p.id + '\')">' +
            '<div class="dropdown-item-content">' +
            '<span class="dropdown-item-name">' + displayName + '</span>' +
            (p.name ? '<span class="dropdown-item-subtitle">' + subtitle + '</span>' : '') +
            '</div>' +
            '<div class="dropdown-item-actions">' +
            '<button class="dropdown-item-rename" onclick="renamePrompt(\'' + p.id + '\', event)" title="Rename">&#x270E;</button>' +
            '<button class="dropdown-item-delete" onclick="deletePrompt(\'' + p.id + '\', event)" title="Delete">&times;</button>' +
            '</div>' +
            '</div>';
    }).join('');
}

function updatePromptsCount() {
    const badge = $('savedPromptsCount');
    if (badge) {
        badge.textContent = savedPrompts.length;
        badge.classList.toggle('hidden', savedPrompts.length === 0);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Make functions globally available for HTML onclick handlers
window.saveCurrentPrompt = saveCurrentPrompt;
window.deletePrompt = deletePrompt;
window.renamePrompt = renamePrompt;
window.usePrompt = usePrompt;
window.togglePromptsDropdown = togglePromptsDropdown;
window.closePromptsDropdown = closePromptsDropdown;
