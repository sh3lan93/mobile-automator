# UI/UX Design System: Clean Monochromatic + Green Accent

**Date:** March 3, 2026
**Project:** mobile-automator Documentation
**Status:** Approved
**Design Philosophy:** Modern, minimalist, developer-friendly

---

## Overview

This design system establishes a complete visual language for the mobile-automator documentation site. It prioritizes **readability, clarity, and professional presentation** through a clean monochromatic palette with strategic green accents.

**Target Users:** Mixed audience (beginner onboarding + experienced reference lookups)
**Design Approach:** Clean Monochromatic (white backgrounds, minimal decoration, typography-driven hierarchy)

---

## 1. Color Tokens & Palette

### Primary Colors (Base)
- **White:** `#FFFFFF` – Backgrounds, highest contrast
- **Light Gray:** `#F3F4F6` – Subtle backgrounds, cards
- **Medium Gray:** `#D1D5DB` – Borders, dividers
- **Dark Gray:** `#1F2937` – Body text, primary contrast
- **Black:** `#000000` – Headings, maximum emphasis

### Accent Colors (Green)
- **Green 500:** `#10B981` – Primary action, selected state, links
- **Green 600:** `#059669` – Hover state, darker emphasis
- **Green 700:** `#047857` – Active state, deepest green
- **Green 100:** `#D1FAE5` – Light backgrounds, badges

### Semantic Colors
- **Success:** `#10B981` (green, same as primary)
- **Warning:** `#F59E0B` (amber)
- **Error:** `#EF4444` (red)
- **Info:** `#3B82F6` (blue)
- **Neutral/Secondary:** `#6B7280` (medium gray)

### Dark Mode Palette
- **Dark Background:** `#0F172A` (near black)
- **Dark Surface:** `#1E293B` (cards on dark)
- **Dark Text:** `#F1F5F9` (light, readable)
- **Green (unchanged):** `#10B981` (consistent across themes)

---

## 2. Typography & Visual Hierarchy

### Typeface Stack
- **Headings & Body:** System fonts (Roboto, -apple-system, BlinkMacSystemFont, sans-serif)
- **Code/Monospace:** Roboto Mono, monospace

### Type Scale

| Element | Size | Weight | Color | Line Height | Usage |
|---------|------|--------|-------|-------------|-------|
| H1 (Page Title) | 32px | 700 bold | `#000000` | 1.2 | Top-level headings |
| H2 (Section) | 24px | 700 bold | `#1F2937` | 1.2 | Major sections |
| H3 (Subsection) | 20px | 600 semi-bold | `#1F2937` | 1.3 | Subsections |
| H4 (Small Heading) | 16px | 600 semi-bold | `#374151` | 1.4 | Small headings |
| Body Text | 16px | 400 regular | `#1F2937` | 1.6 | Main content |
| Body Small | 14px | 400 regular | `#6B7280` | 1.6 | Secondary text |
| Code Block | 14px | 400 regular | `#10B981` | 1.5 | Code syntax |
| Caption | 12px | 400 regular | `#9CA3AF` | 1.5 | Small labels |

### Link Colors
- **Unvisited:** `#10B981` (green)
- **Visited:** `#6B7280` (gray)
- **Hover:** `#059669` (darker green)
- **Active/Selected:** `#10B981` (bold green)

---

## 3. Component Styles

### Buttons

**Primary Button**
```
Default:   BG: #10B981, Text: white, Padding: 12px 24px, Border-radius: 6px
Hover:     BG: #059669, Shadow: 0 4px 12px rgba(16,185,129,0.2)
Active:    BG: #047857, Transform: scale(0.98)
Disabled:  BG: #D1D5DB, Text: #9CA3AF, Cursor: not-allowed, Opacity: 0.6
```

**Secondary Button (Outline)**
```
Default:   Border: 2px #10B981, Text: #10B981, BG: transparent
Hover:     BG: #D1FAE5 (light green)
Active:    BG: #A7F3D0, Text: #047857
Disabled:  Border: 2px #D1D5DB, Text: #9CA3AF
```

**Ghost Button (Text Only)**
```
Default:   Text: #10B981, BG: transparent, Padding: 8px 12px
Hover:     Text: #059669, Underline: true
Active:    Text: #047857, Underline: true
Disabled:  Text: #D1D5DB, Cursor: not-allowed
```

### Cards & Containers

**Default Card**
```
Background:    #F3F4F6
Padding:       20px
Border:        1px solid #E5E7EB
Border-radius: 8px
Shadow:        0 1px 3px rgba(0,0,0,0.1)
```

**Highlighted/Selected Card**
```
Background:    #D1FAE5 (light green)
Border:        2px solid #10B981
Shadow:        0 4px 12px rgba(16,185,129,0.15)
```

**Code Block**
```
Background:    #0F172A (dark)
Text:          #D1FAE5 (light green for syntax)
Padding:       16px
Border:        1px solid #1E293B
Border-radius: 6px
Font-family:   Roboto Mono
```

### Navigation & Links

**Unselected Nav Link**
```
Text Color:    #FFFFFF (white)
Background:    transparent
Padding:       8px 12px
Border-radius: 4px
Hover:         BG: rgba(16,185,129,0.1)
Transition:    200ms ease-in-out
```

**Selected/Active Nav Link**
```
Text Color:    #10B981 (green)
Font-weight:   600 (bold)
Background:    rgba(16,185,129,0.1)
Border-left:   3px solid #10B981
Padding-left:  9px
```

**Breadcrumb**
```
Separator:     Text: #D1D5DB
Active Link:   Text: #10B981, Font-weight: 600
Inactive Link: Text: #6B7280
```

### Tables

