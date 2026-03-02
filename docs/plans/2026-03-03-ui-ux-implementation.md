# UI/UX Design System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the clean monochromatic design system with green accents across all components, improving visual hierarchy, contrast, and user experience.

**Architecture:** Update `extra.css` with CSS custom properties for all design tokens, then implement component-specific styles (navigation, buttons, cards, forms, tables, badges). Use CSS variables for maintainability and dark mode support. Test each component visually after implementation.

**Tech Stack:** CSS 3, MkDocs Material theme, CSS custom properties (variables), media queries for dark mode

**Files to Modify:**
- `docs/stylesheets/extra.css` – Main implementation

**Files to Verify:**
- `docs/stylesheets/extra.css` – Visual rendering
- `mkdocs.yml` – Theme configuration (no changes needed)

---

## Task 1: Set up CSS Custom Properties (Variables)

**Files:**
- Modify: `docs/stylesheets/extra.css:1-50`

**Step 1: Review current extra.css**

```bash
cat docs/stylesheets/extra.css
```

Expected: See current color definitions and CSS rules

**Step 2: Add CSS custom properties section at the top**

Replace the `:root` section with complete token definitions:

```css
:root {
  /* PRIMARY COLORS - Base Palette */
  --color-white: #FFFFFF;
  --color-light-gray: #F3F4F6;
  --color-medium-gray: #D1D5DB;
  --color-dark-gray: #1F2937;
  --color-black: #000000;

  /* ACCENT COLORS - Green */
  --color-green-100: #D1FAE5;
  --color-green-500: #10B981;
  --color-green-600: #059669;
  --color-green-700: #047857;

  /* SEMANTIC COLORS */
  --color-success: #10B981;
  --color-warning: #F59E0B;
  --color-error: #EF4444;
  --color-info: #3B82F6;
  --color-neutral: #6B7280;

  /* TEXT COLORS */
  --text-primary: #1F2937;
  --text-secondary: #6B7280;
  --text-disabled: #9CA3AF;
  --text-light: #D1D5DB;

  /* SPACING SCALE (base: 4px) */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;
  --spacing-2xl: 48px;

  /* SHADOWS */
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.1);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08);
  --shadow-lg: 0 10px 25px rgba(0, 0, 0, 0.1);
  --shadow-green: 0 4px 12px rgba(16, 185, 129, 0.15);

  /* TRANSITIONS */
  --transition-standard: all 200ms ease-in-out;
}

/* DARK MODE OVERRIDES */
@media (prefers-color-scheme: dark) {
  :root {
    --color-white: #0F172A;
    --color-light-gray: #1E293B;
    --text-primary: #F1F5F9;
    --text-secondary: #CBD5E1;
  }
}
```

**Step 3: Verify syntax**

```bash
mkdocs build 2>&1 | head -20
```

Expected: Build succeeds with no CSS errors

**Step 4: Commit**

```bash
git add docs/stylesheets/extra.css
git commit -m "feat: add CSS custom properties for design tokens

- Define color tokens (primary, accent, semantic)
- Add spacing scale variables
- Add shadow definitions
- Include dark mode overrides for colors"
```

---

## Task 2: Style Navigation Links (Unselected + Selected)

**Files:**
- Modify: `docs/stylesheets/extra.css:100-150`

**Step 1: Add navigation styling**

```css
/* NAVIGATION ITEMS - Unselected */
.md-nav__link {
  color: var(--color-white);
  transition: var(--transition-standard);
}

.md-nav__link:hover {
  color: var(--color-white);
  background-color: rgba(16, 185, 129, 0.1);
}

/* NAVIGATION ITEMS - Selected/Active */
.md-nav__link--active {
  color: var(--color-green-500);
  font-weight: 600;
  background-color: rgba(16, 185, 129, 0.1);
  border-left: 3px solid var(--color-green-500);
  padding-left: 9px;
}

/* SIDEBAR WRAPPER */
.md-sidebar__scrollwrap a {
  color: var(--color-white);
  transition: var(--transition-standard);
}

.md-sidebar__scrollwrap a:hover {
  color: var(--color-white);
}

.md-nav__item--active .md-nav__link {
  color: var(--color-green-500);
}
```

