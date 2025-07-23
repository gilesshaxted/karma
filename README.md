# Karma

Karma - A Discord Moderation Bot
Author - BallisticEel

## Description

Karma is a powerful and intuitive Discord moderation bot designed to help server administrators and moderators maintain a safe and respectful community. With a suite of slash commands and an innovative emoji-based moderation system, Karma streamlines the process of managing user behavior, ensuring a positive environment for everyone.

# Key Features:

## Slash Commands:

* `/warn <user> <reason>`: Issues a warning to a user.

* `/timeout <duration> <user> <reason>`: Puts a user in timeout for a specified duration (default: 1 hour).

* `/kick <user> <reason>`: Removes a user from the server.

* `/ban <duration_or_forever> <user> <reason>`: Permanently or temporarily bans a user from the server.

* `/warnings <user>`: Lists a user's past warnings, paginated 10 at a time.

* `/warning <case_number>`: Shows detailed information for a specific warning by its case number.

## Emoji-Based Moderation:

* React to a message with ⚠️ (warning emoji) to warn the author and delete the message.

* React to a message with ⏰ (alarm clock emoji) to timeout the author for 1 hour and delete the message.

* React to a message with 👢 (boot emoji) to kick the author and delete the message.

Automated Logging: All moderation actions are logged to a designated moderation log channel with detailed embeds, including case numbers. Deleted messages (especially those from kicks/bans) are logged to a separate message log channel.

Configurable Roles & Channels: Use the `/setup` command to easily configure moderator roles, admin roles, and logging channels directly within Discord.

Message Deletion on Kick/Ban: When a user is kicked or banned, their messages from the last 24 hours are automatically deleted and logged, helping to clean up disruptive content.

Firestore Integration: All bot configurations and moderation records are persistently stored in Google Firestore, organized under each guild's unique ID.

Karma is designed to be efficient, user-friendly, and highly effective in maintaining a healthy Discord server. It's the ultimate tool for a harmonious community!

# Setup Instructions

## Node.js:

Ensure you have Node.js installed (v16.x or higher recommended).

## Discord Bot Token & Application ID:

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).

2. Create a new application.

3. Navigate to "Bot" on the left sidebar.

4. Click "Add Bot" and then "Yes, do it!".

5. Under "Privileged Gateway Intents", enable `PRESENCE INTENT`, `SERVER MEMBERS INTENT`, and `MESSAGE CONTENT INTENT`.

6. Copy your bot's token. **Keep this token secret!**

7. Copy your Application ID (found under "General Information").

## Firebase Project:

Set up a Google Cloud project and enable Firestore.
**Crucially, ensure your Firestore security rules allow authenticated users to read and write to the following paths:**

* `/artifacts/{appId}/public/data/guilds/{guildId}/configs/settings`

* `/artifacts/{appId}/public/data/guilds/{guildId}/moderation_records/{recordId}`

Example rules:
```
rules_version = '2';
service cloud.firestore {
match /databases/{database}/documents {
// Allow read/write for guild configurations
match /artifacts/{appId}/public/data/guilds/{guildId}/configs/settings {
allow read, write: if request.auth != null;
}
// Allow read/write for moderation records
match /artifacts/{appId}/public/data/guilds/{guildId}/moderation_records/{recordId} {
allow read, write: if request.auth != null;
}
// Default rule, usually more restrictive
match /{document=**} {
allow read, write: if false;
}
}
}
```
## Environment Variables:

When deploying, ensure the following environment variables are set:

* `DISCORD_BOT_TOKEN`: Your Discord bot's token.

* `DISCORD_APPLICATION_ID`: Your Discord bot's Application ID.

* `__app_id`: (Provided by Canvas/Render environment) The application ID for Firestore.

* `__initial_auth_token`: (Provided by Canvas/Render environment) A Firebase custom authentication token.

* `FIREBASE_API_KEY`: Your Firebase project's API Key.

* `FIREBASE_APP_ID`: Your Firebase project's App ID.

* `FIREBASE_AUTH_DOMAIN`: Your Firebase project's Auth Domain.

* `FIREBASE_MESSAGING_SENDER_ID`: Your Firebase project's Messaging Sender ID.

* `FIREBASE_PROJECT_ID`: Your Firebase project's Project ID.

* `FIREBASE_STORAGE_BUCKET`: Your Firebase project's Storage Bucket.

## Install Dependencies:

Open your terminal in the bot's root directory and run:

`npm install discord.js dotenv firebase express`

## Run the Bot:

`node index.js`

## Invite the Bot to Your Server:

1. In the Discord Developer Portal, go to "OAuth2" -> "URL Generator".

2. Select `bot` and `applications.commands` scopes.

3. Under "Bot Permissions", grant the following permissions:

   * Manage Channels

   * Manage Roles

   * Kick Members

   * Ban Members

   * Timeout Members

   * Read Message History

   * Send Messages

   * Manage Messages

4. Copy the generated URL and paste it into your browser to invite the bot to your server.

## Configure with /setup:

Once the bot is in your server, use the `/setup` command to configure moderator/admin roles and logging channels. This is crucial for the bot's functionality.

Enjoy using Karma to moderate your Discord server!
