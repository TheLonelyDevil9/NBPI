/**
 * Profile Management Module
 * Full workspace snapshots backed by IndexedDB with safe export/import
 */

import { QUEUE_STORAGE_KEY } from './config.js';
import { getDB } from './history.js';
import { persistAllInputs } from './persistence.js';
import { getProvider } from './providers/index.js';
import { showToast } from './ui.js';

const LEGACY_PROFILES_KEY = 'nbp_profiles';
const ACTIVE_PROFILE_KEY = 'nbp_active_profile';
const PROFILE_VERSION = '2.0';
const MANAGED_LOCAL_STORAGE_KEYS = new Set([
    'provider_id',
    'gemini_api_key',
    'linkapi_api_key',
    'linkapi_base_url',
    'linkapi_model',
    'openai_compatible_api_key',
    'openai_compatible_base_url',
    'openai_compatible_model',
    'last_model',
    'last_model_gemini',
    'theme',
    QUEUE_STORAGE_KEY
]);
const MANAGED_LOCAL_STORAGE_PREFIXES = ['input_', 'collapsed_'];

function shouldSnapshotLocalStorageKey(key) {
    return MANAGED_LOCAL_STORAGE_KEYS.has(key) ||
        MANAGED_LOCAL_STORAGE_PREFIXES.some(prefix => key.startsWith(prefix));
}

function requestToPromise(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function transactionToPromise(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

async function readAllFromStore(storeName) {
    const db = getDB();
    if (!db) {
        throw new Error('Database not ready');
    }

    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    return requestToPromise(store.getAll());
}

async function replaceStoreContents(storeName, records = []) {
    const db = getDB();
    if (!db) {
        throw new Error('Database not ready');
    }

    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.clear();
    records.forEach(record => store.put(record));
    await transactionToPromise(tx);
}

async function getProfileRecord(name) {
    const db = getDB();
    if (!db) {
        throw new Error('Database not ready');
    }

    const tx = db.transaction('profiles', 'readonly');
    return requestToPromise(tx.objectStore('profiles').get(name));
}

async function putProfileRecord(profile) {
    const db = getDB();
    if (!db) {
        throw new Error('Database not ready');
    }

    const tx = db.transaction('profiles', 'readwrite');
    tx.objectStore('profiles').put(profile);
    await transactionToPromise(tx);
}

async function deleteProfileRecord(name) {
    const db = getDB();
    if (!db) {
        throw new Error('Database not ready');
    }

    const tx = db.transaction('profiles', 'readwrite');
    tx.objectStore('profiles').delete(name);
    await transactionToPromise(tx);
}

async function getAllProfileRecords() {
    const db = getDB();
    if (!db) {
        throw new Error('Database not ready');
    }

    const tx = db.transaction('profiles', 'readonly');
    return requestToPromise(tx.objectStore('profiles').getAll());
}

function getManagedLocalStorageKeys() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && shouldSnapshotLocalStorageKey(key)) {
            keys.push(key);
        }
    }
    return keys;
}

function persistCurrentUiState() {
    persistAllInputs();

    const providerId = document.getElementById('providerSelect')?.value || localStorage.getItem('provider_id') || 'gemini';
    const provider = getProvider(providerId);
    const apiKeyInput = document.getElementById('apiKey');
    const modelSelect = document.getElementById('modelSelect');
    const providerBaseUrl = document.getElementById('providerBaseUrl');
    const providerModelInput = document.getElementById('providerModelInput');

    localStorage.setItem('provider_id', providerId);

    if (apiKeyInput && provider.storageKeys.apiKey) {
        localStorage.setItem(provider.storageKeys.apiKey, apiKeyInput.value || '');
    }

    if (providerBaseUrl && provider.storageKeys.baseUrl) {
        localStorage.setItem(provider.storageKeys.baseUrl, providerBaseUrl.value || '');
    }

    if (provider.features.modelListing && modelSelect?.value) {
        localStorage.setItem('last_model', modelSelect.value);
        localStorage.setItem(provider.storageKeys.model, modelSelect.value);
    }

    if (!provider.features.modelListing && providerModelInput && provider.storageKeys.model) {
        localStorage.setItem(provider.storageKeys.model, providerModelInput.value || '');
    }

    if (providerId === 'gemini' && modelSelect?.value) {
        localStorage.setItem('last_model', modelSelect.value);
        localStorage.setItem('last_model_gemini', modelSelect.value);
    }

    localStorage.setItem('theme', document.documentElement.getAttribute('data-theme') || 'dark');
}

