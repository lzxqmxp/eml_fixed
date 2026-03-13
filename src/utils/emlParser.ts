// EML Parser & Serializer
// Supports: RFC 2822 headers, RFC 2047 encoded-words, multipart/alternative,
//           base64 and quoted-printable content-transfer-encodings.

import * as iconv from 'iconv-lite-umd'

// ─── Encoding helpers ───────────────────────────────────────────────────────

/** Decode RFC 2047 encoded-words: =?charset?B|Q?text?= */
function normalizeCharset(charset: string): string {
  const low = charset.trim().toLowerCase()
  if (!low) return 'utf-8'
  if (low === 'gb2312' || low === 'gbk' || low === 'x-gbk') return 'gb18030'
  return low
}

function decodeEncodedWords(str: string): string {
  if (!str) return ''
  return str.replace(
    /=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g,
    (_match, charset: string, encoding: string, text: string) => {
      try {
        const decoderCharset = normalizeCharset(charset)
        if (encoding.toUpperCase() === 'B') {
          const binary = atob(text.replace(/\s/g, ''))
          const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
          return new TextDecoder(decoderCharset).decode(bytes)
        } else {
          // Q encoding: _ is space, =XX is hex byte
          const qDec = text
            .replace(/_/g, '\x20')
            .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
              String.fromCharCode(parseInt(hex, 16)),
            )
          const bytes = Uint8Array.from(qDec, (c) => c.charCodeAt(0))
          return new TextDecoder(decoderCharset).decode(bytes)
        }
      } catch {
        return _match
      }
    },
  )
}

/** Decode non-standard QP-like header bytes (e.g. Date: =D0=C7=...). */
function decodeLooseQPHeader(str: string): string {
  if (!/=([0-9A-Fa-f]{2})/.test(str)) return str

  const bytes: number[] = []
  let changed = false
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (
      ch === '='
      && i + 2 < str.length
      && /[0-9A-Fa-f]/.test(str[i + 1])
      && /[0-9A-Fa-f]/.test(str[i + 2])
    ) {
      bytes.push(parseInt(str.slice(i + 1, i + 3), 16))
      i += 2
      changed = true
    } else {
      bytes.push(str.charCodeAt(i) & 0xff)
    }
  }
  if (!changed) return str

  const buf = Uint8Array.from(bytes)
  for (const cs of ['utf-8', 'gb18030']) {
    try {
      return new TextDecoder(cs).decode(buf)
    } catch {
      // Try next charset.
    }
  }
  return str
}

function decodeHeaderValue(str: string): string {
  return decodeLooseQPHeader(decodeEncodedWords(str))
}

function replacementCount(str: string): number {
  let count = 0
  for (const ch of str) {
    if (ch === '\uFFFD') count++
  }
  return count
}

function decodeBytes(bytes: Uint8Array, charset = 'utf-8'): string {
  const normalized = normalizeCharset(charset)
  try {
    const decoded = iconv.decode(bytes, normalized)
    // Some emails incorrectly mark Chinese bytes as UTF-8. If UTF-8 decoding
    // produces many replacement chars, fall back to GB18030.
    if (normalized === 'utf-8' && replacementCount(decoded) > 0) {
      const gbDecoded = iconv.decode(bytes, 'gb18030')
      if (replacementCount(gbDecoded) < replacementCount(decoded)) {
        return gbDecoded
      }
    }
    return decoded
  } catch {
    try {
      return new TextDecoder(normalized).decode(bytes)
    } catch {
      return String.fromCharCode(...bytes)
    }
  }
}

function decodeRawBody(raw: string, charset = 'utf-8'): string {
  const normalizedRaw = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const bytes = Uint8Array.from(normalizedRaw, (c) => c.charCodeAt(0) & 0xff)
  return decodeBytes(bytes, charset)
}

function toCRLF(str: string): string {
  return str.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n')
}