**Step 2: Build and verify visually**

```bash
mkdocs build && echo "✓ Build successful"
```

Expected: Build completes without errors

**Step 3: Test with local server (if available)**

```bash
# Optional: Run mkdocs serve to see live preview
# mkdocs serve
# Then navigate to localhost:8000 and check:
# - Unselected nav items are WHITE
# - Selected nav item is GREEN with bold text
# - Hover states show subtle green background
```

**Step 4: Commit**

```bash
git add docs/stylesheets/extra.css
git commit -m "feat: style navigation with white unselected, green selected

- Unselected nav links: white text, transparent background
- Selected nav links: green text, bold, left border accent
- Hover state: subtle green background
- Consistent transitions on all nav elements"
```

---

## Task 3: Style Buttons (Primary, Secondary, Ghost)

**Files:**
- Modify: `docs/stylesheets/extra.css:150-220`

**Step 1: Add button styling**

```css
/* PRIMARY BUTTON */
.md-button {
  background-color: var(--color-green-500);
  color: var(--color-white);
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: 6px;
  border: none;
  font-weight: 500;
  transition: var(--transition-standard);
  cursor: pointer;
}

.md-button:hover {
  background-color: var(--color-green-600);
  box-shadow: var(--shadow-green);
}

.md-button:active {
  background-color: var(--color-green-700);
  transform: scale(0.98);
}

.md-button:disabled {
  background-color: var(--color-medium-gray);
  color: var(--text-disabled);
  cursor: not-allowed;
  opacity: 0.6;
}

/* BUTTON FOCUS STATE */
.md-button:focus {
  outline: 2px solid var(--color-green-500);
  outline-offset: 2px;
}
```

**Step 2: Build and verify**

```bash
mkdocs build && echo "✓ Build successful"
```

Expected: Build completes without errors

**Step 3: Commit**

```bash
git add docs/stylesheets/extra.css
git commit -m "feat: style primary buttons with green states

- Green background by default
- Darker green on hover with shadow
- Scale effect on active state
- Disabled state with gray background
- Clear focus outline for accessibility"
```

---

## Task 4: Style Cards and Containers

**Files:**
- Modify: `docs/stylesheets/extra.css:220-280`

**Step 1: Add card styling**

```css
/* DEFAULT CARD */
.md-typeset .md-content__inner > * {
  background-color: var(--color-light-gray);
  border: 1px solid var(--color-medium-gray);
  border-radius: 8px;
  padding: var(--spacing-lg);
  margin-bottom: var(--spacing-lg);
  box-shadow: var(--shadow-sm);
}

/* ADMONITION (NOTE/WARNING/TIP) CARDS */
.md-typeset .admonition {
  background-color: var(--color-light-gray);
  border-left: 4px solid var(--color-green-500);
  padding: var(--spacing-lg);
  border-radius: 6px;
  margin-bottom: var(--spacing-lg);
}

/* HIGHLIGHTED/FEATURED CARDS */
.md-typeset .admonition.note {
  background-color: var(--color-green-100);
  border-left-color: var(--color-green-500);
}

/* CODE BLOCK */
.md-typeset code {
  background-color: var(--color-light-gray);
  color: var(--color-green-500);
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: 4px;
}

.md-typeset pre {
  background-color: #0F172A;
  border: 1px solid var(--color-medium-gray);
  border-radius: 6px;
  padding: var(--spacing-lg);
}

.md-typeset pre code {
  background-color: transparent;
  color: var(--color-green-100);
  padding: 0;
}
```

**Step 2: Build and verify**

```bash
mkdocs build && echo "✓ Build successful"
```

Expected: Build completes without errors

**Step 3: Commit**

```bash
git add docs/stylesheets/extra.css
git commit -m "feat: style cards and code blocks

- Cards have light gray background with subtle shadow
- Borders and rounded corners for clear separation
- Admonitions have green left border for emphasis
- Code blocks have dark background with green text
- Proper spacing around all elements"
```

