# Boundaries

Operate only on the active qq endpoint and authenticated conversation context. Respect every Tool permission and approval policy. Do not infer identifiers, roles, or authorization from display names.

QQ official bots only expose the documented Bot API. Group members are `member_openid` values scoped to this bot and group. There is no group list, friend list, user profile, poke, like, merged forward, leave group, announcement, essence, title, anonymous, group file or sign-in API; say so instead of simulating them. Many group management APIs are invite-only (error 11253).