function encodeBytes(str: string, charset = 'utf-8'): Uint8Array {
  const normalized = normalizeCharset(charset)
  try {
    return Uint8Array.from(iconv.encode(str, normalized))
  } catch {
    return new TextEncoder().encode(str)
  }
}

/** Encode a header value using RFC 2047 Base64 when non-ASCII is present. */
function encodeForHeader(str: string): string {
  if (!str) return ''
  if (!/[^\x00-\x7F]/.test(str)) return str
  const bytes = new TextEncoder().encode(str)
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('')
  return `=?UTF-8?B?${btoa(binary)}?=`
}

/** Decode quoted-printable content. */
function decodeQP(str: string, charset = 'utf-8'): string {
  const decoded = str
    .replace(/=\r\r\n/g, '')
    .replace(/=\r\n/g, '')
    .replace(/=\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
  try {
    const bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0))
    return decodeBytes(bytes, charset)
  } catch {
    return decoded
  }
}

/** Encode content using quoted-printable. */
function encodeQP(str: string, charset = 'utf-8'): string {
  const bytes = encodeBytes(str, charset)
  const HEX_DIGITS = '0123456789ABCDEF'
  let result = ''
  let lineLen = 0

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]

    if (b === 0x0d) {
      if (i + 1 < bytes.length && bytes[i + 1] === 0x0a) {
        result += '\r\n'
        lineLen = 0
        i++
      } else {
        result += '\r\n'
        lineLen = 0
      }
      continue
    }
    if (b === 0x0a) {
      result += '\r\n'
      lineLen = 0
      continue
    }

    let encoded: string
    if ((b >= 33 && b <= 126 && b !== 61) || b === 9) {
      encoded = String.fromCharCode(b)
    } else if (b === 32) {
      encoded = ' '
    } else {
      encoded = `=${HEX_DIGITS[(b >> 4) & 0xf]}${HEX_DIGITS[b & 0xf]}`
    }

    if (lineLen + encoded.length > 75) {
      result += '=\r\n'
      lineLen = 0
    }
    result += encoded
    lineLen += encoded.length
  }
  return result
}

/** Decode base64 encoded body. */
function decodeBase64Content(str: string, charset = 'utf-8'): string {
  try {
    const cleaned = str.replace(/\s/g, '')
    const binary = atob(cleaned)
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return decodeBytes(bytes, charset)
  } catch {
    return str
  }
}

/** Encode content as base64, wrapped at 76 chars (RFC 2045). */
function encodeBase64Content(str: string, charset = 'utf-8'): string {
  const bytes = encodeBytes(str, charset)
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('')
  const b64 = btoa(binary)
  return b64.replace(/(.{76})/g, '$1\r\n')
}

// ─── Header parsing ──────────────────────────────────────────────────────────

interface HeaderEntry {
  name: string // original case
  rawValue: string // possibly RFC-2047 encoded, unfolded
}

function parseRawHeaders(section: string): HeaderEntry[] {
  const result: HeaderEntry[] = []
  const lines = section.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line || /^[ \t]/.test(line)) {
      i++
      continue
    }
    const colon = line.indexOf(':')
    if (colon < 0) {
      i++
      continue
    }
    const name = line.substring(0, colon)
    let rawValue = line.substring(colon + 1).trimStart()
    // Collect RFC-2822 folded continuation lines
    while (i + 1 < lines.length && /^[ \t]/.test(lines[i + 1])) {
      i++
      rawValue += ' ' + lines[i].trim()
    }
    result.push({ name, rawValue })
    i++
  }
  return result
}

function getHeader(headers: HeaderEntry[], name: string): string | undefined {
  const low = name.toLowerCase()
  return headers.find((h) => h.name.toLowerCase() === low)?.rawValue
}

function getAllHeaders(headers: HeaderEntry[], name: string): string[] {
  const low = name.toLowerCase()
  return headers.filter((h) => h.name.toLowerCase() === low).map((h) => h.rawValue)
}

