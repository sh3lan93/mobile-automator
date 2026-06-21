'use strict';

// Map a mobile-mcp 0.0.55 element ({type,text,label,identifier,coordinates})
// onto the shape tools/recorder/src/capture/element-resolver.js hit-tests:
// { type, text, accessibility_label, bounds:[x1,y1,x2,y2] }. We deliberately
// drop `identifier` (resource-id) so the resolver's resource-id fallback never
// fires — captured targets stay platform-agnostic (label/text only).
function mapMcpElement(el) {
  const c = (el && el.coordinates) || {};
  const bounds = ['x', 'y', 'width', 'height'].every((k) => typeof c[k] === 'number')
    ? [c.x, c.y, c.x + c.width, c.y + c.height]
    : null;
  return {
    type: el && el.type != null ? el.type : null,
    text: el && el.text != null ? el.text : null,
    accessibility_label: el && el.label != null ? el.label : null,
    bounds,
  };
}

module.exports = { mapMcpElement };
