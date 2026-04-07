# Changelog

## [Unreleased] - 2026-03-16

### Added
- **Generation History**: Every generation now saves its full prompt, config, and reference images to IndexedDB
  - New `generationHistory` store (IndexedDB v5) with auto-prune at 500 entries
  - **Info button** on the image panel (between Iterate and Delete) opens a details overlay for the currently displayed image
  - **Info button** on completed queue items in the queue panel
  - **Details overlay** with full prompt (copyable), config badges (model, ratio, resolution, thinking, search, generation time, filename), reference image thumbnails with individual Save and Save All, and a Redo button
  - **Redo** loads the prompt + references back into the main UI for quick re-generation
  - History entries persist across sessions and browser restarts

- **History Panel**: Persistent generation tracker accessible at all times
  - Always-visible clock FAB (bottom-left corner) opens a slide-in history panel
  - Lists the last 100 generations with prompt snippets, config badges, and relative timestamps (e.g. "2m ago", "3h ago")
  - Click any entry to open the full details overlay
  - Delete individual entries with hover-revealed × button
  - Clear All button with confirmation dialog
  - Completely independent of queue state — accessible even with no active queue

- **Reference Image Drag-to-Reorder**: Control the order images are sent to the API
  - Ref thumbnails are now draggable — grab and drop to change position
  - Visual drop indicators (gold side shadows) show where the image will land
  - Order persists to IndexedDB
  - File drops from desktop still work without interference
  - Order matters: Gemini processes reference images in array order, so "first image" / "second image" in prompts maps to thumbnail order