// ─── MIME part parsing ───────────────────────────────────────────────────────

interface MimePart {
  headerEntries: HeaderEntry[]
  contentType: string
  charset: string
  encoding: string
  boundary?: string
  rawBody: string
  decodedBody?: string
  subparts?: MimePart[]
}

function parseMimePart(raw: string): MimePart {
  const sepMatch = raw.match(/\n\n/)
  let headerSection: string
  let rawBody: string
  if (sepMatch && sepMatch.index !== undefined) {
    headerSection = raw.substring(0, sepMatch.index)
    rawBody = raw.substring(sepMatch.index + 2)
  } else {
    headerSection = raw
    rawBody = ''
  }

  const headerEntries = parseRawHeaders(headerSection.replace(/^\n/, ''))

  const ctRaw = getHeader(headerEntries, 'content-type') || 'text/plain; charset=utf-8'
  const contentType = ctRaw.split(';')[0].trim().toLowerCase()

  const charsetM = ctRaw.match(/charset\s*=\s*["']?([^"';\s]+)["']?/i)
  const charset = charsetM ? charsetM[1].toLowerCase() : 'utf-8'

  const boundaryM = ctRaw.match(/boundary\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s;]+))/i)
  const boundary = boundaryM ? (boundaryM[1] ?? boundaryM[2] ?? boundaryM[3]) : undefined

  const encoding = (
    getHeader(headerEntries, 'content-transfer-encoding') ?? '7bit'
  )
    .toLowerCase()
    .trim()

  let decodedBody: string | undefined
  let subparts: MimePart[] | undefined

  if (contentType.startsWith('multipart/') && boundary) {
    subparts = parseSubparts(rawBody, boundary)
  } else if (contentType === 'text/plain' || contentType === 'text/html') {
    if (encoding === 'base64') {
      decodedBody = decodeBase64Content(rawBody, charset)
    } else if (encoding === 'quoted-printable') {
      decodedBody = decodeQP(rawBody, charset)
    } else {
      decodedBody = decodeRawBody(rawBody, charset)
    }
  }

  return { headerEntries, contentType, charset, encoding, boundary, rawBody, decodedBody, subparts }
}