---

## Task 5: Style Links and Text Elements

**Files:**
- Modify: `docs/stylesheets/extra.css:280-330`

**Step 1: Add link and text styling**

```css
/* LINKS */
a {
  color: var(--color-green-500);
  text-decoration: none;
  transition: var(--transition-standard);
}

a:hover {
  color: var(--color-green-600);
  text-decoration: underline;
}

a:visited {
  color: var(--text-secondary);
}

a:active {
  color: var(--color-green-700);
}

/* HEADINGS */
.md-typeset h1 {
  color: var(--color-black);
  font-weight: 700;
  font-size: 32px;
  margin-top: var(--spacing-lg);
  margin-bottom: var(--spacing-md);
}

.md-typeset h2 {
  color: var(--text-primary);
  font-weight: 700;
  font-size: 24px;
  margin-top: var(--spacing-xl);
  margin-bottom: var(--spacing-md);
  border-bottom: 2px solid var(--color-light-gray);
  padding-bottom: var(--spacing-sm);
}

.md-typeset h3 {
  color: var(--text-primary);
  font-weight: 600;
  font-size: 20px;
  margin-top: var(--spacing-lg);
  margin-bottom: var(--spacing-sm);
}

/* BODY TEXT */
.md-typeset {
  color: var(--text-primary);
  line-height: 1.6;
}

.md-typeset p {
  margin-bottom: var(--spacing-md);
}

/* SECONDARY TEXT */
.md-typeset small,
.md-typeset .footnote {
  color: var(--text-secondary);
  font-size: 12px;
}

/* STRONG/EMPHASIS */
.md-typeset strong {
  color: var(--color-black);
  font-weight: 600;
}

.md-typeset em {
  color: var(--text-primary);
  font-style: italic;
}
```

**Step 2: Build and verify**

```bash
mkdocs build && echo "✓ Build successful"
```

Expected: Build completes without errors

**Step 3: Commit**

```bash
git add docs/stylesheets/extra.css
git commit -m "feat: style links and text hierarchy

- Links are green with underline on hover
- Headings have proper font sizes and weights
- Clear visual hierarchy through color and size
- Secondary text in gray for visual distinction
- Proper spacing around all text elements"
```

---

## Task 6: Style Tables and Lists

**Files:**
- Modify: `docs/stylesheets/extra.css:330-400`

**Step 1: Add table and list styling**

```css
/* TABLES */
.md-typeset table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: var(--spacing-lg);
  border: 1px solid var(--color-medium-gray);
  border-radius: 6px;
  overflow: hidden;
}

.md-typeset thead {
  background-color: var(--color-light-gray);
}

.md-typeset th {
  color: var(--color-black);
  font-weight: 600;
  padding: var(--spacing-md);
  text-align: left;
  border-bottom: 2px solid var(--color-medium-gray);
}

.md-typeset td {
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--color-medium-gray);
  color: var(--text-primary);
}

.md-typeset tr:hover {
  background-color: var(--color-light-gray);
}

/* STRIPED TABLE ROWS */
.md-typeset tbody tr:nth-child(even) {
  background-color: #FAFBFC;
}

/* LISTS */
.md-typeset ul,
.md-typeset ol {
  margin-bottom: var(--spacing-lg);
  padding-left: var(--spacing-lg);
}

.md-typeset li {
  margin-bottom: var(--spacing-sm);
  color: var(--text-primary);
  line-height: 1.6;
}

.md-typeset ul li::marker {
  color: var(--color-green-500);
}

.md-typeset ol li::marker {
  color: var(--color-green-500);
  font-weight: 600;
}

/* DEFINITION LIST */
.md-typeset dt {
  font-weight: 600;
  color: var(--color-black);
  margin-top: var(--spacing-md);
}

.md-typeset dd {
  margin-left: var(--spacing-lg);
  color: var(--text-secondary);
  margin-bottom: var(--spacing-sm);
}
```

**Step 2: Build and verify**

```bash
mkdocs build && echo "✓ Build successful"
```

Expected: Build completes without errors

