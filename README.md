# OpenClaw N8n Facebook Poster

A Zalo bot plugin for OpenClaw that collects posts and images from Zalo messages and sends them to an n8n webhook for publishing to Facebook and Threads.

## Features

- **Interactive Drafting:** Start a draft via slash command, send messages/images, and send them all at once.
- **Image Handling:** Automatically downloads Zalo CDN images and re-uploads them to Telegraph to bypass authentication/hotlinking issues, providing public URLs to n8n.
- **Agent Integration:** Provides the `create_facebook_post` tool for LLMs to construct posts automatically.
- **Local Persistence:** Saves post contents locally before sending to ensure no data loss.

## Installation

Install via ClawHub:
```bash
openclaw plugins install clawhub:openclaw-n8n-facebook-poster
```

## Configuration

In your `openclaw.json`, enable the plugin:

```json
{
  "plugins": {
    "entries": {
      "openclaw-n8n-facebook-poster": {
        "enabled": true
      }
    }
  }
}
```

Note: The first person to use a slash command will automatically be registered as an admin if the admin list is empty.

## Slash Commands

- `/post-start [channel]` - Start a new draft.
- `/post-cancel` - Cancel the current draft.
- `/post-send` - Send the drafted content and images to n8n.
- `/post-status` - Check current draft status.
- `/post-list` - View the history of recently saved posts.
- `/set-webhook <url>` - Set the n8n webhook URL.

## n8n Webhook Payload

The webhook payload sent to n8n is structured as follows:

```json
{
  "content": "Line 1\n\nLine 2",
  "channels": "Fb",
  "files": "https://telegra.ph/...,https://telegra.ph/..."
}
```