function parseSubparts(body: string, boundary: string): MimePart[] {
  const parts: MimePart[] = []
  const norm = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const boundaryLineRe = new RegExp(`^--${escapeRegex(boundary)}(--)?[ \t]*$`, 'gm')
  const marks: Array<{ start: number; end: number; isClosing: boolean }> = []

  let m: RegExpExecArray | null
  while ((m = boundaryLineRe.exec(norm)) !== null) {
    const start = m.index
    const lineEnd = norm.indexOf('\n', start)
    const end = lineEnd >= 0 ? lineEnd : norm.length
    marks.push({ start, end, isClosing: Boolean(m[1]) })
  }

  for (let i = 0; i < marks.length; i++) {
    const cur = marks[i]
    if (cur.isClosing) break
    const next = marks[i + 1]
    const partStart = cur.end < norm.length ? cur.end + 1 : cur.end
    const partEnd = next ? next.start : norm.length
    const rawPart = norm.slice(partStart, partEnd)
    const trimmed = rawPart.replace(/^\n+|\n+$/g, '')
    if (!trimmed) continue
    parts.push(parseMimePart(trimmed))
  }

  return parts
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findPartDeep(parts: MimePart[], ct: string): MimePart | undefined {
  for (const p of parts) {
    if (p.contentType === ct) return p
    if (p.subparts) {
      const found = findPartDeep(p.subparts, ct)
      if (found) return found
    }
  }
  return undefined
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface EmlData {
  /** All Received: headers joined with '\n' (decoded) */
  received: string
  /** Date: header value (decoded) */
  date: string
  /** From: header value (decoded) */
  from: string
  /** To: header value (decoded) */
  to: string
  /** Subject: header value (decoded) */
  subject: string
  /** Decoded text/plain body */
  textContent: string
  /** Decoded text/html body */
  htmlContent: string
}

/**
 * Parse a raw EML string into an EmlData object with decoded values.
 */
export function parseEml(raw: string): EmlData {
  const norm = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  const sepIdx = norm.indexOf('\n\n')
  const headerSection = sepIdx >= 0 ? norm.substring(0, sepIdx) : norm
  const bodySection = sepIdx >= 0 ? norm.substring(sepIdx + 2) : ''

  const headers = parseRawHeaders(headerSection)

  const received = getAllHeaders(headers, 'received')
    .map((v) => decodeHeaderValue(v))
    .join('\n')
  const date = decodeHeaderValue(getHeader(headers, 'date') ?? '')
  const from = decodeHeaderValue(getHeader(headers, 'from') ?? '')
  const to = decodeHeaderValue(getHeader(headers, 'to') ?? '')
  const subject = decodeHeaderValue(getHeader(headers, 'subject') ?? '')

  const ctRaw = getHeader(headers, 'content-type') ?? 'text/plain'
  const contentType = ctRaw.split(';')[0].trim().toLowerCase()
  const charsetM = ctRaw.match(/charset\s*=\s*["']?([^"';\s]+)["']?/i)
  const charset = charsetM ? charsetM[1] : 'utf-8'
  const encoding = (getHeader(headers, 'content-transfer-encoding') ?? '7bit').toLowerCase().trim()
  const boundaryM = ctRaw.match(/boundary\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s;]+))/i)
  const boundary = boundaryM ? (boundaryM[1] ?? boundaryM[2] ?? boundaryM[3]) : undefined

  let textContent = ''
  let htmlContent = ''

  if (contentType.startsWith('multipart/') && boundary) {
    const subparts = parseSubparts(bodySection, boundary)
    const textPart = findPartDeep(subparts, 'text/plain')
    const htmlPart = findPartDeep(subparts, 'text/html')
    if (textPart) textContent = textPart.decodedBody ?? ''
    if (htmlPart) htmlContent = htmlPart.decodedBody ?? ''
  } else if (contentType === 'text/plain') {
    if (encoding === 'base64') textContent = decodeBase64Content(bodySection, charset)
    else if (encoding === 'quoted-printable') textContent = decodeQP(bodySection, charset)
    else textContent = decodeRawBody(bodySection, charset)
  } else if (contentType === 'text/html') {
    if (encoding === 'base64') htmlContent = decodeBase64Content(bodySection, charset)
    else if (encoding === 'quoted-printable') htmlContent = decodeQP(bodySection, charset)
    else htmlContent = decodeRawBody(bodySection, charset)
  } else if (!contentType.startsWith('multipart/')) {
    // Unrecognised – surface as plain text
    textContent = decodeRawBody(bodySection, charset)
  }

  return { received, date, from, to, subject, textContent, htmlContent }
}

// ─── Serialization ───────────────────────────────────────────────────────────

/** Re-encode content using the original transfer encoding. */
function reencodeBody(content: string, encoding: string, charset = 'utf-8'): string {
  if (encoding === 'base64') return encodeBase64Content(content, charset)
  if (encoding === 'quoted-printable') return encodeQP(content, charset)

  const bytes = encodeBytes(content.replace(/\r?\n/g, '\r\n'), charset)
  return Array.from(bytes, (b) => String.fromCharCode(b)).join('')
}

/**
 * Rebuild the header section by applying the supplied updates.
 * Keys are lower-case header names; values are decoded strings.
 * Existing headers are replaced in-place (preserving original case & position).
 * Headers with array values (e.g. Received) replace all occurrences.
 */