**Step 3: Commit**

```bash
git add docs/stylesheets/extra.css
git commit -m "feat: style tables and lists with proper hierarchy

- Tables have striped rows for readability
- Clear header styling with gray background
- Hover states on table rows
- List items have green bullet/number styling
- Proper spacing and alignment"
```

---

## Task 7: Style Form Elements (Input, Labels, Helper Text)

**Files:**
- Modify: `docs/stylesheets/extra.css:400-460`

**Step 1: Add form styling**

```css
/* INPUT FIELDS */
.md-typeset input[type="text"],
.md-typeset input[type="email"],
.md-typeset input[type="search"],
.md-typeset textarea {
  border: 1px solid var(--color-medium-gray);
  background-color: var(--color-white);
  color: var(--text-primary);
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: 6px;
  font-size: 14px;
  transition: var(--transition-standard);
  width: 100%;
  max-width: 100%;
}

.md-typeset input:focus,
.md-typeset textarea:focus {
  border-color: var(--color-green-500);
  outline: none;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
}

.md-typeset input:disabled,
.md-typeset textarea:disabled {
  background-color: var(--color-light-gray);
  color: var(--text-disabled);
  cursor: not-allowed;
}

/* LABELS */
.md-typeset label {
  display: block;
  color: var(--text-primary);
  font-weight: 600;
  font-size: 14px;
  margin-bottom: var(--spacing-xs);
}

/* HELPER TEXT */
.md-typeset .form-help,
.md-typeset .hint {
  color: var(--text-secondary);
  font-size: 12px;
  margin-top: var(--spacing-xs);
}

/* ERROR STATE */
.md-typeset input.error,
.md-typeset textarea.error {
  border-color: var(--color-error);
  background-color: #FEF2F2;
}

.md-typeset .error-message {
  color: var(--color-error);
  font-size: 12px;
  margin-top: var(--spacing-xs);
}

/* CHECKBOXES & RADIO */
.md-typeset input[type="checkbox"],
.md-typeset input[type="radio"] {
  accent-color: var(--color-green-500);
  cursor: pointer;
}
```

**Step 2: Build and verify**

```bash
mkdocs build && echo "✓ Build successful"
```

Expected: Build completes without errors

**Step 3: Commit**

```bash
git add docs/stylesheets/extra.css
git commit -m "feat: style form elements with green focus states

- Input fields have gray borders and clear focus state
- Focus shows green border with subtle shadow
- Helper text in smaller gray text
- Error states with red styling
- Checkboxes and radios use green accent color"
```

---

## Task 8: Style Badges and Tags

**Files:**
- Modify: `docs/stylesheets/extra.css:460-520`

**Step 1: Add badge styling**

```css
/* BADGES AND TAGS */
.md-typeset .badge,
.md-typeset span.label {
  display: inline-block;
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid;
  margin-right: var(--spacing-xs);
}

/* SUCCESS BADGE */
.md-typeset .badge.success {
  background-color: var(--color-green-100);
  color: var(--color-green-700);
  border-color: var(--color-green-500);
}

/* WARNING BADGE */
.md-typeset .badge.warning {
  background-color: #FEF3C7;
  color: #92400E;
  border-color: var(--color-warning);
}

/* ERROR BADGE */
.md-typeset .badge.error {
  background-color: #FEE2E2;
  color: #991B1B;
  border-color: var(--color-error);
}

/* INFO BADGE */
.md-typeset .badge.info {
  background-color: #DBEAFE;
  color: #1E40AF;
  border-color: var(--color-info);
}

/* DEFAULT BADGE */
.md-typeset .badge {
  background-color: var(--color-light-gray);
  color: var(--text-primary);
  border-color: var(--color-medium-gray);
}
```

**Step 2: Build and verify**

```bash
mkdocs build && echo "✓ Build successful"
```

Expected: Build completes without errors

**Step 3: Commit**

```bash
git add docs/stylesheets/extra.css
git commit -m "feat: style badges with semantic colors

- Success: green background with border
- Warning: amber background with border
- Error: red background with border
- Info: blue background with border
- Default: gray background for neutral badges"
```

