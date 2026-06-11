import React from 'react'
import { MessageResponse } from '../../components/MessageResponse.js'
import { TOOL_SUMMARY_MAX_LENGTH } from '../../constants/toolLimits.js'
import { Box, Text } from '../../ink.js'
import type { ToolProgressData } from '../../Tool.js'
import type { ProgressMessage } from '../../types/message.js'
import { formatFileSize, truncate } from '../../utils/format.js'
import type { Output } from './BrowserFetchTool.js'

export function renderToolUseMessage(
  {
    url,
    browser,
    os,
  }: Partial<{
    url: string
    prompt: string
    browser: string
    os: string
  }>,
  { verbose }: { theme?: string; verbose: boolean },
): React.ReactNode {
  if (!url) {
    return null
  }
  const profile = browser ? ` (${browser}${os ? ` · ${os}` : ''})` : ''
  if (verbose) {
    return `url: "${url}"${profile}`
  }
  return `${url}${profile}`
}

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Text dimColor>Fetching…</Text>
    </MessageResponse>
  )
}

export function renderToolResultMessage(
  { bytes, code, codeText, result, browser, raw }: Output,
  _progressMessagesForMessage: ProgressMessage<ToolProgressData>[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const formattedSize = formatFileSize(bytes)
  const mode = raw ? 'raw' : 'summarized'
  if (verbose) {
    return (
      <Box flexDirection="column">
        <MessageResponse height={1}>
          <Text>
            Received <Text bold>{formattedSize}</Text> ({code} {codeText}) as{' '}
            {browser} ({mode})
          </Text>
        </MessageResponse>
        <Box flexDirection="column">
          <Text>{result}</Text>
        </Box>
      </Box>
    )
  }
  return (
    <MessageResponse height={1}>
      <Text>
        Received <Text bold>{formattedSize}</Text> ({code} {codeText})
      </Text>
    </MessageResponse>
  )
}

export function getToolUseSummary(
  input:
    | Partial<{ url: string; prompt: string; browser: string; os: string }>
    | undefined,
): string | null {
  if (!input?.url) {
    return null
  }
  return truncate(input.url, TOOL_SUMMARY_MAX_LENGTH)
}
