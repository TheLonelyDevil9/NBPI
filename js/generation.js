/**
 * Generation Module
 * Image generation orchestration — all generations go through the queue
 */

import { $, showToast, updatePlaceholder } from './ui.js';
import { refImages, renderRefs, compressImage, saveRefImages } from './references.js';
import { saveLastModel, persistAllInputs } from './persistence.js';
import { resetZoom, setCurrentImgRef } from './zoom.js';
import { MAX_REFS } from './config.js';
import {
    getCurrentProvider,
    getCurrentProviderPublicConfig,
    getProvider,
    getProviderExecutionConfig,
    persistCurrentProviderState,
    providerSupports,
    validateCurrentProviderUi
} from './providers/index.js';

// Generation state
let currentImg = null;
let currentFilename = null;
let currentHistoryId = null;

// Cached DOM elements
let cachedElements = null;

function getCachedElements() {
    if (!cachedElements) {
        cachedElements = {
            apiKey: $('apiKey'),
            modelSelect: $('modelSelect'),
            prompt: $('prompt'),
            ratio: $('ratio'),
            resolution: $('resolution'),
            searchToggle: $('searchToggle'),
            thinkingToggle: $('thinkingToggle'),
            thinkingBudget: $('thinkingBudget'),
            variations: $('variations'),
            generateBtn: $('generateBtn'),
            error: $('error'),
            groundingInfo: $('groundingInfo'),
            resultImg: $('resultImg'),
            imageBox: $('imageBox'),
            placeholder: $('placeholder'),
            iterateBtn: $('iterateBtn'),
            deleteBtn: $('deleteBtn'),
            infoBtn: $('infoBtn')
        };
    }
    return cachedElements;
}

function syncImageActionState() {
    const el = getCachedElements();
    el.iterateBtn.disabled = !currentImg || !providerSupports('refs');
    el.deleteBtn.disabled = !currentImg;
    if (el.infoBtn) el.infoBtn.disabled = !currentHistoryId;
}

// Set current image (and update zoom module)
export function setCurrentImg(img) {
    currentImg = img;
    setCurrentImgRef(img);
}

// Set/get current history ID (set by queue after saving history entry)
export function setCurrentHistoryId(id) {
    currentHistoryId = id;
    syncImageActionState();
}

export function getCurrentHistoryId() {
    return currentHistoryId;
}

// Show image in the right panel (used by queue completion callback)
export function showImageResult(imageData, filename) {
    const el = getCachedElements();
    currentImg = imageData;
    currentFilename = filename || null;
    setCurrentImgRef(currentImg);

    el.resultImg.src = currentImg;
    el.resultImg.classList.remove('hidden');
    el.placeholder.classList.add('hidden');
    el.imageBox.classList.add('has-image');
    syncImageActionState();
    resetZoom();
}

/**
 * Generate a single image - reusable core function for queue processing
 */
export async function generateSingleImage(prompt, config, refImagesData = [], signal = null) {
    const provider = getProvider(config.providerId);
    return provider.generateImage({
        prompt,
        config: getProviderExecutionConfig({
            ...config,
            refImages: refImagesData
        }),
        signal,
        updateStatus: updatePlaceholder
    });
}

/**
 * Get current generation config from UI
 */
export function getCurrentConfig() {
    const el = getCachedElements();
    const provider = getCurrentProvider();

    return {
        ...getCurrentProviderPublicConfig(),
        ratio: el.ratio.value,
        resolution: el.resolution.value,
        thinkingBudget: provider.features.thinking && el.thinkingToggle.checked
            ? parseInt(el.thinkingBudget.value)
            : 0,
        searchEnabled: provider.features.search ? el.searchToggle.checked : false,
        safetySettings: provider.features.safety ? getSafetySettings() : []
    };
}

