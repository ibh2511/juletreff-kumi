# Copilot Instructions for Juletreff KUMI

## Project Overview

This is a **Norwegian event registration React SPA** for Oslo Vegansamfunn's Christmas party at KUMI restaurant. The app uses a **Google Apps Script backend** for form submissions and integrates with Google Sheets for registration tracking.

## Architecture & Key Components

### Form Submission Pattern

- Uses **hidden iframe technique** with Google Apps Script (`src/App.jsx:12` GAS_URL)
- Form posts to GAS endpoint, response handled via `window.postMessage` from iframe
- Status states: `null` | `"ok"` | `"waitlist"` | `"duplicate"` | `"error"`
- Form hides completely when any status is set (not just success)

### Interactive Components

- **Image Carousel**: Auto-rotating images every 4.5s with CSS fade transitions (`IMAGES` array)
- **Floating Labels**: Custom implementation in `labelFloat.js` using `.has-content` class
- **FAQ Accordion**: Single-open accordion in `faqAccordion.js` (closes others when opening)
- **Google Maps Embed**: Static iframe embed for venue location

### State Management

- Single-component app with React useState hooks
- No external state management (Redux, Zustand, etc.)
- Cleanup functions returned from utility modules for proper teardown

## Development Workflow

### Commands

```bash
npm run dev          # Vite dev server
npm run build        # Production build
npm run preview      # Preview built app
npm run deploy       # Build + deploy to gh-pages branch
npm run lint         # ESLint check
```

### Deployment

- **GitHub Pages deployment** configured via `gh-pages` package
- Base path: `/juletreff-kumi/` (set in `vite.config.js`)
- Post-build copies `index.html` to `404.html` for SPA routing
- Creates `.nojekyll` file to prevent Jekyll processing

## Code Conventions

### File Organization

- **Utilities as ES modules**: `labelFloat.js`, `faqAccordion.js` export setup functions
- **CSS custom properties**: Consistent theme variables in `:root` (--bg, --ink, --panel, --accent)
- **Public assets**: Images in `/public/images/`, referenced without `/public` prefix

### React Patterns

- **useEffect cleanup**: Utility functions return cleanup functions, properly called in useEffect
- **Norwegian language**: All UI text, comments, and variable names in Norwegian
- **Form field names**: Match Google Sheets columns exactly (`Fornavn`, `Etternavn`, `Email`, `Message`)

### Styling Approach

- **CSS Grid layout**: Desktop 2-column grid, mobile stacking
- **CSS custom properties**: Centralized theming system
- **Responsive**: Mobile-first with desktop padding applied via media queries
- **Animations**: CSS transitions for image fades, form interactions

### ESLint Configuration

- React Hooks + React Refresh plugins for Vite
- Allows unused vars with uppercase/underscore pattern (`varsIgnorePattern: '^[A-Z_]'`)
- ES2020+ features enabled

## Key Integration Points

### Google Apps Script

- Form submission endpoint handles registration logic and email notifications
- Responds with `{ ok, waitlist, duplicate }` object via postMessage
- Must validate origin: `/script\.google\.com|googleusercontent\.com/`

### External Services

- **Google Maps**: Embedded iframe for KUMI location (Operagata 71B, Oslo)
- **Google Fonts**: Poppins font family from Google Fonts CDN
- **GitHub Pages**: Static hosting with custom 404 handling for SPA

## Common Tasks

### Adding Form Fields

1. Add input to form JSX with Norwegian `name` attribute
2. Update Google Apps Script to handle new field
3. Add floating label styles if needed

### Updating Event Details

- Modify content in `src/App.jsx` FAQ section and form header
- Update meta tags in `index.html` for social sharing
- Replace images in `/public/images/` if needed

### Styling Changes

- Theme colors: Update CSS custom properties in `src/App.css:4-10`
- Layout: Modify grid in `.container` class for different arrangements
- Typography: Poppins font imported, use font-weight variations as needed