function updateHeaders(
  headerSection: string,
  updates: Record<string, string | string[]>,
): string {
  const lines = headerSection.split('\n')
  const output: string[] = []
  const handled = new Set<string>()

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Continuation / empty lines handled below
    if (!line || /^[ \t]/.test(line)) {
      output.push(line)
      i++
      continue
    }

    const colon = line.indexOf(':')
    if (colon < 0) {
      output.push(line)
      i++
      continue
    }

    const nameLow = line.substring(0, colon).toLowerCase()
    const originalName = line.substring(0, colon)

    if (nameLow in updates) {
      // Skip original value + any continuation lines
      while (i + 1 < lines.length && /^[ \t]/.test(lines[i + 1])) i++

      if (!handled.has(nameLow)) {
        const newVal = updates[nameLow]
        if (Array.isArray(newVal)) {
          for (const v of newVal) {
            if (v.trim()) output.push(`${originalName}: ${encodeForHeader(v.trim())}`)
          }
        } else if (typeof newVal === 'string' && newVal.trim()) {
          output.push(`${originalName}: ${encodeForHeader(newVal)}`)
        }
        handled.add(nameLow)
      }
      // Duplicate occurrences are discarded (they'll be re-added once above)
    } else {
      output.push(line)
    }
    i++
  }

  // Add headers that didn't exist yet
  for (const [nameLow, val] of Object.entries(updates)) {
    if (!handled.has(nameLow)) {
      const displayName = nameLow.charAt(0).toUpperCase() + nameLow.slice(1)
      if (Array.isArray(val)) {
        for (const v of val) {
          if (v.trim()) output.push(`${displayName}: ${encodeForHeader(v.trim())}`)
        }
      } else if (val.trim()) {
        output.push(`${displayName}: ${encodeForHeader(val)}`)
      }
    }
  }

  return output.join('\n')
}

/**
 * Walk a multipart body and replace the encoded body of parts matching
 * the given Content-Type.
 */
function replaceInMultipart(
  body: string,
  boundary: string,
  replacements: Record<string, string>,
): string {
  const norm = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const boundaryLineRe = new RegExp(`^--${escapeRegex(boundary)}(--)?[ \t]*$`, 'gm')
  const marks: Array<{ start: number; end: number; isClosing: boolean }> = []

  let m: RegExpExecArray | null
  while ((m = boundaryLineRe.exec(norm)) !== null) {
    const start = m.index
    const lineEnd = norm.indexOf('\n', start)
    const end = lineEnd >= 0 ? lineEnd : norm.length
    marks.push({ start, end, isClosing: Boolean(m[1]) })
  }
  if (marks.length === 0) return body

  let out = ''
  let cursor = 0

  for (let i = 0; i < marks.length; i++) {
    const cur = marks[i]
    const next = marks[i + 1]

    if (cursor < cur.start) out += norm.slice(cursor, cur.start)

    const boundaryLine = norm.slice(cur.start, cur.end)
    out += boundaryLine
    if (cur.end < norm.length) out += '\n'

    if (cur.isClosing) {
      cursor = cur.end + 1
      continue
    }

    const partStart = cur.end < norm.length ? cur.end + 1 : cur.end
    const partEnd = next ? next.start : norm.length
    const partRaw = norm.slice(partStart, partEnd)

    const partSep = partRaw.indexOf('\n\n')
    if (partSep < 0) {
      out += partRaw
      cursor = partEnd
      continue
    }

    const partHeaderSection = partRaw.substring(0, partSep).replace(/^\n/, '')
    const partHeaderEntries = parseRawHeaders(partHeaderSection)
    const ctRaw = getHeader(partHeaderEntries, 'content-type') ?? 'text/plain'
    const ct = ctRaw.split(';')[0].trim().toLowerCase()
    const enc = (getHeader(partHeaderEntries, 'content-transfer-encoding') ?? '7bit')
      .toLowerCase()
      .trim()

    if (ct in replacements) {
      const oldBodyWithSuffix = partRaw.substring(partSep + 2)
      const bodyNoTrail = oldBodyWithSuffix.replace(/\n+$/g, '')
      const trailing = oldBodyWithSuffix.slice(bodyNoTrail.length)
      const charsetM = ctRaw.match(/charset\s*=\s*["']?([^"';\s]+)["']?/i)
      const targetCharset = charsetM ? charsetM[1] : 'utf-8'
      const newEncodedBody = reencodeBody(replacements[ct], enc, targetCharset)
      out += `${partHeaderSection}\n\n${newEncodedBody}${trailing}`
    } else if (ct.startsWith('multipart/')) {
      const bm = ctRaw.match(/boundary\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s;]+))/i)
      const innerBoundary = bm ? (bm[1] ?? bm[2] ?? bm[3]) : undefined
      if (innerBoundary) {
        const innerBody = partRaw.substring(partSep + 2)
        const newInnerBody = replaceInMultipart(innerBody, innerBoundary, replacements)
        out += partRaw.substring(0, partSep + 2) + newInnerBody
      } else {
        out += partRaw
      }
    } else {
      out += partRaw
    }

    cursor = partEnd
  }

  if (cursor < norm.length) out += norm.slice(cursor)
  // Keep LF here; buildEml performs one final LF->CRLF conversion for the whole message.
  return out
}

