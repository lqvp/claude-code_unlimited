import type { Command } from '../../commands.js'

const command = {
  name: 'thinking',
  description: 'Toggle extended thinking on/off',
  supportsNonInteractive: false,
  type: 'local',
  load: () => import('./thinking.js'),
} satisfies Command

export default command
