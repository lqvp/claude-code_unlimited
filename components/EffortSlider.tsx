import * as React from 'react'
import { useState } from 'react'
import { Box, Text, useInput } from '../ink.js'
import { Dialog } from './design-system/Dialog.js'
import { Byline } from './design-system/Byline.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { capitalize } from '../utils/stringUtils.js'
import {
  EFFORT_LEVELS,
  type EffortLevel,
  type EffortValue,
  getDisplayedEffortLevel,
  getEffortLevelDescription,
  modelSupportsEffort,
  modelSupportsMaxEffort,
  modelSupportsXhighEffort,
} from '../utils/effort.js'

type Props = {
  model: string
  currentEffort: EffortValue | undefined
  onSelect: (level: EffortLevel) => void
  onCancel: () => void
}

/**
 * Build the list of effort levels selectable for the given model. 'xhigh' and
 * 'max' are filtered out when the model doesn't support them, mirroring the
 * downgrade logic in resolveAppliedEffort so the slider never offers a level
 * that would be silently clamped to 'high'.
 */
function getSelectableLevels(model: string): EffortLevel[] {
  return EFFORT_LEVELS.filter(
    level =>
      (level !== 'max' || modelSupportsMaxEffort(model)) &&
      (level !== 'xhigh' || modelSupportsXhighEffort(model)),
  )
}

export function EffortSlider({
  model,
  currentEffort,
  onSelect,
  onCancel,
}: Props): React.ReactNode {
  const levels = getSelectableLevels(model)
  const supportsEffort = modelSupportsEffort(model)
  const startLevel = getDisplayedEffortLevel(model, currentEffort)
  const startIndex = Math.max(0, levels.indexOf(startLevel))
  const [index, setIndex] = useState(startIndex)

  useInput((_input, key) => {
    if (key.escape) {
      onCancel()
      return
    }
    if (!supportsEffort || levels.length === 0) {
      return
    }
    if (key.leftArrow) {
      setIndex(prev => (prev - 1 + levels.length) % levels.length)
    } else if (key.rightArrow) {
      setIndex(prev => (prev + 1) % levels.length)
    } else if (key.return) {
      const picked = levels[index]
      if (picked) onSelect(picked)
    }
  })

  if (!supportsEffort || levels.length === 0) {
    return (
      <Dialog
        title="Effort"
        onCancel={onCancel}
        isCancelActive={false}
        hideInputGuide
      >
        <Box flexDirection="column" gap={1}>
          <Text color="subtle">
            Effort is not supported for this model. Press Esc to close.
          </Text>
        </Box>
      </Dialog>
    )
  }

  const selected = levels[index]!

  // Lay the level labels out in evenly-sized cells so the track marker can be
  // centered under the selected label. The marker (▲) sits inline within the
  // track line, matching the official slider: ─────▲─────
  const CELL = 10
  const trackWidth = levels.length * CELL
  const markerPos = index * CELL + Math.floor(CELL / 2)
  const trackLeft = '─'.repeat(markerPos)
  const trackRight = '─'.repeat(Math.max(0, trackWidth - markerPos - 1))

  return (
    <Dialog
      title="Effort"
      onCancel={onCancel}
      isCancelActive={false}
      hideInputGuide
    >
      <Box flexDirection="column" alignItems="center" width="100%">
        <Box width={trackWidth} justifyContent="space-between">
          <Text dimColor>Faster</Text>
          <Text dimColor>Smarter</Text>
        </Box>
        <Box>
          <Text dimColor>{trackLeft}</Text>
          <Text bold color="claude">
            ▲
          </Text>
          <Text dimColor>{trackRight}</Text>
        </Box>
        <Box>
          {levels.map((level, i) => {
            const isSelected = i === index
            const label = capitalize(level)
            const pad = CELL - label.length
            const left = Math.floor(pad / 2)
            return (
              <Text key={level}>
                {' '.repeat(Math.max(0, left))}
                <Text
                  bold={isSelected}
                  color={isSelected ? 'claude' : undefined}
                  dimColor={!isSelected}
                >
                  {label}
                </Text>
                {' '.repeat(Math.max(0, pad - left))}
              </Text>
            )
          })}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>{getEffortLevelDescription(selected)}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor italic>
            <Byline>
              <KeyboardShortcutHint shortcut="←/→" action="adjust" />
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
              <KeyboardShortcutHint shortcut="Esc" action="cancel" />
            </Byline>
          </Text>
        </Box>
      </Box>
    </Dialog>
  )
}
