// plugins/services/github-notify/src/types.ts

export type EventType = 'push' | 'issue' | 'star' | 'fork' | 'unstar' | 'pull_request'

export interface Subscription {
  id: number
  repo: string // 格式: owner/repo
  events: EventType[]
  target_id: string // 用户ID或群ID
  target_type: 'private' | 'group'
  adapter: string
  bot: string
  created_at: Date
  updated_at: Date
}

export interface GitHubEvent {
  id: number
  repo: string
  event_type: EventType
  payload: any
  created_at: Date
}

export interface GitHubWebhookPayload {
  action?: string
  repository: {
    full_name: string
    html_url: string
    description?: string
  }
  sender: {
    login: string
    html_url: string
  }
  // Push event
  ref?: string
  commits?: Array<{
    id: string
    message: string
    author: {
      name: string
      username?: string
    }
    url: string
  }>
  // Issue event
  issue?: {
    number: number
    title: string
    html_url: string
    state: string
    user: {
      login: string
    }
  }
  // PR event
  pull_request?: {
    number: number
    title: string
    html_url: string
    state: string
    user: {
      login: string
    }
  }
  // Fork event
  forkee?: {
    full_name: string
    html_url: string
    owner: {
      login: string
    }
  }
}
