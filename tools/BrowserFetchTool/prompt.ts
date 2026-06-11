export const BROWSER_FETCH_TOOL_NAME = 'BrowserFetch'

export const DESCRIPTION = `
- Fetches a URL using a real browser network fingerprint (TLS JA3/JA4 + HTTP/2) and browser headers
- Unlike WebFetch, the request is indistinguishable from a real browser at the TLS and HTTP/2 layer, so it can reach sites that block generic HTTP clients (bot/anti-scraping/TLS-fingerprint walls)
- Browser-standard headers (User-Agent, Accept, Accept-Language, sec-ch-ua*, sec-fetch-*, etc.) are generated automatically in the correct order for the chosen profile — you do not need to supply them
- Takes a URL and an optional prompt
- When a prompt IS provided: the content is converted to markdown and processed by a small, fast model that answers the prompt
- When NO prompt is provided: the RAW response body is returned verbatim (no model is called). Use this when you need the exact HTML/JSON/text, not a summary
- Returns the response with its HTTP status

Usage notes:
  - The URL must be a fully-formed valid URL
  - HTTP URLs will be automatically upgraded to HTTPS
  - Choose a "browser" profile (default chrome_142) and "os" (default windows). Keep them consistent — e.g. a Chrome-on-Windows profile reports Windows in its client hints
  - Pass "headers" only for extras the site needs (auth tokens, a specific Referer); they are merged on top of the auto-generated browser headers
  - Omit "prompt" to get raw bytes back; provide "prompt" to get an AI-extracted answer about the content
  - This tool is read-only and does not modify any files
  - Includes a self-cleaning 15-minute cache for faster responses when repeatedly accessing the same URL
  - Redirects are followed automatically with the same fingerprint preserved across hops
`

export function makeSecondaryModelPrompt(
  markdownContent: string,
  prompt: string,
): string {
  return `
Web page content:
---
${markdownContent}
---

${prompt}

Provide a concise response based on the content above. Include relevant details, code examples, and documentation excerpts as needed.
`
}