function captureLocalStorageState() {
    const state = {};
    getManagedLocalStorageKeys()
        .sort((a, b) => a.localeCompare(b))
        .forEach(key => {
            const value = localStorage.getItem(key);
            if (value !== null) {
                state[key] = value;
            }
        });
    return state;
}

function normalizeLocalState(state = {}) {
    const normalized = {};

    Object.entries(state).forEach(([key, value]) => {
        if (!shouldSnapshotLocalStorageKey(key) || value === undefined || value === null) {
            return;
        }

        normalized[key] = typeof value === 'string' ? value : JSON.stringify(value);
    });

    return normalized;
}

function shallowCloneArray(records) {
    return Array.isArray(records) ? records.map(record => ({ ...record })) : [];
}

function legacyProfileToSnapshot(profile, name) {
    const localState = {};

    if (profile.credentials?.apiKey !== undefined) {
        localState.gemini_api_key = profile.credentials.apiKey || '';
    }
    if (profile.credentials?.lastModel !== undefined) {
        localState.last_model = profile.credentials.lastModel || '';
    }
    if (profile.theme !== undefined) {
        localState.theme = profile.theme || 'dark';
    }

    Object.entries(profile.inputs || {}).forEach(([key, value]) => {
        localState['input_' + key] = JSON.stringify(value);
    });

    Object.entries(profile.uiState?.collapsibleStates || {}).forEach(([key, value]) => {
        localState['collapsed_' + key] = String(Boolean(value));
    });

    const timestamp = profile.updatedAt || profile.createdAt || new Date().toISOString();

    return {
        name,
        version: PROFILE_VERSION,
        createdAt: profile.createdAt || timestamp,
        updatedAt: timestamp,
        localState,
        stores: {
            savedPrompts: [],
            refImages: [],
            settings: [],
            queueRefs: []
        }
    };
}

function normalizeProfileRecord(profile, fallbackName = '') {
    const name = (profile?.name || fallbackName || '').trim();
    if (!name) {
        throw new Error('Invalid profile name');
    }

    if (!profile.localState && (profile.credentials || profile.inputs || profile.uiState)) {
        return legacyProfileToSnapshot(profile, name);
    }

    const now = new Date().toISOString();
    return {
        name,
        version: profile.version || PROFILE_VERSION,
        createdAt: profile.createdAt || now,
        updatedAt: profile.updatedAt || now,
        localState: normalizeLocalState(profile.localState || {}),
        stores: {
            savedPrompts: shallowCloneArray(profile.stores?.savedPrompts),
            refImages: shallowCloneArray(profile.stores?.refImages),
            settings: shallowCloneArray(profile.stores?.settings),
            queueRefs: shallowCloneArray(profile.stores?.queueRefs)
        }
    };
}

function sanitizeProfileForExport(profile) {
    const normalized = normalizeProfileRecord(profile);
    const localState = { ...normalized.localState };
    Object.keys(localState).forEach(key => {
        if (/api[_-]?key/i.test(key)) {
            delete localState[key];
        }
    });

    return {
        ...normalized,
        localState,
        stores: {
            ...normalized.stores,
            settings: normalized.stores.settings
                .filter(record => !Object.prototype.hasOwnProperty.call(record, 'handle'))
        },
        exportedAt: new Date().toISOString(),
        exportSanitized: true
    };
}

function clearManagedLocalStorage(nextState) {
    const nextKeys = new Set(Object.keys(nextState));
    getManagedLocalStorageKeys().forEach(key => {
        if (key !== ACTIVE_PROFILE_KEY && !nextKeys.has(key)) {
            localStorage.removeItem(key);
        }
    });
}

function applyLocalStorageState(localState) {
    const normalized = normalizeLocalState(localState);
    clearManagedLocalStorage(normalized);

    Object.entries(normalized).forEach(([key, value]) => {
        localStorage.setItem(key, value);
    });
}

/**
 * Get active profile name
 */
export function getActiveProfile() {
    return localStorage.getItem(ACTIVE_PROFILE_KEY) || null;
}

function setActiveProfile(name) {
    if (name) {
        localStorage.setItem(ACTIVE_PROFILE_KEY, name);
    } else {
        localStorage.removeItem(ACTIVE_PROFILE_KEY);
    }
}

/**
 * Migrate legacy localStorage profiles to IndexedDB
 */
