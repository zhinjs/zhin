# tencent-channel-community

<p align="center">
  <img src="https://grouppro.gtimg.cn/wupload/xy/qq_channel/common_pic/kRjatyOL.png" alt="tencent-channel-community" width="120">
</p>

<p align="center">
  <strong>🏠 All-in-one Tencent Channel Community Management Skill</strong>
</p>

<p align="center">
  <a href="./README.md">简体中文</a> | English
</p>
<p align="center">
  <img src="https://img.shields.io/badge/version-1.1.4-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg" alt="Platform">
  <img src="https://img.shields.io/badge/license-MIT-yellow.svg" alt="License">
</p>

---

## 📖 Introduction

**tencent-channel-community** is a full-featured Tencent Channel community management skill that covers channel creation and administration, member operations, post publishing, content moderation, and more, enabling AI assistants to manage Tencent Channel communities efficiently.

All operations are invoked via `tencent-channel-cli <domain> <action>`, supporting two parameter modes:

- **stdin JSON**: `echo '{"guild_id":"123"}' | tencent-channel-cli manage get-guild-info`
- **CLI flag**: `tencent-channel-cli manage get-guild-info --guild-id 123`

🔗 **Official Website**: [https://connect.qq.com/ai](https://connect.qq.com/ai)

---

## ✨ Features

### 📌 Channel Management

- **Create Channels** - Create public or private themed channels with preview support
- **Channel Settings** - View or update channel profile, avatar, name, and description
- **Sub-channel Management** - Create, modify, and delete sub-channels
- **Member Management** - View joined channels, channel members, and sub-channel lists, with member search by nickname
- **Search** - Search channels, posts, and authors, with cross-channel global search and in-channel search
- **Sharing** - Get channel and post share links, parse share links
- **Guild Number** - Change the public guild number (10–14 alphanumerics, owner permission required)
- **Admin Actions** - Join channels (with multiple verification modes), leave channels, send channel DMs, manage join settings, mute/remove members, set/remove admins (admin permission required)

### 📰 Content Management (Posts)

- **Browse Posts** - Browse channel homepage posts or posts in a specific sub-channel with pagination support
- **Post Details** - View post details, comments, and replies, with standalone post share-link retrieval
- **Publishing & Editing** - Create, edit, delete, and move posts (text, image, and video)
- **Inline Syntax** - Clickable links via `[text](url)` and mentions via `@[name](tinyid)` in post body, comments, and replies
- **Topic Tags** - `#topic` tags supported on short posts only; long posts are not supported
- **Interactions** - Comment, reply, like, set essence, and pin posts
- **Operations Tools** - Content inspection and Q&A auto-reply tools

### 🔔 Notifications

- **Two-step Setup** - First tests the push channel; only activates after the user confirms receipt. **OpenClaw platform only**
- **Multi-channel Subscriptions** - Open subscriptions from different channels (e.g. QQBot, Feishu); each channel routes independently
- **Three Categories** - Interaction (pins / likes / comments / replies / mentions), system messages (join requests, etc.), and direct messages
- **Quick Actions** - When notifications appear in context, say "reply", "comment", "approve", "refuse", or "reply DM" to act in one step
- **Token Safety** - Switching tokens automatically stops the daemon and clears local subscription state

---

## 🚀 Quick Start

### Requirements

- **Node.js** (required by tencent-channel-cli)
- **Token**: Obtain it from [https://connect.qq.com/ai](https://connect.qq.com/ai)

### Installation

Get the one-click installation command from [https://connect.qq.com/ai](https://connect.qq.com/ai)

### Environment Verification

```bash
tencent-channel-cli version            # Check installation
tencent-channel-cli token verify       # Verify login status
tencent-channel-cli doctor             # Run connectivity self-check
```

### Windows / PowerShell

- Prefer CLI flags for simple parameters; use `ConvertTo-Json` for complex objects or arrays
- If `.ps1` execution is restricted, prefer `tencent-channel-cli.cmd`
- Avoid copying bash-style `echo '{...}' | ...` examples directly into PowerShell

---

## 📚 Usage Examples

### Create a Channel
![Create a Channel](https://qqchannel-profile-1251316161.file.myqcloud.com/qq-ai-connect/example/%E5%88%9B%E5%BB%BA%E9%A2%91%E9%81%93.png)

### Get Joined Channels
![Get Joined Channels](https://qqchannel-profile-1251316161.file.myqcloud.com/qq-ai-connect/example/%E8%8E%B7%E5%8F%96%E6%88%91%E5%8A%A0%E5%85%A5%E7%9A%84%E9%A2%91%E9%81%93.png)

### Query Channel Profile
![Query Channel Profile](https://qqchannel-profile-1251316161.file.myqcloud.com/qq-ai-connect/example/%E6%9F%A5%E8%AF%A2%E9%A2%91%E9%81%93%E8%B5%84%E6%96%99.png)

### Member Management
![Member Management](https://qqchannel-profile-1251316161.file.myqcloud.com/qq-ai-connect/example/%E6%88%90%E5%91%98%E7%AE%A1%E7%90%86.png)

### Get the Latest 5 Posts
![Get the Latest 5 Posts](https://qqchannel-profile-1251316161.file.myqcloud.com/qq-ai-connect/example/%E8%8E%B7%E5%8F%96%E6%9C%80%E6%96%B0%E7%9A%845%E6%9D%A1%E5%B8%96%E5%AD%90.png)

### Query and Summarize Posts
![Query and Summarize Posts](https://qqchannel-profile-1251316161.file.myqcloud.com/qq-ai-connect/example/%E6%9F%A5%E8%AF%A2%E5%B8%96%E5%AD%90%E5%B9%B6%E6%80%BB%E7%BB%93.png)

### Publish an Image Post
![Publish an Image Post](https://qqchannel-profile-1251316161.file.myqcloud.com/qq-ai-connect/example/%E5%8F%91%E8%A1%A8%E5%B8%A6%E5%9B%BE%E5%B8%96%E5%AD%90.png)

### Like and Comment
![Like and Comment](https://qqchannel-profile-1251316161.file.myqcloud.com/qq-ai-connect/example/%E7%82%B9%E8%B5%9E%E5%B9%B6%E8%AF%84%E8%AE%BA.png)

---

## 🔧 Available Tools

### Channel Management Tools

| Tool | Description |
|------|-------------|
| `verify` | Verify the token and CLI connectivity |
| `get-my-join-guild-info` | Get the list of channels joined by the current account |
| `get-guild-info` | Get channel profile information |
| `get-guild-member-list` | Get the channel member list with pagination support |
| `guild-member-search` | Search channel members by nickname |
| `get-guild-channel-list` | Get the list of sub-channels |
| `get-user-info` | Get member profile information |
| `search-guild-content` | Search channels, posts, authors, or all content (cross-channel global search) |
| `get-guild-share-url` | Get the channel share link |
| `get-share-info` | Parse share links (pd.qq.com domain) |
| `get-join-guild-setting` | View channel join settings and verification mode |
| `update-join-guild-setting` | Update channel join settings |
| `preview-theme-private-guild` | Preview channel creation without actually creating it |
| `create-theme-private-guild` | Create a public or private themed channel |
| `join-guild` | Join a channel (with automatic verification pre-check) |
| `leave-guild` | Leave a channel |
| `modify-member-shut-up` | Mute or unmute a member |
| `kick-guild-member` | Remove a member from the channel |
| `upload-guild-avatar` | Update the channel avatar |
| `update-guild-info` | Update the channel name and description |
| `modify-guild-number` | Change the public guild number (10–14 alphanumerics, owner only) |
| `create-channel` | Create a sub-channel |
| `modify-channel` | Modify a sub-channel |
| `delete-channel` | Delete a sub-channel (irreversible) |
| `add-admin` | Set admin roles (supports batch) |
| `remove-admin` | Remove admin roles (supports batch) |
| `push-group-dm-msg` | Send a channel DM to a specified user (supports `--ref` to reply a DM notification) |

### Content Management Tools

| Tool | Description |
|------|-------------|
| `get-guild-feeds` | Get channel homepage posts (hot / latest) |
| `get-channel-timeline-feeds` | Get posts from a specified sub-channel |
| `get-feed-detail` | Get post details |
| `get-feed-comments` | Get post comments |
| `get-next-page-replies` | Get the next page of replies |
| `get-feed-share-url` | Get the share short link for a specified post |
| `search-guild-feeds` | Search posts by keyword within a channel |
| `get-notices` | Get interaction notifications (pins / likes / comments / replies / mentions) |
| `publish-feed` | Publish a new post (text, image, or video; supports inline links & mentions) |
| `alter-feed` | Edit a post |
| `del-feed` | Delete a post |
| `move-feed` | Move a post to another sub-channel |
| `do-comment` | Add or delete a comment (supports `--ref` to auto-fill from a notification) |
| `do-reply` | Add or delete a reply (supports `--ref` to auto-fill from a notification) |
| `do-like` | Like or unlike a comment or reply |
| `do-feed-prefer` | Like or unlike a post |
| `set-feed-essence` | Set or unset a post as essence |
| `top-feed` | Pin or unpin a post |
| `push-essence-feed` | Push essence post notification |
| `upload-image` | Upload media files (automatically used by `publish-feed`) |

### Notification Tools

| Tool | Description |
|------|-------------|
| `notices-on` | Enable channel notifications (two-step: test push first, then `--confirm` to activate; OpenClaw only) |
| `notices-off` | Disable notifications (with `--session-key` removes only that channel; without it clears all) |
| `notices-status` | Check subscription status, push mode, and daemon state |
| `check-notices` | Manually pull incremental notifications against the local watermark |
| `get-recent-notices` | Read recent notifications locally, used for matching quoted replies |
| `deal-notice` | Handle system notifications (e.g. `agree` / `refuse` for join requests) |

---

## ⚡ Shortcut Commands

Shortcut commands combine multi-step operations into a single call for improved efficiency.

| Intent | Command |
|--------|---------|
| Search and join a channel | `tencent-channel-cli manage search-and-join --keyword "<keyword>" --json` |
| Quick publish a post | `tencent-channel-cli feed quick-publish --content "<content>" --json` |
| Search posts and comment | `tencent-channel-cli feed search-and-comment --guild-id <ID> --query "<keyword>" --content "<comment>" --json` |
| Delete post and mute author | `tencent-channel-cli feed delete-and-mute --guild-id <ID> --query "<keyword>" --json` |
| Get latest post details for summarization | `tencent-channel-cli feed latest-feeds-detail --json` |
| Get hot post details for summarization | `tencent-channel-cli feed hot-feeds-detail --json` |

Shortcut commands use a multi-turn interaction model: when `status: "waiting"` is returned, you must continue with the returned `resume_command`, filling in `--pick <INDEX>` or `--set key=value` as needed. Do not treat this state as a hang. All shortcut commands require the `--json` flag.

---

## ⚠️ Notes

### Permission Notes
All operations use the permissions of the user associated with the current token.

### High-Risk Operations
`del-feed`, `kick-guild-member`, `modify-member-shut-up`, `delete-channel`, `remove-admin`, and similar operations are irreversible or high-risk. They require the `--yes` flag for confirmation.

---

## 📁 Project Structure

```
tencent-channel-community/
├── SKILL.md                    # AI skill description (CLI invocation rules & routing)
├── _meta.json                  # Skill metadata
├── references/
│   ├── manage-guild.md         # Channel management reference
│   ├── manage-member.md        # Member management reference
│   ├── feed-reference.md       # Content management reference
│   └── notification-reference.md # Notification reference
├── README.md                   # Chinese README
└── README_EN.md                # English README
```

---

## 🤝 Feedback & Community

Join our Tencent Channel community for support and discussion:

🔗 **[Tencent AI Connect Developer Community](https://pd.qq.com/s/1sly18j1i?b=9)**

---

## 📄 License

License: MIT

---

## 👥 Author

**Tencent**

---

<p align="center">
  Made with ❤️ for Tencent Channel Community
</p>
