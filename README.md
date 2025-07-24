# Karma - A Discord Moderation Bot

## Author

BallisticEel

## Description

Karma is a powerful and intuitive Discord moderation bot designed to help server administrators and moderators maintain a safe and respectful community. With a suite of slash commands and an innovative emoji-based moderation system, Karma streamlines the process of managing user behavior, ensuring a positive environment for everyone.

### Key Features:

* **Slash Commands**:
    * `/warn <user> <reason>`: Issues a warning to a user.
    * `/timeout <duration> <user> <reason>`: Puts a user in timeout for a specified duration (default: 1 hour).
    * `/kick <user> <reason>`: Removes a user from the server.
    * `/ban` <duration_or_forever> <user>` <reason>`: Permanently or temporarily bans a user from the server.
    * `/clearwarnings <user>`: Clears all warnings for a specific user.
    * `/clearwarning <case_number> [user]`: Clears a specific warning by its case number.
* **Emoji-Based Moderation**:
    * React to a message with ⚠️ (warning emoji) to warn the author and delete the message.
    * React to a message with ⏰ (alarm clock emoji) to timeout the author for 1 hour and delete the message.
    * React to a message with 👢 (boot emoji) to kick the author and delete the message.
    * React to a message with 🔗 (link emoji) to manually flag a message for moderator review (sends to mod-alert channel).
* **Auto-Moderation**:
    * Automatically detects and flags messages containing hate speech, racial slurs, homophobia, and other severely offensive language using LLM analysis and specific keywords. (Regex patterns were removed due to persistent parsing errors in Node.js v22).
    * **Immediate Punishment**: For the worst offenses, the bot will automatically apply a short timeout (default: 10 minutes) to the author and delete the offensive message.
    * **Moderator Alerts**: If the bot detects potentially problematic content but isn't entirely "sure," it will repost the message content, author, and a link to the original message in a designated `mod-alert` channel. This alert will also ping a configurable generic moderator role.
* **Automated Logging**: All moderation actions are logged to a designated moderation log channel with detailed embeds, including case numbers. Deleted messages (especially those from kicks/bans) are logged to a separate message log channel with a clear embed format.
* **Configurable Roles & Channels**: Use the `/setup` command to easily configure moderator roles, admin roles, and logging channels directly within Discord, including the new `mod-alert` channel and moderator ping role.
* **Message Deletion on Kick/Ban**: When a user is kicked or banned, their messages from the last 24 hours are automatically deleted and logged, helping to clean up disruptive content.
* **Firestore Integration**: All bot configurations (moderator/admin roles, logging channels, case numbers) are persistently stored in Google Firestore, ensuring data is saved across restarts and accessible from any host.
* **LLM-Powered Sentiment Analysis**: The bot uses a Large Language Model (LLM) to analyze the sentiment of replies. Negative replies will prevent karma gain for the replied-to user.

Karma is designed to be efficient, user-friendly, and highly effective in maintaining a healthy Discord server. It's the ultimate tool for a harmonious community!

## Setup Instructions

1.  **Node.js**: Ensure you have Node.js installed (v16.x or higher recommended).
2.  **Discord Bot Token & Application ID**:
    * Go to the [Discord Developer Portal](https://discord.com/developers/applications).
    * Create a new application.
    * Navigate to "Bot" on the left sidebar.
    * Click "Add Bot" and then "Yes, do it!".
    * Under "Privileged Gateway Intents", enable `PRESENCE INTENT`, `SERVER MEMBERS INTENT`, and `MESSAGE CONTENT INTENT`.
    * Copy your bot's token. **Keep this token secret!**
    * Copy your Application ID (found under "General Information").
3.  **Firebase Project**:
    * Set up a Google Cloud project and enable Firestore.
    * Ensure your Firestore security rules allow authenticated users to read and write to `/artifacts/{appId}/public/data/guilds/{guildId}/configs/settings` and `/artifacts/{appId}/public/data/guilds/{guildId}/moderation_records/{recordId}`.
4.  **Google Cloud Project for Gemini API**:
    * Enable the "Generative Language API" in your Google Cloud Project.
    * Create an **API Key** for this project.
5.  **Environment Variables**: When deploying, ensure the following environment variables are set:
    * `DISCORD_BOT_TOKEN`: Your Discord bot's token.
    * `DISCORD_APPLICATION_ID`: Your Discord bot's Application ID.
    * `GOOGLE_API_KEY`: The API key for accessing the Gemini Generative Language API.
    * `FIREBASE_API_KEY`: Your Firebase project's API Key.
    * `FIREBASE_AUTH_DOMAIN`: Your Firebase project's Auth Domain.
    * `FIREBASE_PROJECT_ID`: Your Firebase project's Project ID.
    * `FIREBASE_STORAGE_BUCKET`: Your Firebase project's Storage Bucket.
    * `FIREBASE_MESSAGING_SENDER_ID`: Your Firebase project's Messaging Sender ID.
    * `FIREBASE_APP_ID`: Your Firebase project's App ID.
    * `__app_id`: (Provided by Canvas/Render environment) The application ID for Firestore.
    * `__firebase_config`: (Provided by Canvas/Render environment) Your Firebase project configuration in JSON format (though individual variables are now used for more clarity).
    * `__initial_auth_token`: (Provided by Canvas/Render environment) A Firebase custom authentication token.
6.  **Install Dependencies**: Open your terminal in the bot's root directory and run:
    ```bash
    npm install discord.js dotenv firebase express
    ```
7.  **Run the Bot**:
    ```bash
    node index.js
    ```
8.  **Invite the Bot to Your Server**:
    * In the Discord Developer Portal, go to "OAuth2" -> "URL Generator".
    * Select `bot` and `applications.commands` scopes.
    * Under "Bot Permissions", grant the following permissions:
        * `Manage Channels`
        * `Manage Roles`
        * `Kick Members`
        * `Ban Members`
        * `Timeout Members`
        * `Read Message History`
        * `Send Messages`
        * `Manage Messages`
    * Copy the generated URL and paste it into your browser to invite the bot to your server.
9.  **Configure with `/setup`**: Once the bot is in your server, use the `/setup` command to configure moderator/admin roles and logging channels, including the new `mod-alert` channel and moderator ping role. This is crucial for the bot's functionality.

Enjoy using Karma to moderate your Discord server!
