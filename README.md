# NBPI

A powerful, feature-rich Gemini image generation client that runs entirely in your browser. No server, no build tools, no dependencies — just open and generate.

<p align="center">
  <img src="assets/banner.jpg" alt="NBPI" width="1200">
</p>

## Features

### Authentication

- **API Key** — Use your Gemini API key directly
- **Vertex AI** — Enterprise auth with Service Account JSON (JWT signing handled in-browser via jsrsasign)
- Auto-refresh tokens with 60-second buffer before expiry
- Auto-retry on 401/403 auth errors
- Drag & drop service account JSON file upload

### Image Generation

- All Gemini image models (gemini-2.0-flash, gemini-3-pro, imagen-3, etc.)
- **1K / 2K / 4K** resolution options
- 10 aspect ratios including ultrawide 21:9
- Configurable thinking mode with budget slider (128–24,576 tokens)
- Google Search grounding for real-world accuracy
- Auto-retry with exponential backoff (3 retries: 2s → 4s → 8s)
- Generation time estimation based on model/resolution history
- Token usage estimation per generation

### Reference Images

- Up to **14 reference images** per generation
- Auto-compression to 2560px max, JPEG at 0.85 quality (saves bandwidth)
- Drag & drop, paste from clipboard, or click to upload
- **Drag-to-reorder** — Grab and drop thumbnails to change image order (order maps to "first image", "second image" in prompts)
- **Iterate** button adds output to references for style refinement
- Fullscreen preview modal with arrow navigation and swipe gestures
- Numbered order badges on thumbnails
- Undo clear with 5-second restore window

### Batch Generation (Queue System)

- **Prompt Boxes** — Individual cards for each prompt with:
  - Large, resizable textarea for long/detailed prompts
  - Per-prompt variation count (1–10 per prompt)
  - Per-prompt reference images (override global refs or use global as fallback)
- Fullscreen batch setup modal for maximum editing space
- **Global settings**: default reference images toggle, inter-generation delay (2s–10s), output directory
- Queue panel with live progress tracking (pending / generating / completed / failed)
- Pause, resume, and cancel controls
- Automatic rate-limit handling with exponential backoff (increases delay on 429 errors)
- Queue persistence — resume interrupted batches across sessions
- **Import** — Load prompts from a folder containing `batch.json` + `refs/` subfolder
- **Export** — Save current prompt boxes as `batch.json` for reuse

#### Batch Import Format

Organize a folder like this:

```
my_batch/
├── batch.json
└── refs/
    ├── character_face.png
    ├── style_guide.png
    └── background.png
```

`batch.json` schema:

```json
{
  "delay": 3000,
  "prompts": [
    {
      "prompt": "A detailed scene description...",
      "variations": 2,
      "refs": ["refs/character_face.png", "refs/style_guide.png"]
    },
    {
      "prompt": "Another prompt without custom refs...",
      "variations": 1
    }
  ]
}
```

| Field | Required | Default | Description |
| ----- | -------- | ------- | ----------- |
| `delay` | No | 3000 | Delay between generations (ms) |
| `prompts[].prompt` | Yes | — | The prompt text |
| `prompts[].variations` | No | 1 | Number of variations to generate |
| `prompts[].refs` | No | — | Relative paths to reference images in the folder |

### Filesystem Output

- **Direct file saving** to a user-selected output folder via the File System Access API
- Auto-generated filenames: `YYYYMMDD_HHMMSS_prompt-snippet.<ext>`
- Persistent directory handle — remembers your output folder across sessions
- Fallback to browser download when filesystem access is unavailable
- Works for both single generations and batch queue
- Delete files directly from history

### Generation History

- **Persistent history panel** — Always accessible via the clock FAB (bottom-left), independent of queue state
- Every generation saves its **full prompt, config, and reference images** to IndexedDB
- History panel lists recent generations with prompt snippets, model, ratio, ref count, generation time, and relative timestamps
- **Info button** on the image panel (between Iterate and Delete) opens the details overlay for the currently displayed image
- **Info button** on completed queue items opens the same overlay
- **Details overlay** shows:
  - Full prompt (scrollable, monospace) with **Copy** button
  - Config badges (model, ratio, resolution, thinking budget, search, generation time, filename)
  - Reference image thumbnail grid with individual **Save** and **Save All** buttons
  - **Redo** button — loads the prompt + references + config back into the main UI
- Delete individual entries or **Clear All** with confirmation
- Auto-prunes to 500 entries (oldest removed first)
- Persists across sessions and browser restarts

### Image History & Favorites

- Persistent storage via IndexedDB (database v5 with migration support)
- **Two storage modes**:
  - Full image storage (when no output folder is set)
  - Thumbnail-only storage (when output folder is set — full image loaded on demand)
