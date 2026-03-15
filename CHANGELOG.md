# Changelog

## [Unreleased] - 2026-03-15

### Added
- **Multiple Queue Entry Points**: Several new ways to add generations to the queue
  - **+ Queue button**: Adds current prompt/config/refs to queue without starting — accumulate items, start when ready
  - **Queue Iterate button**: Adds current image to refs then queues the prompt (right panel, next to Iterate)
  - **Ctrl+Shift+Enter shortcut**: Add to queue from anywhere (prompt textarea or global)
  - All new pathways accumulate without auto-starting, unlike Quick Generate

### Changed
- **Safe Delete**: Delete button now only clears the UI display — generated image files are preserved on disk (previously permanently deleted via File System Access API with no recycle bin)
- **API key security**: Moved API key from URL query string to `x-goog-api-key` header in all Gemini API calls (prevents exposure in browser history and network logs)
- **Rate limit recovery**: Queue delay now resets to original value after a successful generation following rate-limit backoff (previously stayed doubled permanently)
- **AudioContext reuse**: Notification sound now reuses a single AudioContext instead of creating a new one per notification (prevents browser context limits)
- **Image compression**: Use `createImageBitmap()` for non-blocking image decode instead of synchronous `Image()` constructor (prevents UI freeze when adding multiple reference images)
- **Zoom element caching**: Cached fullscreen DOM elements to avoid repeated `getElementById` calls in wheel/touch/mouse event handlers
- **Queue ref efficiency**: Queue items now share reference image objects instead of shallow-cloning each one per variation (refs are read-only data URLs)
- **Persistence debounce**: Increased input persistence debounce from 300ms to 1000ms (reduces unnecessary localStorage writes during typing)
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
  - Format: `{batchName}_{name}_{timestamp}{variation}.png`
  - Supports batch JSON import/export (`"name": "elf-archer"`)
  - Duplicated boxes inherit the source name
  - Falls back to prompt snippet (first 40 chars) when no name is set

## [Unreleased] - 2026-03-12

### Added
- **PNG File Extension Standardization**: All generated images now save with `.png` extension
  - Gemini API already returns PNG format by default
  - Simplified file extension logic to always use `.png`
  - No conversion needed - preserves original API response
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
- `js/filesystem.js`: Updated `getExtension()` to always return `.png`
- `js/filesystem.js`: Updated `saveImageToFilesystem()` to use PNG mime type
- `js/generation.js`: Added variations support to main generate function
- `js/persistence.js`: Added variations input to persistence system
- `index.html`: Added variations input field to main UI
- `.gitignore`: Added `profiles/` and `*.profile.json` exclusions

### Technical Details

**PNG Standardization:**
- No image conversion needed - API already returns PNG
- Simply ensures consistent `.png` file extension
- Zero performance overhead
- Backward compatible with existing data URLs in IndexedDB

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
- `js/filesystem.js` - PNG extension standardization
- `js/profiles.js` - New profile management module
- `js/app.js` - Profile UI initialization and handlers
- `index.html` - Profile management UI section
- `css/components.css` - Profile section styling
- `.gitignore` - Profile exclusions

### Testing Recommendations
1. Generate images and verify all save as `.png` files
2. Create a profile with custom settings
3. Load profile and verify settings are restored
4. Export/import profile and verify data integrity
5. Delete profile and verify cleanup
6. Check git status to confirm profiles are ignored
