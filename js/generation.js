/**
 * Generation Module
 * Image generation orchestration — all generations go through the queue
 */

import { $, showToast, updatePlaceholder } from './ui.js';
import { generateWithRetry, parseApiError } from './api.js';
import { refImages, renderRefs } from './references.js';
import { saveLastModel, persistAllInputs } from './persistence.js';
import { resetZoom, setCurrentImgRef } from './zoom.js';
import { MAX_REFS } from './config.js';
import { saveImageToFilesystem, getDirectoryInfo } from './filesystem.js';

// Generation state
let currentImg = null;
let currentFilename = null;

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
            deleteBtn: $('deleteBtn')
        };
    }
    return cachedElements;
}

// Set current image (and update zoom module)
export function setCurrentImg(img) {
    currentImg = img;
    setCurrentImgRef(img);
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
    el.iterateBtn.disabled = false;
    el.deleteBtn.disabled = false;
    resetZoom();
}

/**
 * Generate a single image - reusable core function for queue processing
 */
export async function generateSingleImage(prompt, config, refImagesData = [], signal = null) {
    // Build user message parts
    const userParts = [];
    if (refImagesData && refImagesData.length > 0) {
        refImagesData.forEach((img) => {
            const match = img.data?.match(/^data:(.+);base64,(.+)$/);
            if (match) {
                userParts.push({ inlineData: { mimeType: match[1], data: match[2] } });
            }
        });
    }
    userParts.push({ text: prompt });

    const userContent = { role: 'user', parts: userParts };

    // Build generation config
    const genConfig = { responseModalities: ['TEXT', 'IMAGE'] };
    genConfig.imageConfig = {};
    if (config.ratio) genConfig.imageConfig.aspectRatio = config.ratio;
    if (config.resolution) genConfig.imageConfig.imageSize = config.resolution;

    // Handle thinking config
    if (config.thinkingBudget !== undefined) {
        if (config.thinkingBudget === 0) {
            genConfig.thinkingConfig = { thinkingBudget: 0 };
        } else if (config.thinkingBudget > 0) {
            genConfig.thinkingConfig = { thinkingBudget: config.thinkingBudget };
        }
    }

    const body = { contents: [userContent], generationConfig: genConfig };

    if (config.searchEnabled) {
        body.tools = [{ google_search: {} }];
    }

    if (config.safetySettings && config.safetySettings.length > 0) {
        body.safetySettings = config.safetySettings;
    }

    const data = await generateWithRetry(config.model, body, signal);

    const candidate = data.candidates?.[0];
    const contentParts = candidate?.content?.parts;
    const imgPart = contentParts?.find(p => p.inlineData && !p.thought);

    if (!imgPart) {
        const txtPart = contentParts?.find(p => p.text);
        throw new Error(txtPart?.text || 'No image returned');
    }

    const imageData = 'data:' + (imgPart.inlineData.mimeType || 'image/png') + ';base64,' + imgPart.inlineData.data;

    return {
        imageData,
        grounding: candidate?.groundingMetadata
    };
}

/**
 * Get current generation config from UI
 */
export function getCurrentConfig() {
    const el = getCachedElements();
    return {
        model: el.modelSelect.value,
        ratio: el.ratio.value,
        resolution: el.resolution.value,
        thinkingBudget: el.thinkingToggle.checked
            ? parseInt(el.thinkingBudget.value)
            : 0,
        searchEnabled: el.searchToggle.checked,
        safetySettings: getSafetySettings()
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

    if (!el.apiKey.value) return showToast('Enter API key');
    if (!el.modelSelect.value) return showToast('Select model');
    if (!el.prompt.value.trim()) return showToast('Enter prompt');

    const variations = parseInt(el.variations?.value || 1);
    const config = getCurrentConfig();
    const { addToQueue, startQueue } = await import('./queue.js');
    const { toggleQueuePanel } = await import('./queueUI.js');

    addToQueue([el.prompt.value], variations, config, refImages, '');
    startQueue();
    toggleQueuePanel(true);
    saveLastModel();
    showToast(`Generating ${variations} image${variations > 1 ? 's' : ''}...`);
}

// Iterate (add current image to references)
export function iterate() {
    if (!currentImg) return;
    if (refImages.length >= MAX_REFS) {
        showToast('Maximum ' + MAX_REFS + ' reference images reached');
        return;
    }
    refImages.push({ id: Date.now() + Math.random(), data: currentImg });
    renderRefs();
    persistAllInputs();
    showToast('Added to references');
}

// Clear current image from display (file remains on disk)
export function deleteCurrentImage() {
    if (!currentImg) return;
    const el = getCachedElements();

    // Clear display
    currentImg = null;
    currentFilename = null;
    setCurrentImgRef(null);
    el.resultImg.src = '';
    el.resultImg.classList.add('hidden');
    el.placeholder.classList.remove('hidden');
    updatePlaceholder('Ready to create!');
    el.imageBox.classList.remove('has-image', 'is-zoomed');
    el.error.classList.add('hidden');
    el.groundingInfo.classList.add('hidden');
    el.iterateBtn.disabled = true;
    el.deleteBtn.disabled = true;
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
        setCurrentImgRef(null);
        el.resultImg.src = '';
        el.resultImg.classList.add('hidden');
        el.placeholder.classList.remove('hidden');
        updatePlaceholder('Ready to create!');
        el.imageBox.classList.remove('has-image', 'is-zoomed');
        el.error.classList.add('hidden');
        el.groundingInfo.classList.add('hidden');
        el.iterateBtn.disabled = true;
        el.deleteBtn.disabled = true;
        resetZoom();
    }

    import('./persistence.js').then(m => m.persistAllInputs());
    showToast('All cleared');
}

// Make functions globally available for HTML onclick handlers
window.generate = generate;
window.iterate = iterate;
window.deleteCurrentImage = deleteCurrentImage;
window.clearAll = clearAll;
