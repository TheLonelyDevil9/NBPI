/**
 * Zoom Module
 * Pinch-to-zoom for fullscreen modal only
 */

import { FS_MAX_ZOOM, FS_MIN_ZOOM, DOUBLE_TAP_THRESHOLD } from './config.js';
import { $ } from './ui.js';

// Fullscreen zoom state
let fsScale = 1, fsPosX = 0, fsPosY = 0, fsLastScale = 1, fsLastX = 0, fsLastY = 0;
let fsStartDist = 0, fsStartX = 0, fsStartY = 0, fsPinching = false, fsDragging = false, fsLastTap = 0;
let zoomLevelTimeout = null;
let fsMouseDown = false, fsMouseStartX = 0, fsMouseStartY = 0;

// Current image reference (set externally)
let currentImg = null;

export function setCurrentImgRef(img) {
    currentImg = img;
}

export function getCurrentImg() {
    return currentImg;
}

// Cached fullscreen DOM elements
let fsElements = null;

function getFsElements() {
    if (!fsElements) {
        fsElements = {
            modal: $('fullscreenModal'),
            container: $('fullscreenContainer'),
            img: $('fullscreenImg'),
            zoomLevel: $('fullscreenZoomLevel')
        };
    }
    return fsElements;
}

// Reset image box to default (no zoom on main image box)
export function resetZoom() {
    const resultImg = $('resultImg');
    if (resultImg) {
        resultImg.style.transform = '';
    }
}

// Fullscreen zoom
function updateFullscreenZoom() {
    const fs = getFsElements();
    fs.img.style.transform = 'translate(' + fsPosX + 'px,' + fsPosY + 'px) scale(' + fsScale + ')';
    fs.modal.classList.toggle('zoomed', fsScale > 1.05);
    showZoomLevel();
}

function showZoomLevel() {
    const zoomEl = getFsElements().zoomLevel;
    zoomEl.textContent = Math.round(fsScale * 100) + '%';
    zoomEl.classList.add('visible');
    clearTimeout(zoomLevelTimeout);
    zoomLevelTimeout = setTimeout(() => zoomEl.classList.remove('visible'), 1500);
}

export function fsResetZoom() {
    fsScale = 1; fsPosX = 0; fsPosY = 0; fsLastScale = 1; fsLastX = 0; fsLastY = 0;
    updateFullscreenZoom();
}

export function fsZoomIn() {
    fsScale = Math.min(FS_MAX_ZOOM, fsScale * 1.5);
    fsClampPos();
    updateFullscreenZoom();
}

export function fsZoomOut() {
    const oldScale = fsScale;
    fsScale = Math.max(FS_MIN_ZOOM, fsScale / 1.5);
    if (oldScale !== fsScale) {
        const factor = fsScale / oldScale;
        fsPosX *= factor;
        fsPosY *= factor;
    }
    fsClampPos();
    updateFullscreenZoom();
}

function fsClampPos() {
    if (fsScale <= 1) { fsPosX = 0; fsPosY = 0; return; }
    const fs = getFsElements();
    if (!fs.container || !fs.img) return;
    const containerRect = fs.container.getBoundingClientRect();
    const imgRect = fs.img.getBoundingClientRect();
    const baseWidth = imgRect.width / fsScale;
    const baseHeight = imgRect.height / fsScale;
    const maxX = Math.max(0, (baseWidth * fsScale - containerRect.width) / 2);
    const maxY = Math.max(0, (baseHeight * fsScale - containerRect.height) / 2);
    fsPosX = Math.max(-maxX, Math.min(maxX, fsPosX));
    fsPosY = Math.max(-maxY, Math.min(maxY, fsPosY));
}

// Open fullscreen modal
export function openFullscreen() {
    if (!currentImg) return;
    const fs = getFsElements();
    fs.img.src = currentImg;
    fs.modal.classList.add('open');
    fsResetZoom();
}

export function closeFullscreen() {
    getFsElements().modal.classList.remove('open');
}

