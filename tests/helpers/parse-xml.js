'use strict';

// A deliberately small XML well-formedness checker for the JUnit tests. It is
// hand-rolled because no XML parser is a declared dependency (jsdom is only
// transitive), and the reports under test use a narrow subset: an optional
// <?xml?> declaration, elements, attributes, text, and the five predefined
// entities plus numeric character references. Anything outside that subset —
// a comment, CDATA, a DOCTYPE — is rejected rather than half-understood.
//
// parseXml(xml) -> { name, attrs, children, text } for the root element, or
// throws an Error naming the offset of the first problem.

const NAME = /^[A-Za-z_][\w.-]*/;
const ENTITY = /^&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9A-Fa-f]+);/;
// Characters XML 1.0 forbids anywhere in a document.
// eslint-disable-next-line no-control-regex
const ILLEGAL_CHAR = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;

const DECODE = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(raw, at) {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '<') throw new Error(`unescaped "<" at ${at + i}`);
    if (ch !== '&') {
      out += ch;
      continue;
    }
    const m = ENTITY.exec(raw.slice(i));
    if (!m) throw new Error(`bare "&" at ${at + i}`);
    const body = m[0].slice(1, -1);
    if (body.startsWith('#x')) out += String.fromCodePoint(parseInt(body.slice(2), 16));
    else if (body.startsWith('#')) out += String.fromCodePoint(parseInt(body.slice(1), 10));
    else out += DECODE[body];
    i += m[0].length - 1;
  }
  return out;
}

function parseXml(xml) {
  if (typeof xml !== 'string') throw new Error('parseXml expects a string');
  const bad = ILLEGAL_CHAR.exec(xml);
  if (bad) throw new Error(`character illegal in XML 1.0 at ${bad.index}`);

  let pos = 0;
  const skipWs = () => {
    while (pos < xml.length && /\s/.test(xml[pos])) pos += 1;
  };

  if (xml.startsWith('<?xml')) {
    const end = xml.indexOf('?>');
    if (end < 0) throw new Error('unterminated XML declaration');
    pos = end + 2;
  }

  const stack = [];
  let root = null;

  for (;;) {
    if (stack.length === 0) skipWs();
    if (pos >= xml.length) break;

    if (xml[pos] !== '<') {
      const next = xml.indexOf('<', pos);
      const end = next < 0 ? xml.length : next;
      const raw = xml.slice(pos, end);
      if (stack.length === 0) throw new Error(`text outside the root element at ${pos}`);
      stack[stack.length - 1].text += decode(raw, pos);
      pos = end;
      continue;
    }

    if (xml.startsWith('<!', pos) || xml.startsWith('<?', pos)) {
      throw new Error(`unsupported markup at ${pos}`);
    }

    if (xml[pos + 1] === '/') {
      pos += 2;
      const m = NAME.exec(xml.slice(pos));
      if (!m) throw new Error(`bad closing tag at ${pos}`);
      pos += m[0].length;
      skipWs();
      if (xml[pos] !== '>') throw new Error(`unterminated closing tag at ${pos}`);
      pos += 1;
      const open = stack.pop();
      if (!open || open.name !== m[0]) {
        throw new Error(`mismatched </${m[0]}>; open element is ${open ? `<${open.name}>` : 'none'}`);
      }
      continue;
    }

    pos += 1;
    const m = NAME.exec(xml.slice(pos));
    if (!m) throw new Error(`bad element name at ${pos}`);
    const el = { name: m[0], attrs: {}, children: [], text: '' };
    pos += m[0].length;

    for (;;) {
      const before = pos;
      skipWs();
      if (xml.startsWith('/>', pos)) {
        pos += 2;
        break;
      }
      if (xml[pos] === '>') {
        pos += 1;
        stack.push(el);
        break;
      }
      if (pos === before) throw new Error(`expected whitespace before attribute at ${pos}`);
      const an = NAME.exec(xml.slice(pos));
      if (!an) throw new Error(`bad attribute name at ${pos}`);
      pos += an[0].length;
      if (xml[pos] !== '=' || xml[pos + 1] !== '"') throw new Error(`attribute must be name="value" at ${pos}`);
      pos += 2;
      const close = xml.indexOf('"', pos);
      if (close < 0) throw new Error(`unterminated attribute at ${pos}`);
      if (Object.prototype.hasOwnProperty.call(el.attrs, an[0])) {
        throw new Error(`duplicate attribute ${an[0]} at ${pos}`);
      }
      el.attrs[an[0]] = decode(xml.slice(pos, close), pos);
      pos = close + 1;
    }

    if (stack.length === 0 || (stack.length === 1 && stack[0] === el)) {
      if (root) throw new Error(`second root element at ${pos}`);
      root = el;
    } else {
      const parent = stack[stack.length - 1] === el ? stack[stack.length - 2] : stack[stack.length - 1];
      parent.children.push(el);
    }
  }

  if (stack.length) throw new Error(`unclosed <${stack[stack.length - 1].name}>`);
  if (!root) throw new Error('no root element');
  return root;
}

// Every descendant element named `name`, depth-first, in document order.
function findAll(node, name) {
  const out = [];
  for (const child of node.children) {
    if (child.name === name) out.push(child);
    out.push(...findAll(child, name));
  }
  return out;
}

module.exports = { parseXml, findAll };