### Changed
- **Simplified UI**: Right panel action buttons now: Iterate, Info, Delete (was: Iterate, Delete)
- IndexedDB bumped from v4 to v5 (adds `generationHistory` store, existing data preserved via migration)
- `history.js` now exports generation history CRUD functions alongside existing queue ref functions
- `queueUI.js` now imports from `history.js` for generation details and history panel
- `generation.js` tracks `currentHistoryId` state alongside `currentImg` and `currentFilename`
- `references.js` ref thumbnails render with `draggable="true"` and `data-ref-idx` attributes
- Desktop file drop handler (`setupRefDragDrop`) now skips `preventDefault` during internal reorder drags
- New CSS variables: `--color-info` (#0891b2) and `--color-info-hover` (#0e7490)

### Technical Details

**Generation History Schema:**
```js
{
  id: 'gh_<timestamp>_<random>',
  prompt: string,
  config: { model, ratio, resolution, thinkingBudget, searchEnabled },
  refImages: [{ data: 'data:image/jpeg;base64,...' }],
  filename: string | null,
  batchName: string,
  name: string,
  createdAt: timestamp,
  generationTimeMs: number
}
```

**Data Flow:**
1. Queue completes a generation → builds history entry from queue item
2. `saveHistoryEntry()` persists to IndexedDB (before `deleteQueueRefsMultiple`)
3. `setCurrentHistoryId()` updates generation.js state → enables Info button
4. Every 50 completions, `pruneHistory()` trims to 500 entries

### Files Modified
- `js/config.js` — Added `MAX_HISTORY_ITEMS = 500`
- `js/history.js` — DB v5, `generationHistory` store, 6 new CRUD functions
- `js/queue.js` — Saves history entry after each successful generation
- `js/generation.js` — `currentHistoryId` state, Info button enable/disable, `openCurrentImageDetails` global
- `js/queueUI.js` — Info button on completed queue items, generation details overlay, history panel with toggle/render/delete/clear
- `js/references.js` — Drag-to-reorder handlers, desktop drop handler guard
- `index.html` — Info button in actions bar, history FAB, history overlay + panel
- `css/variables.css` — `--color-info`, `--color-info-hover`
- `css/components.css` — `.btn-info`, ref drag styles, history FAB, history panel
- `css/modals.css` — Generation details overlay styles

## [Unreleased] - 2026-03-15

### Changed
- **Unified queue-based generation**: All generations now go through the queue system. The "Generate" button queues and auto-starts — no more separate Quick Generate vs queue paths
- **Simplified UI**: Removed "+ Queue", "Queue Another", "Queue Iterate", and "Cancel" buttons. Action buttons are now just: Generate, Batch Setup, Clear. Right panel: Iterate, Delete
- **Safe Delete**: Delete button now only clears the UI display — generated image files are preserved on disk (previously permanently deleted via File System Access API with no recycle bin)
- **API key security**: Moved API key from URL query string to `x-goog-api-key` header in all Gemini API calls (prevents exposure in browser history and network logs)
- **Rate limit recovery**: Queue delay now resets to original value after a successful generation following rate-limit backoff (previously stayed doubled permanently)
- **AudioContext reuse**: Notification sound now reuses a single AudioContext instead of creating a new one per notification (prevents browser context limits)
- **Image compression**: Use `createImageBitmap()` for non-blocking image decode instead of synchronous `Image()` constructor (prevents UI freeze when adding multiple reference images)
- **Zoom element caching**: Cached fullscreen DOM elements to avoid repeated `getElementById` calls in wheel/touch/mouse event handlers
- **Queue ref efficiency**: Queue items now share reference image objects instead of shallow-cloning each one per variation (refs are read-only data URLs)
- **Persistence debounce**: Increased input persistence debounce from 300ms to 1000ms (reduces unnecessary localStorage writes during typing)
- **Filename prefix on main screen**: New input field lets you set a filename prefix for single generations (same as batch name in Batch Setup). Persisted across sessions
- **Profile export security**: API key is now stripped from exported profile JSON files

### Fixed
- Removed shadowed `$` function in `getSafetySettings()` (generation.js)
- Removed dead code branch in `clearAll()` (unreachable fallback import)
- Model refresh button now guards against concurrent fetches (prevents spam-clicking from spawning multiple requests)

## [Unreleased] - 2026-03-14

### Added
- **Per-Box Drop Zones**: Each batch prompt box now has a visible drop zone for reference images
  - Drag image files from Explorer directly onto a prompt box to add refs
  - Clipboard paste (Ctrl+V) targets the last-clicked/focused box with visual indicator
  - Drop zone shows 48×48 thumbnails of attached refs with hover-to-remove buttons
  - Click the drop zone or its "+" button to open file picker
  - "Clear" button to revert a box to global refs
  - Active paste target highlighted with golden glow border
  - No conflict with drag-to-reorder (uses separate drag handle)

## [Unreleased] - 2026-03-13

### Added
- **Per-Prompt Name Labels**: Optional `name` field per prompt for readable filenames
  - Adds a "Filename label" input to each prompt box in batch setup
  - When set, replaces the truncated prompt snippet in the filename
  - Format: `{batchName}_{name}_{timestamp}{variation}.<ext>`
  - Supports batch JSON import/export (`"name": "elf-archer"`)
  - Duplicated boxes inherit the source name
  - Falls back to prompt snippet (first 40 chars) when no name is set

## [Unreleased] - 2026-03-12

### Added
- **LinkAPI Response Diagnostics**: Hidden live mapping for LinkAPI image responses
  - Enable with `localStorage.nbpi_linkapi_debug = '1'`
  - Logs the sanitized request body, response metadata, candidate paths, source kinds, MIME types, and fetched asset sizes
  - Helps confirm whether LinkAPI is returning PNG, JPEG, or mixed candidates before save

- **Generated Output Format Handling**: Saved files now keep the actual provider MIME type
  - Gemini API still returns PNG by default
  - LinkAPI now fails generations that do not resolve to `image/png`
  - Prevents JPEG responses from being mislabeled as full-quality PNG files
  - Reference images remain JPEG for compression efficiency (70% storage reduction)

- **Variations Input on Main Screen**: Generate multiple variations without opening batch modal
  - New "Variations" input field (1-10) next to Resolution
  - When variations > 1, automatically uses queue system
  - Opens queue panel and starts generation
  - Persisted across sessions like other settings
  - Streamlined UX - no need to open batch setup for simple multi-generation

- **Profile Management System**: Local profile persistence for settings and configurations
  - Save/Load/Delete profiles with custom names
  - Export profiles as JSON files for backup or sharing
  - Import profiles from JSON files
  - Profiles stored in localStorage (survives browser cache clears)
  - Active profile indicator in UI
  - Profile management UI in collapsible section
  - Profiles excluded from git via `.gitignore`

### Changed
- `js/api.js`: Added optional response metadata capture for provider debugging
- `js/filesystem.js`: Preserves the actual image extension on save
- `js/providers/linkApiProvider.js`: Collects all image candidates, prefers PNG, and rejects non-PNG LinkAPI outputs
- `js/generation.js`: Added variations support to main generate function
- `js/persistence.js`: Added variations input to persistence system
- `index.html`: Added variations input field to main UI
- `.gitignore`: Added `profiles/` and `*.profile.json` exclusions
- `README.md`: Documented provider-dependent output formats and LinkAPI PNG enforcement

### Technical Details

**LinkAPI Output Validation:**
- Response mapping inspects all returned image candidates before choosing one
- Candidate selection prefers PNG over JPEG, WebP, and GIF
- Non-PNG LinkAPI results fail before history save or filesystem write
- Request-side format flags remain unchanged until LinkAPI confirms a supported PNG control

**Profile Structure:**
```json
{
  "name": "profile-name",
  "version": "1.0",
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp",
  "credentials": { "apiKey": "...", "lastModel": "..." },
  "theme": "dark",
  "inputs": { "prompt": "", "ratio": "3:4", ... },
  "safetySettings": { ... },
  "uiState": { "collapsibleStates": { ... } }
}
```

### Files Modified
- `js/api.js` - Optional response metadata capture
- `js/filesystem.js` - Provider-aware extension preservation
- `js/providers/linkApiProvider.js` - LinkAPI candidate mapping and strict PNG validation
- `js/profiles.js` - New profile management module
- `js/app.js` - Profile UI initialization and handlers
- `index.html` - Profile management UI section
- `css/components.css` - Profile section styling
- `.gitignore` - Profile exclusions
- `README.md` - Output format documentation

### Testing Recommendations
1. Enable `localStorage.nbpi_linkapi_debug = '1'` and verify LinkAPI debug logs show response metadata plus candidate MIME details
2. Generate a Gemini image and verify it still saves as `.png`
3. Generate a LinkAPI image that resolves to PNG and verify it saves as `.png`
4. Generate a LinkAPI image that resolves to JPEG and verify the generation fails before save
5. Create a profile with custom settings
6. Load profile and verify settings are restored
7. Export/import profile and verify data integrity
8. Delete profile and verify cleanup
9. Check git status to confirm profiles are ignored