export async function initProfiles() {
    let legacyProfiles = {};

    try {
        const raw = localStorage.getItem(LEGACY_PROFILES_KEY);
        legacyProfiles = raw ? JSON.parse(raw) : {};
    } catch {
        legacyProfiles = {};
    }

    const entries = Object.entries(legacyProfiles);
    if (entries.length === 0) {
        return;
    }

    const existingNames = new Set((await getAllProfileRecords()).map(profile => profile.name));
    let migratedAny = false;

    for (const [name, legacyProfile] of entries) {
        if (!name || existingNames.has(name)) {
            continue;
        }

        const normalized = normalizeProfileRecord({
            ...legacyProfile,
            name
        }, name);

        await putProfileRecord(normalized);
        migratedAny = true;
    }

    localStorage.removeItem(LEGACY_PROFILES_KEY);

    if (migratedAny) {
        console.log('Migrated legacy profiles to IndexedDB');
    }
}

async function collectCurrentProfileSnapshot(name) {
    persistCurrentUiState();

    const existing = await getProfileRecord(name);
    const now = new Date().toISOString();
    const [savedPrompts, refImages, settings, queueRefs] = await Promise.all([
        readAllFromStore('savedPrompts'),
        readAllFromStore('refImages'),
        readAllFromStore('settings'),
        readAllFromStore('queueRefs')
    ]);

    return {
        name,
        version: PROFILE_VERSION,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        localState: captureLocalStorageState(),
        stores: {
            savedPrompts,
            refImages,
            settings,
            queueRefs
        }
    };
}

/**
 * Save current settings as a profile
 */
export async function saveProfile(name) {
    const trimmedName = name?.trim();
    if (!trimmedName) {
        showToast('Profile name required');
        return false;
    }

    try {
        const profile = await collectCurrentProfileSnapshot(trimmedName);
        await putProfileRecord(profile);
        setActiveProfile(trimmedName);
        showToast(`Profile "${trimmedName}" saved`);
        return true;
    } catch (e) {
        console.error('Failed to save profile:', e);
        showToast('Failed to save profile');
        return false;
    }
}

/**
 * Load a profile by name
 */
export async function loadProfile(name) {
    try {
        const profile = await getProfileRecord(name);
        if (!profile) {
            showToast(`Profile "${name}" not found`);
            return false;
        }

        const normalized = normalizeProfileRecord(profile, name);
        applyLocalStorageState(normalized.localState);

        await Promise.all([
            replaceStoreContents('savedPrompts', normalized.stores.savedPrompts),
            replaceStoreContents('refImages', normalized.stores.refImages),
            replaceStoreContents('settings', normalized.stores.settings),
            replaceStoreContents('queueRefs', normalized.stores.queueRefs)
        ]);

        setActiveProfile(name);
        return true;
    } catch (e) {
        console.error('Failed to load profile:', e);
        showToast('Failed to load profile');
        return false;
    }
}

/**
 * List all profile names
 */
export async function listProfiles() {
    try {
        const profiles = await getAllProfileRecords();
        return profiles
            .map(profile => profile.name)
            .sort((a, b) => a.localeCompare(b));
    } catch (e) {
        console.error('Failed to list profiles:', e);
        return [];
    }
}

/**
 * Delete a profile
 */
export async function deleteProfile(name) {
    try {
        const existing = await getProfileRecord(name);
        if (!existing) {
            showToast(`Profile "${name}" not found`);
            return false;
        }

        await deleteProfileRecord(name);
        if (getActiveProfile() === name) {
            setActiveProfile(null);
        }

        showToast(`Profile "${name}" deleted`);
        return true;
    } catch (e) {
        console.error('Failed to delete profile:', e);
        showToast('Failed to delete profile');
        return false;
    }
}

/**
 * Export profile as JSON file
 */
export async function exportProfile(name) {
    try {
        const profile = await getProfileRecord(name);
        if (!profile) {
            showToast(`Profile "${name}" not found`);
            return false;
        }

        const exportData = sanitizeProfileForExport(profile);
        const json = JSON.stringify(exportData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const safeFilename = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');

        const link = document.createElement('a');
        link.href = url;
        link.download = `${safeFilename}.profile.json`;
        link.click();

        URL.revokeObjectURL(url);
        showToast(`Profile "${name}" exported without API key`);
        return true;
    } catch (e) {
        console.error('Failed to export profile:', e);
        showToast('Failed to export profile');
        return false;
    }
}

/**
 * Import profile from JSON file
 */
export async function importProfile(file) {
    try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const profile = normalizeProfileRecord(parsed);

        await putProfileRecord(profile);
        showToast(`Profile "${profile.name}" imported`);
        return true;
    } catch (e) {
        console.error('Import failed:', e);
        showToast('Failed to import profile');
        return false;
    }
}