```
Header Row:      BG: #F3F4F6, Text: #000000 bold, Padding: 12px
Striped Rows:    Alt rows: #FFFFFF and #F9FAFB
Cell Borders:    1px solid #E5E7EB
Row Hover:       BG: #F3F4F6
Active/Link:     Text: #10B981 (green)
```

### Form Elements

**Input Fields**
```
Default:       Border: 1px #D1D5DB, BG: #FFFFFF, Padding: 10px 12px
Focus:         Border: 2px #10B981, Shadow: 0 0 0 3px rgba(16,185,129,0.1)
Error:         Border: 2px #EF4444, BG: #FEF2F2
Disabled:      BG: #F3F4F6, Text: #9CA3AF, Cursor: not-allowed
```

**Labels**
```
Text Color:    #1F2937
Font-weight:   600
Font-size:     14px
Margin-bottom: 4px
```

**Helper Text**
```
Text Color:    #6B7280
Font-size:     12px
Margin-top:    4px
```

### Badges & Labels

| Type | Background | Text | Border |
|------|-----------|------|--------|
| Success | `#D1FAE5` | `#047857` | 1px `#10B981` |
| Warning | `#FEF3C7` | `#92400E` | 1px `#F59E0B` |
| Error | `#FEE2E2` | `#991B1B` | 1px `#EF4444` |
| Info | `#DBEAFE` | `#1E40AF` | 1px `#3B82F6` |

---

## 4. Spacing & Layout System

### Spacing Scale (Base: 4px)
- **xs:** 4px (tight spacing)
- **sm:** 8px (small gaps)
- **md:** 16px (standard padding/margin)
- **lg:** 24px (section spacing)
- **xl:** 32px (large sections)
- **2xl:** 48px (page sections)

### Padding Usage
- Small components (buttons, inputs): `8px 16px`
- Cards & containers: `16px - 24px`
- Page sections: `32px - 48px`
- Code blocks: `16px`

### Margin Usage
- Between paragraphs: `16px`
- Between H2 sections: `32px top, 16px bottom`
- Between H3 subsections: `24px top, 12px bottom`
- Page side margins: `16px` (mobile), `32px` (desktop)

### Container Widths
- **Mobile:** 100% (no max)
- **Tablet:** 720px
- **Desktop:** 960px
- **Wide Desktop:** 1200px max

### Whitespace Philosophy
- Use generous whitespace around major sections
- Add breathing room around headings
- Remove decorative borders where possible
- Let typography and content shine

---

## 5. Shadows & Depth

### Shadow Scale (Subtle)

**Elevation 1 (Subtle)**
```
shadow: 0 1px 3px rgba(0, 0, 0, 0.1)
Used for: Cards, inputs, slight depth
```

**Elevation 2 (Moderate)**
```
shadow: 0 4px 12px rgba(0, 0, 0, 0.08)
Used for: Hovered cards, modals, active buttons
```

**Elevation 3 (Prominent)**
```
shadow: 0 10px 25px rgba(0, 0, 0, 0.1)
Used for: Dropdowns, popovers, floating elements
```

### Colored Shadows (Green Accents)
```
Hover:  0 4px 12px rgba(16, 185, 129, 0.15)
Card:   0 4px 12px rgba(16, 185, 129, 0.1)
```

### Borders (Alternative to Shadows)
- Card borders: `1px solid #E5E7EB`
- Active/focused: `2px solid #10B981`
- Input focus: `2px solid #10B981` + inner shadow
- Dividers: `1px solid #E5E7EB`

### Transparency & Overlays
- Hover overlay: `rgba(16, 185, 129, 0.05)`
- Active overlay: `rgba(16, 185, 129, 0.1)`
- Modal backdrop: `rgba(0, 0, 0, 0.5)`
- Disabled overlay: `rgba(0, 0, 0, 0.04)`

### Transitions
- Duration: `200ms`
- Easing: `ease-in-out`
- Animate: `color, background-color, border-color, box-shadow`

---

## 6. Dark Mode Support

The design system automatically adapts to dark mode:

```
Light Mode          Dark Mode
──────────────────────────────
#FFFFFF      →      #0F172A (background)
#F3F4F6      →      #1E293B (cards)
#1F2937      →      #F1F5F9 (text)
#10B981      →      #10B981 (accent - unchanged)
```

All component styles remain consistent; only the base colors shift.

---

## 7. Implementation Approach

### CSS Strategy
1. Define CSS custom properties (variables) for all tokens
2. Update `extra.css` with component styles
3. Apply to navigation, cards, buttons, forms, tables
4. Test in both light and dark modes
5. Deploy and monitor

### Files to Update
- `docs/stylesheets/extra.css` – Main component styles
- `mkdocs.yml` – Color theme configuration

### Success Criteria
- ✅ All navigation items white (unselected), green (selected)
- ✅ All cards and containers follow spacing rules
- ✅ Buttons have consistent 3-state styling
- ✅ Dark mode support enabled
- ✅ No visual regressions on mobile
- ✅ Audit shows improved visual hierarchy

---

## 8. Design Principles Summary

1. **Minimalist:** Remove unnecessary decoration, let content shine
2. **Hierarchy:** Clear visual levels through size, weight, color
3. **Consistency:** Same components look and behave the same everywhere
4. **Accessibility:** Strong contrast ratios, clear interactive states
5. **Developer-Friendly:** Code blocks and syntax highlighting prioritized
6. **Responsive:** Works seamlessly on mobile to desktop
7. **Delightful:** Smooth transitions, thoughtful interactions

---

## Sign-Off

**Design Status:** ✅ APPROVED
**Ready for Implementation:** YES
**Next Step:** Create implementation plan with CSS updates