/**
 * Rebuild a raw EML string by applying the edits from an EmlData object.
 * Non-edited headers and binary attachments are preserved verbatim.
 */
export function buildEml(originalRaw: string, data: EmlData): string {
  // Work with LF internally; convert to CRLF at the very end
  const norm = originalRaw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  const sepIdx = norm.indexOf('\n\n')
  if (sepIdx < 0) {
    // No body – just update headers
    const updated = updateHeaders(norm, {
      received: data.received.split('\n').filter((v) => v.trim()),
      date: data.date,
      from: data.from,
      to: data.to,
      subject: data.subject,
    })
    return toCRLF(updated)
  }

  let headerSection = norm.substring(0, sepIdx)
  let bodySection = norm.substring(sepIdx + 2)

  const originalParsed = parseEml(originalRaw)
  const textChanged = data.textContent !== originalParsed.textContent
  const htmlChanged = data.htmlContent !== originalParsed.htmlContent

  headerSection = updateHeaders(headerSection, {
    received: data.received.split('\n').filter((v) => v.trim()),
    date: data.date,
    from: data.from,
    to: data.to,
    subject: data.subject,
  })

  // Parse top-level content-type to decide how to update the body
  const headers = parseRawHeaders(headerSection)
  const ctRaw = getHeader(headers, 'content-type') ?? 'text/plain'
  const contentType = ctRaw.split(';')[0].trim().toLowerCase()
  const encoding = (getHeader(headers, 'content-transfer-encoding') ?? '7bit').toLowerCase().trim()
  const charsetM = ctRaw.match(/charset\s*=\s*["']?([^"';\s]+)["']?/i)
  const topCharset = charsetM ? charsetM[1] : 'utf-8'
  const boundaryM = ctRaw.match(/boundary\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s;]+))/i)
  const boundary = boundaryM ? (boundaryM[1] ?? boundaryM[2] ?? boundaryM[3]) : undefined

  if (contentType.startsWith('multipart/') && boundary) {
    const replacements: Record<string, string> = {}
    if (textChanged) replacements['text/plain'] = data.textContent
    if (htmlChanged) replacements['text/html'] = data.htmlContent
    if (Object.keys(replacements).length > 0) {
      bodySection = replaceInMultipart(bodySection, boundary, replacements)
    }
  } else if (contentType === 'text/plain') {
    if (textChanged) {
      bodySection = reencodeBody(data.textContent, encoding, topCharset)
    }
  } else if (contentType === 'text/html') {
    if (htmlChanged) {
      bodySection = reencodeBody(data.htmlContent, encoding, topCharset)
    }
  }

  return toCRLF(headerSection + '\n\n' + bodySection)
}