// Setup all zoom event handlers
export function setupZoomHandlers() {
    const imageBox = $('imageBox');
    const resultImg = $('resultImg');
    const fs = getFsElements();
    const fsContainer = fs.container;

    // Image box click for fullscreen (zoom only available in fullscreen modal)
    imageBox.addEventListener('click', e => {
        if (!resultImg.classList.contains('hidden') && currentImg) {
            openFullscreen();
        }
    });

    // Image load reset
    resultImg.addEventListener('load', resetZoom);

    // Fullscreen container handlers
    fsContainer.addEventListener('click', e => {
        if (fsScale <= 1.05 && !fsDragging && e.target === fsContainer) {
            closeFullscreen();
        }
    });

    fsContainer.addEventListener('dblclick', e => {
        e.preventDefault();
        if (fsScale > 1.05) {
            fsResetZoom();
        } else {
            const rect = fsContainer.getBoundingClientRect();
            const clickX = e.clientX - rect.left - rect.width / 2;
            const clickY = e.clientY - rect.top - rect.height / 2;
            fsScale = 3;
            fsPosX = -clickX * 2;
            fsPosY = -clickY * 2;
            fsClampPos();
            updateFullscreenZoom();
        }
    });

    fsContainer.addEventListener('wheel', e => {
        e.preventDefault();
        const rect = fsContainer.getBoundingClientRect();
        const cursorX = e.clientX - rect.left - rect.width / 2;
        const cursorY = e.clientY - rect.top - rect.height / 2;
        const oldScale = fsScale;
        fsScale = Math.max(FS_MIN_ZOOM, Math.min(FS_MAX_ZOOM, fsScale * (e.deltaY > 0 ? 0.85 : 1.18)));
        if (fsScale !== oldScale) {
            const factor = fsScale / oldScale;
            fsPosX = cursorX - (cursorX - fsPosX) * factor;
            fsPosY = cursorY - (cursorY - fsPosY) * factor;
        }
        fsClampPos();
        updateFullscreenZoom();
    }, { passive: false });

    // Mouse drag for fullscreen panning
    fsContainer.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        fsMouseDown = true;
        fsDragging = false;
        fsMouseStartX = e.clientX;
        fsMouseStartY = e.clientY;
        fsLastX = fsPosX;
        fsLastY = fsPosY;
        fsContainer.classList.add('dragging');
        e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
        if (!fsMouseDown) return;
        const dx = e.clientX - fsMouseStartX;
        const dy = e.clientY - fsMouseStartY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) fsDragging = true;
        fsPosX = fsLastX + dx;
        fsPosY = fsLastY + dy;
        fsClampPos();
        updateFullscreenZoom();
    });

    document.addEventListener('mouseup', e => {
        if (fsMouseDown) {
            fsMouseDown = false;
            fsContainer.classList.remove('dragging');
            setTimeout(() => fsDragging = false, 10);
        }
    });

    // Touch handlers for fullscreen
    fsContainer.addEventListener('touchstart', e => {
        const now = Date.now();
        if (e.touches.length === 1 && now - fsLastTap < DOUBLE_TAP_THRESHOLD) {
            e.preventDefault();
            if (fsScale > 1.05) {
                fsResetZoom();
            } else {
                fsScale = 3;
                updateFullscreenZoom();
            }
            fsLastTap = 0;
            return;
        }
        fsLastTap = now;

        if (e.touches.length === 2) {
            e.preventDefault();
            fsPinching = true;
            fsDragging = false;
            fsStartDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            fsLastScale = fsScale;
            const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            fsStartX = midX;
            fsStartY = midY;
            fsLastX = fsPosX;
            fsLastY = fsPosY;
        } else if (e.touches.length === 1) {
            fsDragging = true;
            fsPinching = false;
            fsStartX = e.touches[0].clientX;
            fsStartY = e.touches[0].clientY;
            fsLastX = fsPosX;
            fsLastY = fsPosY;
        }
    }, { passive: false });

    fsContainer.addEventListener('touchmove', e => {
        if (fsPinching && e.touches.length === 2) {
            e.preventDefault();
            const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            fsScale = Math.max(FS_MIN_ZOOM, Math.min(FS_MAX_ZOOM, fsLastScale * dist / fsStartDist));
            const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            fsPosX = fsLastX + midX - fsStartX;
            fsPosY = fsLastY + midY - fsStartY;
            fsClampPos();
            updateFullscreenZoom();
        } else if (fsDragging && e.touches.length === 1 && fsScale > 1) {
            e.preventDefault();
            fsPosX = fsLastX + e.touches[0].clientX - fsStartX;
            fsPosY = fsLastY + e.touches[0].clientY - fsStartY;
            fsClampPos();
            updateFullscreenZoom();
        }
    }, { passive: false });

    fsContainer.addEventListener('touchend', e => {
        if (e.touches.length < 2) { fsPinching = false; fsLastScale = fsScale; fsLastX = fsPosX; fsLastY = fsPosY; }
        if (e.touches.length === 0) { fsDragging = false; if (fsScale < 1.1) fsResetZoom(); }
    });

    // Keyboard shortcuts in fullscreen
    document.addEventListener('keydown', e => {
        if (!fs.modal.classList.contains('open')) return;
        if (e.key === 'Escape') closeFullscreen();
        else if (e.key === '+' || e.key === '=') fsZoomIn();
        else if (e.key === '-') fsZoomOut();
        else if (e.key === '0') fsResetZoom();
    });
}

// Make functions globally available for HTML onclick handlers
window.openFullscreen = openFullscreen;
window.closeFullscreen = closeFullscreen;
window.fsZoomIn = fsZoomIn;
window.fsZoomOut = fsZoomOut;
window.fsResetZoom = fsResetZoom;
