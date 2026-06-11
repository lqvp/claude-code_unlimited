import { z } from 'zod/v4'
import { getOperatingSystems, getProfiles } from 'wreq-js'
import type { BrowserProfile, EmulationOS } from 'wreq-js'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionUpdate } from '../../types/permissions.js'
import { formatFileSize } from '../../utils/format.js'
import { lazySchema } from '../../utils/lazySchema.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { getRuleByContentsForTool } from '../../utils/permissions/permissions.js'
import { BROWSER_FETCH_TOOL_NAME, DESCRIPTION } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
} from './UI.js'
import {
  applyPromptToMarkdown,
  DEFAULT_BROWSER,
  DEFAULT_OS,
  getURLContentImpersonated,
  htmlToMarkdown,
  MAX_MARKDOWN_LENGTH,
} from './utils.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z.string().url().describe('The URL to fetch content from'),
    prompt: z
      .string()
      .optional()
      .describe(
        'Optional. When provided, the content is summarized by a fast model to answer this prompt. When omitted, the raw response body is returned verbatim with no model call.',
      ),
    browser: z
      .string()
      .optional()
      .describe(
        `Browser profile to impersonate (TLS + HTTP/2 + headers). Default ${DEFAULT_BROWSER}. Examples: chrome_142, firefox_149, safari_18, edge_140.`,
      ),
    os: z
      .string()
      .optional()
      .describe(
        `Operating system to emulate. Default ${DEFAULT_OS}. One of: windows, macos, linux, android, ios. Keep consistent with the browser profile.`,
      ),
    headers: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Optional extra headers (e.g. Authorization, Referer) merged on top of the auto-generated browser headers.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    bytes: z.number().describe('Size of the fetched content in bytes'),
    code: z.number().describe('HTTP response code'),
    codeText: z.string().describe('HTTP response code text'),
    result: z.string().describe('Raw body, or the model answer when a prompt was given'),
    durationMs: z.number().describe('Time taken to fetch and process the content'),
    url: z.string().describe('The final URL that was fetched (after redirects)'),
    browser: z.string().describe('The browser profile that was impersonated'),
    os: z.string().describe('The operating system that was emulated'),
    raw: z.boolean().describe('True when the raw body was returned (no model call)'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

function browserFetchToolInputToPermissionRuleContent(input: {
  [k: string]: unknown
}): string {
  try {
    const parsedInput = BrowserFetchTool.inputSchema.safeParse(input)
    if (!parsedInput.success) {
      return `input:${input.toString()}`
    }
    const { url } = parsedInput.data
    const hostname = new URL(url).hostname
    return `domain:${hostname}`
  } catch {
    return `input:${input.toString()}`
  }
}

export const BrowserFetchTool = buildTool({
  name: BROWSER_FETCH_TOOL_NAME,
  searchHint: 'fetch a URL with a real browser TLS and HTTP2 fingerprint',
  // 100K chars - tool result persistence threshold
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  async description(input) {
    const { url } = input as { url: string }
    try {
      const hostname = new URL(url).hostname
      return `Claude wants to fetch content from ${hostname} using a browser fingerprint`
    } catch {
      return `Claude wants to fetch content from this URL using a browser fingerprint`
    }
  },
  userFacingName() {
    return 'BrowserFetch'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Fetching ${summary}` : 'Fetching web page'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.prompt ? `${input.url}: ${input.prompt}` : input.url
  },
  async checkPermissions(input, context): Promise<PermissionDecision> {
    const appState = context.getAppState()
    const permissionContext = appState.toolPermissionContext

    const ruleContent = browserFetchToolInputToPermissionRuleContent(input)

    const denyRule = getRuleByContentsForTool(
      permissionContext,
      BrowserFetchTool,
      'deny',
    ).get(ruleContent)
    if (denyRule) {
      return {
        behavior: 'deny',
        message: `${BrowserFetchTool.name} denied access to ${ruleContent}.`,
        decisionReason: { type: 'rule', rule: denyRule },
      }
    }

    const askRule = getRuleByContentsForTool(
      permissionContext,
      BrowserFetchTool,
      'ask',
    ).get(ruleContent)
    if (askRule) {
      return {
        behavior: 'ask',
        message: `Claude requested permissions to use ${BrowserFetchTool.name}, but you haven't granted it yet.`,
        decisionReason: { type: 'rule', rule: askRule },
        suggestions: buildSuggestions(ruleContent),
      }
    }

    const allowRule = getRuleByContentsForTool(
      permissionContext,
      BrowserFetchTool,
      'allow',
    ).get(ruleContent)
    if (allowRule) {
      return {
        behavior: 'allow',
        updatedInput: input,
        decisionReason: { type: 'rule', rule: allowRule },
      }
    }

    return {
      behavior: 'ask',
      message: `Claude requested permissions to use ${BrowserFetchTool.name}, but you haven't granted it yet.`,
      suggestions: buildSuggestions(ruleContent),
    }
  },
  async prompt() {
    return DESCRIPTION
  },
  async validateInput(input) {
    const { url, browser, os } = input
    try {
      new URL(url)
    } catch {
      return {
        result: false,
        message: `Error: Invalid URL "${url}". The URL provided could not be parsed.`,
        meta: { reason: 'invalid_url' },
        errorCode: 1,
      }
    }
    if (browser && !getProfiles().includes(browser as BrowserProfile)) {
      return {
        result: false,
        message: `Error: Unknown browser profile "${browser}". Use one of the supported profiles (e.g. ${DEFAULT_BROWSER}, firefox_149, safari_18).`,
        meta: { reason: 'invalid_browser' },
        errorCode: 1,
      }
    }
    if (os && !getOperatingSystems().includes(os as EmulationOS)) {
      return {
        result: false,
        message: `Error: Unknown os "${os}". Use one of: ${getOperatingSystems().join(', ')}.`,
        meta: { reason: 'invalid_os' },
        errorCode: 1,
      }
    }
    return { result: true }
  },
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolResultMessage,
  async call(
    { url, prompt, browser, os, headers },
    { abortController, options: { isNonInteractiveSession } },
  ) {
    const start = Date.now()
    const resolvedBrowser = (browser as BrowserProfile | undefined) ?? DEFAULT_BROWSER
    const resolvedOs = (os as EmulationOS | undefined) ?? DEFAULT_OS

    const response = await getURLContentImpersonated(
      url,
      { browser: resolvedBrowser, os: resolvedOs, headers },
      abortController,
    )

    const {
      rawContent,
      bytes,
      code,
      codeText,
      contentType,
      finalUrl,
      persistedPath,
      persistedSize,
    } = response

    const wantsRaw = prompt === undefined || prompt.trim() === ''

    let result: string
    if (wantsRaw) {
      // Raw mode: return the body verbatim, no model call at all.
      result =
        rawContent.length > MAX_MARKDOWN_LENGTH
          ? rawContent.slice(0, MAX_MARKDOWN_LENGTH) +
            '\n\n[Content truncated due to length...]'
          : rawContent
    } else {
      // Summarize mode: HTML -> markdown, then run the prompt through Haiku.
      const markdown = contentType.includes('text/html')
        ? await htmlToMarkdown(rawContent)
        : rawContent
      result = await applyPromptToMarkdown(
        prompt,
        markdown,
        abortController.signal,
        isNonInteractiveSession,
      )
    }

    if (persistedPath) {
      result += `\n\n[Binary content (${contentType}, ${formatFileSize(persistedSize ?? bytes)}) also saved to ${persistedPath}]`
    }

    const output: Output = {
      bytes,
      code,
      codeText,
      result,
      durationMs: Date.now() - start,
      url: finalUrl,
      browser: resolvedBrowser,
      os: resolvedOs,
      raw: wantsRaw,
    }

    return { data: output }
  },
  mapToolResultToToolResultBlockParam({ result }, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: result,
    }
  },
} satisfies ToolDef<InputSchema, Output>)

function buildSuggestions(ruleContent: string): PermissionUpdate[] {
  return [
    {
      type: 'addRules',
      destination: 'localSettings',
      rules: [{ toolName: BROWSER_FETCH_TOOL_NAME, ruleContent }],
      behavior: 'allow',
    },
  ]
}
