# claude-code_unlimited

An unlimited version of Claude Code. A fork focused on rate limit bypass and multi-account management.

## Key Features

- Rate Limit Reset: Reset limits with `resetClaudeAiLimits()`
- Multi-Account: Switch between multiple accounts/API configurations
- New Model Support: References to opus47, opus48 added
- Browser Fetch Tool: Fetch data from browsers with `BrowserFetchTool`

## Directory Structure

```
claude-code_unlimited/
├── commands/account/      # Account management commands
├── commands/folder/       # Folder management commands
├── commands/thinking/     # Thinking commands
├── components/
│   ├── EffortSlider.tsx   # Effort slider
│   └── PromptInput/PromptInputUsageBars.tsx
├── tools/BrowserFetchTool/
└── utils/
    ├── multiAccount.ts    # Multi-account support
    ├── protectedNamespace.ts
    └── secureStorage/types.ts
```

## Disclaimer

- This is a fork, not the official version, and may have security risks
- Bypassing rate limits may violate Anthropic's Terms of Service
- Use at your own risk