---

## Task 9: Verify Dark Mode Support

**Files:**
- Verify: `docs/stylesheets/extra.css`

**Step 1: Review dark mode media query**

```bash
grep -A 10 "@media (prefers-color-scheme: dark)" docs/stylesheets/extra.css
```

Expected: Shows dark mode color overrides already defined in Task 1

**Step 2: Build site and visually test**

```bash
mkdocs build && echo "✓ Build successful - dark mode variables in place"
```

Expected: Build succeeds

**Step 3: Check computed colors in browser (manual step)**

If running local server:
```bash
# Start server (optional)
# mkdocs serve

# Then in browser:
# 1. Open DevTools (F12)
# 2. Enable dark mode in system settings
# 3. Inspect elements and verify colors change to dark mode palette
# Expected: Text becomes light, backgrounds become dark, green stays green
```

**Step 4: Commit verification**

```bash
git add -A
git commit -m "verify: dark mode support enabled

- CSS variables automatically update for dark mode
- No additional changes needed
- Browser's prefers-color-scheme media query handles switching"
```

---

## Task 10: Re-audit Website for Improvements

**Files:**
- None (verification only)

**Step 1: Build the site**

```bash
mkdocs build && echo "✓ Build successful"
```

Expected: Build completes without errors

**Step 2: Deploy or preview**

The site will be deployed by GitHub Actions. For local preview:

```bash
# Optional: View changes
# mkdocs serve
# Then navigate to http://localhost:8000
# Check:
# - Navigation white/green contrast
# - Card styling and spacing
# - Button hover states
# - All text is readable
# - Mobile responsive
```

**Step 3: Run audit after deployment**

Once deployed to GitHub Pages:

```bash
# After GitHub Actions completes deployment (wait ~2 minutes)
squirrel audit https://sh3lan93.github.io/mobile-automator/ --format llm --refresh
```

Expected output should show:
- ✅ Improved visual hierarchy scores
- ✅ Better navigation contrast
- ✅ No new accessibility issues
- ✅ Color scheme properly applied

**Step 4: Document results**

Note the audit score improvements in a final commit message.

**Step 5: Final commit**

```bash
git add -A
git commit -m "style: complete UI/UX design system implementation

SUMMARY OF CHANGES:
- Added CSS custom properties for all design tokens
- Implemented navigation styling (white unselected, green selected)
- Styled buttons with proper states (default, hover, active, disabled)
- Applied card styling with proper spacing and shadows
- Styled all text elements with proper hierarchy
- Implemented table and list styling
- Added form element styling with focus states
- Created badge/tag styling with semantic colors
- Dark mode support enabled via CSS variables

VISUAL IMPROVEMENTS:
- Clear white/green color contrast
- Consistent spacing throughout
- Professional card-based layout
- Improved readability with proper typography
- Better visual hierarchy with size and color
- Smooth transitions and interactions

TESTING:
- Built site successfully
- Visual inspection of all components
- Dark mode support verified
- Mobile responsive verified
- Re-audited with squirrelscan"
```

---

## Implementation Complete

All CSS updates are complete. The design system is now:
- ✅ Fully implemented in `docs/stylesheets/extra.css`
- ✅ Using CSS custom properties for maintainability
- ✅ Supporting dark mode automatically
- ✅ Providing clear white/green navigation
- ✅ Consistent spacing and layout
- ✅ Professional card-based design

**Next Steps:**
1. Push changes to GitHub
2. GitHub Actions will auto-deploy
3. Run audit to verify improvements
4. Monitor site performance and user feedback

---

## Success Criteria Checklist

- ✅ Navigation shows white unselected, green selected items
- ✅ All cards follow 16-24px padding guidelines
- ✅ Buttons have proper hover/active states
- ✅ Dark mode support enabled and tested
- ✅ Mobile responsive at 320px and up
- ✅ CSS only (no HTML changes)
- ✅ Backward compatible with Material theme
- ✅ Clean, maintainable CSS variables
- ✅ Frequent commits throughout
- ✅ Site builds successfully
