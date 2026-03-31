// @ts-nocheck
import { MessageCommand } from 'zhin.js'

const PROFILE_MODEL = 'plugin_profiles'

interface ProfileRow {
  id?: number
  user_id: string
  nickname: string
  points: number
  metadata?: unknown
}

interface ProfileModel {
  select(where?: Partial<ProfileRow>): Promise<ProfileRow[]>
  create(row: Partial<ProfileRow>): Promise<unknown>
}

interface DatabaseLike {
  models: Map<string, ProfileModel>
}

interface PluginLike {
  addCommand(command: MessageCommand): unknown
}

interface MessageLike {
  $sender: {
    id: string
  }
}

export async function registerDatabaseFeatures(plugin: PluginLike, database: DatabaseLike) {
  const profiles = database.models.get(PROFILE_MODEL)
  if (!profiles) {
    return
  }

  plugin.addCommand(
    new MessageCommand('profile')
      .description('Show current user profile')
      .action(async (message: MessageLike) => {
        const [profile] = await profiles.select({ user_id: message.$sender.id })
        if (!profile) {
          return 'profile not found'
        }
        return `${profile.nickname}: ${profile.points}`
      }),
  )

  plugin.addCommand(
    new MessageCommand('profile.init [nickname:text]')
      .description('Initialize current user profile')
      .action(async (message: MessageLike, result: { params: { nickname?: string } }) => {
        await profiles.create({
          user_id: message.$sender.id,
          nickname: result.params.nickname || 'new-user',
          points: 0,
          metadata: {},
        })
        return 'profile initialized'
      }),
  )

  return () => {
    // Dispose timers, listeners, or subscriptions created during database setup.
  }
}

export { PROFILE_MODEL }