function getSafetySettings() {
    const settings = [];

    const harassment = $('safetyHarassment')?.value;
    const hateSpeech = $('safetyHateSpeech')?.value;
    const sexuallyExplicit = $('safetySexuallyExplicit')?.value;
    const dangerous = $('safetyDangerous')?.value;

    if (harassment) settings.push({ category: 'HARM_CATEGORY_HARASSMENT', threshold: harassment });
    if (hateSpeech) settings.push({ category: 'HARM_CATEGORY_HATE_SPEECH', threshold: hateSpeech });
    if (sexuallyExplicit) settings.push({ category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: sexuallyExplicit });
    if (dangerous) settings.push({ category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: dangerous });

    return settings;
}

// Main generate function — always queues and auto-starts
export async function generate() {
    const el = getCachedElements();
    const provider = getCurrentProvider();

    persistCurrentProviderState();

    const providerError = validateCurrentProviderUi();
    if (providerError) return showToast(providerError);
    if (!el.prompt.value.trim()) return showToast('Enter prompt');
    if (!provider.features.refs && refImages.length > 0) {
        return showToast(`${provider.label} does not support reference images`);
    }

    const variations = parseInt(el.variations?.value || 1);
    const config = getCurrentConfig();
    const prefix = $('filenamePrefix')?.value?.trim() || '';
    const { addToQueue, startQueue } = await import('./queue.js');
    const { toggleQueuePanel } = await import('./queueUI.js');

    addToQueue([el.prompt.value], variations, config, refImages, prefix);
    startQueue();
    toggleQueuePanel(true);
    saveLastModel();
    showToast(`Generating ${variations} image${variations > 1 ? 's' : ''}...`);
}

// Iterate (add current image to references)
export async function iterate() {
    if (!currentImg) return;
    const el = getCachedElements();
    if (!providerSupports('refs')) {
        showToast('Current provider does not support reference images');
        return;
    }
    if (refImages.length >= MAX_REFS) {
        showToast('Maximum ' + MAX_REFS + ' reference images reached');
        return;
    }

    el.iterateBtn.disabled = true;

    try {
        const compressed = await compressImage(currentImg);
        refImages.push({ id: Date.now() + Math.random(), data: compressed });
        renderRefs();
        await saveRefImages();
        persistAllInputs();
        showToast('Added to references');
    } catch (err) {
        console.error('Failed to add iterated image to references:', err);
        showToast('Failed to add image to references');
    } finally {
        syncImageActionState();
    }
}

// Clear current image from display (file remains on disk)
export function deleteCurrentImage() {
    if (!currentImg) return;
    const el = getCachedElements();

    // Clear display
    currentImg = null;
    currentFilename = null;
    currentHistoryId = null;
    setCurrentImgRef(null);
    el.resultImg.src = '';
    el.resultImg.classList.add('hidden');
    el.placeholder.classList.remove('hidden');
    updatePlaceholder('Ready to create!');
    el.imageBox.classList.remove('has-image', 'is-zoomed');
    el.error.classList.add('hidden');
    el.groundingInfo.classList.add('hidden');
    syncImageActionState();
    resetZoom();
    showToast('Cleared');
}

// Clear all: refs, prompt, and output
export function clearAll() {
    const el = getCachedElements();

    if (typeof window.clearRefsQuiet === 'function') {
        window.clearRefsQuiet();
    }

    el.prompt.value = '';
    import('./ui.js').then(m => m.updateCharCounter());

    if (currentImg) {
        currentImg = null;
        currentFilename = null;
        currentHistoryId = null;
        setCurrentImgRef(null);
        el.resultImg.src = '';
        el.resultImg.classList.add('hidden');
        el.placeholder.classList.remove('hidden');
        updatePlaceholder('Ready to create!');
        el.imageBox.classList.remove('has-image', 'is-zoomed');
        el.error.classList.add('hidden');
        el.groundingInfo.classList.add('hidden');
        syncImageActionState();
        resetZoom();
    }

    import('./persistence.js').then(m => m.persistAllInputs());
    showToast('All cleared');
}