- Favorites system with star toggle and filtering (all / favorites)
- Load prompts and images from history into the current session
- **Adjustable thumbnail size** — slider control (1–5 columns) with persistent preference
- Infinite scroll pagination with auto-fill (loads pages until the panel overflows)
- "Load More" fallback button when scroll detection doesn't trigger
- Clear all (preserves favorites)
- Delete individual items (also removes from filesystem if applicable)
- Sync button to clean up entries for deleted files

### Image Viewing

- **Fullscreen modal** with dedicated zoom controls
- Pinch-to-zoom (mobile) / Mouse wheel zoom (desktop)
- Pan when zoomed in (touch drag or mouse drag)
- Double-tap / double-click to toggle zoom
- Zoom level indicator (auto-hides)
- Zoom range: 1x–10x (fullscreen)
- Download and copy to clipboard

### Saved Prompts

- Save frequently-used prompts to IndexedDB
- Quick-access dropdown from the prompt toolbar
- Duplicate detection prevents saving the same prompt twice
- Load saved prompts into the textarea with one click
- Delete individual saved prompts

### Prompt Editor

- **Fullscreen mode** — Click the expand button or press `Ctrl+Shift+F`
- Character counter with live updates
- Works on all platforms (desktop & mobile)
- Content syncs back to the main textarea on close

### Mobile Optimized

- Pinch-to-zoom on images with smooth interpolation
- Double-tap to zoom/reset
- Swipe navigation for reference image preview
- Haptic feedback (respects user toggle)
- Touch-friendly UI with appropriate hit targets
- Fullscreen prompt editor for comfortable typing on small screens

## Quick Start

### Option 1: One-Click Launchers

**Windows** — Double-click `start-hidden.vbs` to run the server in the background (no terminal window)

**Termux/Android** — Run `bash start-termux.sh` to start the server in the background

**Standard** — Double-click `start.bat` (Windows) or run `./start.sh` (Linux/Mac)

### Option 2: Manual Start

```bash
# Clone the repo
git clone https://github.com/yourusername/nbpi.git
cd nbpi

# Start local server
npx serve -l 4648
# or
python -m http.server 4648
```

Then open <http://localhost:4648>

### Option 3: GitHub Pages

Fork this repo and enable GitHub Pages in Settings → Pages → Deploy from `main` branch.

> **Note**: ES modules require a local server. Opening `index.html` directly via `file://` won't work.

## Getting Your API Key

### Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Create or select a project
3. Generate an API key
4. Paste it in the app

### Vertex AI (Enterprise)

1. Create a Service Account in Google Cloud Console
2. Grant it the `Vertex AI User` role
3. Download the JSON key file
4. Drop the file onto the Vertex AI auth section in the app

## Project Structure

```
nbpi/
├── index.html            # Single-page application entry point
├── package.json          # Project metadata
├── start.bat             # Windows launcher (with terminal)
├── start.sh              # Linux/Mac launcher
├── start-hidden.vbs      # Windows launcher (no terminal)
├── start-termux.sh       # Termux/Android launcher
├── assets/
│   └── banner.jpg        # Promotional banner
├── css/
│   ├── main.css          # CSS entry point (imports all modules)
│   ├── variables.css     # Design tokens (colors, spacing, z-index)
│   ├── base.css          # CSS reset, typography, dark theme
│   ├── components.css    # Buttons, inputs, toggles, prompt boxes, queue
│   ├── layout.css        # Container, responsive grid, desktop panels
│   ├── modals.css        # Fullscreen, history, preview, prompt editor, queue
│   └── utilities.css     # Animations, helpers, visibility classes
└── js/
    ├── app.js            # Entry point & initialization
    ├── config.js         # Constants & configuration
    ├── auth.js           # API key & Vertex AI authentication
    ├── api.js            # API calls with retry logic
    ├── models.js         # Model loading & caching
    ├── generation.js     # Image generation orchestration & stats
    ├── references.js     # Reference image handling & compression
    ├── history.js        # IndexedDB operations, image history UI, generation history CRUD
    ├── zoom.js           # Pinch-to-zoom, mouse wheel, pan controls
    ├── ui.js             # Toast, haptics, DOM helpers, prompt editor
    ├── persistence.js    # localStorage management for inputs
    ├── prompts.js        # Saved prompts management
    ├── filesystem.js     # File System Access API operations
    ├── queue.js          # Batch generation queue engine
    └── queueUI.js        # Batch setup UI, prompt boxes, import/export, generation details overlay, history panel
```

## Module Architecture

The application is organized as ES modules with clear separation of concerns:

