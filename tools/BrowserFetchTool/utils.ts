import { LRUCache } from 'lru-cache'
import { fetch as wreqFetch } from 'wreq-js'
import type { BrowserProfile, EmulationOS } from 'wreq-js'
import { getContentHandlingSection, getInjectionHandlingSection } from '../../constants/prompts.js'
import { queryHaiku } from '../../services/api/claude.js'
import { AbortError } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import {
  isBinaryContentType,
  persistBinaryContent,
} from '../../utils/mcpOutputStorage.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import { makeSecondaryModelPrompt } from './prompt.js'

export const DEFAULT_BROWSER: BrowserProfile = 'chrome_142'
export const DEFAULT_OS: EmulationOS = 'windows'

export type ImpersonateOptions = {
  browser: BrowserProfile
  os: EmulationOS
  headers?: Record<string, string>
}

// Match WebFetch's resource limits for parity.
const MAX_URL_LENGTH = 2000
const MAX_HTTP_CONTENT_LENGTH = 10 * 1024 * 1024 // 10MB
const FETCH_TIMEOUT_MS = 60_000
export const MAX_MARKDOWN_LENGTH = 100_000

// 15-minute TTL, 50MB cap. Keyed by url + fingerprint, since the response can
// differ per browser/os/header set.
const CACHE_TTL_MS = 15 * 60 * 1000
const MAX_CACHE_SIZE_BYTES = 50 * 1024 * 1024

type CacheEntry = {
  rawContent: string
  bytes: number
  code: number
  codeText: string
  contentType: string
  finalUrl: string
  persistedPath?: string
  persistedSize?: number
}

const URL_CACHE = new LRUCache<string, CacheEntry>({
  maxSize: MAX_CACHE_SIZE_BYTES,
  ttl: CACHE_TTL_MS,
})

export function clearBrowserFetchCache(): void {
  URL_CACHE.clear()
}

function cacheKey(url: string, opts: ImpersonateOptions): string {
  return `${opts.browser}|${opts.os}|${opts.headers ? JSON.stringify(opts.headers) : ''}|${url}`
}

// Lazy turndown singleton — same rationale as WebFetchTool: defer the ~1.4MB
// domino import until the first HTML body and reuse one stateless instance.
type TurndownCtor = typeof import('turndown')
let turndownServicePromise: Promise<InstanceType<TurndownCtor>> | undefined
function getTurndownService(): Promise<InstanceType<TurndownCtor>> {
  return (turndownServicePromise ??= import('turndown').then(m => {
    const Turndown = (m as unknown as { default: TurndownCtor }).default
    return new Turndown()
  }))
}

export async function htmlToMarkdown(html: string): Promise<string> {
  return (await getTurndownService()).turndown(html)
}

export function validateURL(url: string): boolean {
  if (url.length > MAX_URL_LENGTH) {
    return false
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.username || parsed.password) {
    return false
  }
  const parts = parsed.hostname.split('.')
  if (parts.length < 2) {
    return false
  }
  return true
}

export type FetchedContent = CacheEntry

export async function getURLContentImpersonated(
  url: string,
  opts: ImpersonateOptions,
  abortController: AbortController,
): Promise<FetchedContent> {
  if (!validateURL(url)) {
    throw new Error('Invalid URL')
  }

  const key = cacheKey(url, opts)
  const cached = URL_CACHE.get(key)
  if (cached) {
    return cached
  }

  // Upgrade http -> https, mirroring WebFetch behavior.
  let requestUrl = url
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:') {
      parsed.protocol = 'https:'
      requestUrl = parsed.toString()
    }
  } catch (e) {
    logError(e)
  }

  const response = await wreqFetch(requestUrl, {
    browser: opts.browser,
    os: opts.os,
    headers: opts.headers,
    timeout: FETCH_TIMEOUT_MS,
    redirect: 'follow',
    signal: abortController.signal,
  })

  const arrayBuffer = await response.arrayBuffer()
  if (abortController.signal.aborted) {
    throw new AbortError()
  }

  const rawBuffer = Buffer.from(arrayBuffer)
  if (rawBuffer.length > MAX_HTTP_CONTENT_LENGTH) {
    throw new Error(
      `Response exceeds maximum content length (${MAX_HTTP_CONTENT_LENGTH} bytes)`,
    )
  }

  const contentType = response.headers.get('content-type') ?? ''

  // Binary content (PDFs, images, etc.): persist to disk so it can be inspected
  // later, same as WebFetch.
  let persistedPath: string | undefined
  let persistedSize: number | undefined
  if (isBinaryContentType(contentType)) {
    const persistId = `browserfetch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const result = await persistBinaryContent(rawBuffer, contentType, persistId)
    if (!('error' in result)) {
      persistedPath = result.filepath
      persistedSize = result.size
    }
  }

  const entry: CacheEntry = {
    rawContent: rawBuffer.toString('utf-8'),
    bytes: rawBuffer.length,
    code: response.status,
    codeText: response.statusText,
    contentType,
    finalUrl: response.url || requestUrl,
    persistedPath,
    persistedSize,
  }

  URL_CACHE.set(key, entry, { size: Math.max(1, entry.bytes) })
  return entry
}

export async function applyPromptToMarkdown(
  prompt: string,
  markdownContent: string,
  signal: AbortSignal,
  isNonInteractiveSession: boolean,
): Promise<string> {
  const truncatedContent =
    markdownContent.length > MAX_MARKDOWN_LENGTH
      ? markdownContent.slice(0, MAX_MARKDOWN_LENGTH) +
        '\n\n[Content truncated due to length...]'
      : markdownContent

  const modelPrompt = makeSecondaryModelPrompt(truncatedContent, prompt)
  const assistantMessage = await queryHaiku({
    systemPrompt: asSystemPrompt([
      getInjectionHandlingSection(),
      getContentHandlingSection(),
    ]),
    userPrompt: modelPrompt,
    signal,
    options: {
      querySource: 'web_fetch_apply',
      agents: [],
      isNonInteractiveSession,
      hasAppendSystemPrompt: false,
      mcpTools: [],
    },
  })

  if (signal.aborted) {
    throw new AbortError()
  }

  const { content } = assistantMessage.message
  if (content.length > 0) {
    const contentBlock = content[0]
    if (contentBlock && 'text' in contentBlock) {
      return contentBlock.text
    }
  }
  return 'No response from model'
}
