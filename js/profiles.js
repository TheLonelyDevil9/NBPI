/**
 * Profile Management Module
 * File-based profile persistence with import/export
 */

import { showToast } from './ui.js';

// Profile storage key
const PROFILES_KEY = 'nbp_profiles';
const ACTIVE_PROFILE_KEY = 'nbp_active_profile';

/**
 * Get all profiles from localStorage
 */
function getAllProfiles() {
    try {
        const data = localStorage.getItem(PROFILES_KEY);
        return data ? JSON.parse(data) : {};
    } catch {
        return {};
    }
}

/**
 * Save all profiles to localStorage
 */
function saveAllProfiles(profiles) {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

/**
 * Get active profile name
 */
export function getActiveProfile() {
    return localStorage.getItem(ACTIVE_PROFILE_KEY) || null;
}

/**
 * Set active profile name
 */
function setActiveProfile(name) {
    if (name) {
        localStorage.setItem(ACTIVE_PROFILE_KEY, name);
    } else {
        localStorage.removeItem(ACTIVE_PROFILE_KEY);
    }
}

/**
 * Collect current settings into profile object
 */
function collectCurrentSettings() {
    const profile = {
        version: '1.0',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        credentials: {
            apiKey: localStorage.getItem('gemini_api_key') || '',
            lastModel: localStorage.getItem('last_model') || ''
        },
        theme: localStorage.getItem('theme') || 'dark',
        inputs: {},
        safetySettings: {},
        uiState: {
            collapsibleStates: {}
        }
    };

    // Collect all input_ prefixed items
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('input_')) {
            const settingKey = key.replace('input_', '');
            try {
                profile.inputs[settingKey] = JSON.parse(localStorage.getItem(key));
            } catch {
                profile.inputs[settingKey] = localStorage.getItem(key);
            }
        } else if (key.startsWith('collapsed_')) {
            const settingKey = key.replace('collapsed_', '');
            profile.uiState.collapsibleStates[settingKey] = localStorage.getItem(key) === 'true';
        }
    }

    return profile;
}

/**
 * Apply profile settings to localStorage and UI
 */
function applyProfileSettings(profile) {
    // Apply credentials
    if (profile.credentials) {
        if (profile.credentials.apiKey) {
            localStorage.setItem('gemini_api_key', profile.credentials.apiKey);
        }
        if (profile.credentials.lastModel) {
            localStorage.setItem('last_model', profile.credentials.lastModel);
        }
    }

    // Apply theme
    if (profile.theme) {
        localStorage.setItem('theme', profile.theme);
    }

    // Apply inputs
    if (profile.inputs) {
        Object.entries(profile.inputs).forEach(([key, value]) => {
            localStorage.setItem('input_' + key, JSON.stringify(value));
        });
    }

    // Apply UI state
    if (profile.uiState?.collapsibleStates) {
        Object.entries(profile.uiState.collapsibleStates).forEach(([key, value]) => {
            localStorage.setItem('collapsed_' + key, value.toString());
        });
    }
}

/**
 * Save current settings as a profile
 */
export function saveProfile(name) {
    if (!name || !name.trim()) {
        showToast('Profile name required');
        return false;
    }

    const profiles = getAllProfiles();
    const profile = collectCurrentSettings();
    profile.name = name.trim();

    profiles[name.trim()] = profile;
    saveAllProfiles(profiles);
    setActiveProfile(name.trim());

    showToast(`Profile "${name}" saved`);
    return true;
}

/**
 * Load a profile by name
 */
export function loadProfile(name) {
    const profiles = getAllProfiles();
    const profile = profiles[name];

    if (!profile) {
        showToast(`Profile "${name}" not found`);
        return false;
    }

    applyProfileSettings(profile);
    setActiveProfile(name);

    showToast(`Profile "${name}" loaded`);
    return true;
}

/**
 * List all profile names
 */
export function listProfiles() {
    const profiles = getAllProfiles();
    return Object.keys(profiles).sort();
}

/**
 * Delete a profile
 */
export function deleteProfile(name) {
    const profiles = getAllProfiles();

    if (!profiles[name]) {
        showToast(`Profile "${name}" not found`);
        return false;
    }

    delete profiles[name];
    saveAllProfiles(profiles);

    // Clear active profile if it was deleted
    if (getActiveProfile() === name) {
        setActiveProfile(null);
    }

    showToast(`Profile "${name}" deleted`);
    return true;
}

/**
 * Export profile as JSON file
 */
export function exportProfile(name) {
    const profiles = getAllProfiles();
    const profile = profiles[name];

    if (!profile) {
        showToast(`Profile "${name}" not found`);
        return false;
    }

    const json = JSON.stringify(profile, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.profile.json`;
    a.click();

    URL.revokeObjectURL(url);
    showToast(`Profile "${name}" exported`);
    return true;
}

/**
 * Import profile from JSON file
 */
export async function importProfile(file) {
    try {
        const text = await file.text();
        const profile = JSON.parse(text);

        if (!profile.version || !profile.name) {
            showToast('Invalid profile file');
            return false;
        }

        const profiles = getAllProfiles();
        profiles[profile.name] = profile;
        saveAllProfiles(profiles);

        showToast(`Profile "${profile.name}" imported`);
        return true;
    } catch (e) {
        console.error('Import failed:', e);
        showToast('Failed to import profile');
        return false;
    }
}