```
app.js (entry point)
├── ui.js ─────────────── DOM helpers, toast, haptics, prompt editor
├── persistence.js ────── localStorage save/restore for all inputs
├── auth.js ───────────── Authentication (API key + Vertex AI JWT)
│   └── config.js
├── models.js ─────────── Model list fetching with 5-min cache
│   └── auth.js
├── generation.js ─────── Core generation, stats, download, copy
│   ├── api.js ────────── API calls with retry + error parsing
│   ├── references.js ─── Reference image state + compression + reorder
│   ├── history.js ────── IndexedDB CRUD + image history + generation history
│   └── filesystem.js ─── File System Access API operations
├── zoom.js ───────────── Fullscreen zoom (pinch, wheel, pan)
├── prompts.js ────────── Saved prompts CRUD + dropdown UI
├── queue.js ──────────── Queue engine (add, process, pause, resume)
│   └── generation.js
└── queueUI.js ────────── Prompt boxes, batch setup, import/export, generation details, history panel
    ├── queue.js
    ├── history.js
    ├── references.js
    └── filesystem.js
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Enter` | Generate image |
| `Ctrl+Shift+F` | Open fullscreen prompt editor |
| `Escape` | Close fullscreen / modals |
| `+` / `-` / `0` | Zoom in / out / reset (in fullscreen) |
| `←` / `→` | Navigate reference images (in preview) |

## Data Storage

All data stays in your browser — nothing is sent to any server except the Gemini/Vertex API for generation.

| Type | Storage | Contents |
|------|---------|----------|
| Credentials | localStorage | API key, project ID, vertex location, service account JSON |
| UI Settings | localStorage | Auth mode, last model, collapsible states, toggles |
| Input State | localStorage | Prompt text, aspect ratio, resolution, thinking budget |
| Reference Images | IndexedDB | Compressed base64 images (migrated from localStorage) |
| Generated Images | IndexedDB | Full images or thumbnails (depends on filesystem mode) |
| Generation History | IndexedDB | Prompt, config, ref images, filename per generation (up to 500) |
| Saved Prompts | IndexedDB | User-saved prompt library |
| Directory Handle | IndexedDB | Output folder handle for filesystem access |
| Queue State | localStorage | Pending/completed queue items for session recovery |
| Session Stats | sessionStorage | Generation count, token estimates (cleared on tab close) |
| Generation Stats | localStorage | Average generation times per model/resolution |

## Configuration Constants

| Constant | Value | Description |
| -------- | ----- | ----------- |
| `MAX_REFS` | 14 | Maximum reference images per generation |
| `MAX_REF_IMAGE_SIZE` | 2560px | Compression target (longest edge) |
| `MAX_RETRIES` | 3 | API retry attempts before failing |
| `RETRY_DELAYS` | 2s, 4s, 8s | Exponential backoff delays |
| `MAX_QUEUE_ITEMS` | 100 | Maximum items in batch queue |
| `MAX_VARIATIONS_PER_PROMPT` | 10 | Maximum variations per prompt box |
| `DEFAULT_QUEUE_DELAY_MS` | 3000 | Default delay between batch generations |
| `MAX_HISTORY_ITEMS` | 500 | Maximum generation history entries before auto-prune |
| `HISTORY_PAGE_SIZE` | 20 | Items per infinite scroll page |
| `MAX_CONVERSATION_TURNS` | 10 | Max conversation turns for generation |
| `FS_MAX_ZOOM` | 10x | Maximum zoom level in fullscreen |

## File Formats & Sizes

| Stage | Format | Size / Constraints |
| ------- | -------- | -------------------- |
| **Input (reference images)** | Any browser-readable (PNG, JPEG, WebP, GIF, BMP) | Compressed to max 2560px longest side, JPEG 0.85 quality |
| **Sent to Gemini API** | base64 `inlineData` with original mimeType | Up to 14 images per request |
| **API response** | Provider-dependent | Gemini usually returns `image/png`; LinkAPI responses are validated at runtime |
| **Filesystem output** | Preserves provider MIME | Named `YYYYMMDD_HHMMSS_prompt-snippet.<ext>` |
| **History thumbnails** | JPEG data URL in IndexedDB | Max 400px longest dimension, 0.85 quality |
| **History full images** | On disk (filesystem mode) or data URL in IndexedDB (legacy) | Full resolution |

When using LinkAPI, NBPI now fails the generation if the selected output is not `image/png`. This prevents JPEG responses from being silently saved as if they were full-quality PNGs.

## Browser Support

| Browser | Minimum Version | File System Access |
| ------- | --------------- | ----------------- |
| Chrome | 90+ | Full support |
| Edge | 90+ | Full support |
| Firefox | 90+ | Download fallback only |
| Safari | 15+ | Download fallback only |

> **Note**: The File System Access API (direct folder output) is only available in Chromium-based browsers. Other browsers fall back to standard browser downloads.

## Development

No build tools required. Edit files directly and refresh.

```bash
# Start with auto-reload (optional)
npx serve --reload

# Or use any static file server
python -m http.server 4648
```

### Adding a New Module

1. Create the file in `js/`
2. Export functions and import dependencies
3. Import and initialize in `app.js`
4. Expose any onclick-handler functions via `window.*`

### CSS Architecture

CSS uses custom properties (design tokens) defined in `variables.css`. All colors, spacing, font sizes, border radii, and z-index values are tokenized for consistency.

## License

MIT License — do whatever you want with it.
