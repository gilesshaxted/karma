# Karma
Karma - A Discord Moderation Bot<br/>
Author - BallisticEel
<br/><br/>
**Description**<br/>
Karma is a powerful and intuitive Discord moderation bot designed to help server administrators and moderators maintain a safe and respectful community. With a suite of slash commands and an innovative emoji-based moderation system, Karma streamlines the process of managing user behavior, ensuring a positive environment for everyone.

# Key Features:<br/>
## Slash Commands:<br/>

/warn <user> <reason>: Issues a warning to a user.<br/>
/timeout <duration> <user> <reason>: Puts a user in timeout for a specified duration (default: 1 hour).<br/>
/kick <user> <reason>: Removes a user from the server.<br/>
/ban <duration_or_forever> <user> <reason>: Permanently or temporarily bans a user from the server.<br/>
<br/>
## Emoji-Based Moderation:<br/>
<br/>
React to a message with ⚠️ (warning emoji) to warn the author and delete the message.<br/>
React to a message with ⏰ (alarm clock emoji) to timeout the author for 1 hour and delete the message.<br/>
React to a message with 👢 (boot emoji) to kick the author and delete the message.

Automated Logging: All moderation actions are logged to a designated moderation log channel with detailed embeds, including case numbers. Deleted messages (especially those from kicks/bans) are logged to a separate message log channel.

Configurable Roles & Channels: Use the /setup command to easily configure moderator roles, admin roles, and logging channels directly within Discord.

Message Deletion on Kick/Ban: When a user is kicked or banned, their messages from the last 24 hours are automatically deleted and logged, helping to clean up disruptive content.

Firestore Integration: All bot configurations (moderator/admin roles, logging channels, case numbers) are persistently stored in Google Firestore, ensuring data is saved across restarts and accessible from any host.

Karma is designed to be efficient, user-friendly, and highly effective in maintaining a healthy Discord server. It's the ultimate tool for a harmonious community!

Setup Instructions
Node.js: Ensure you have Node.js installed (v16.x or higher recommended).

Discord Bot Token & Application ID:

Go to the Discord Developer Portal.

Create a new application.

Navigate to "Bot" on the left sidebar.

Click "Add Bot" and then "Yes, do it!".

Under "Privileged Gateway Intents", enable PRESENCE INTENT, SERVER MEMBERS INTENT, and MESSAGE CONTENT INTENT.

Copy your bot's token. Keep this token secret!

Copy your Application ID (found under "General Information").

Firebase Project:

Set up a Google Cloud project and enable Firestore.

Ensure your Firestore security rules allow authenticated users to read and write to /artifacts/{appId}/public/data/karma_configs/{guildId}.

Environment Variables: When deploying, ensure the following environment variables are set:

DISCORD_BOT_TOKEN: Your Discord bot's token.

DISCORD_APPLICATION_ID: Your Discord bot's Application ID.

__app_id: (Provided by Canvas/Render environment) The application ID for Firestore.

__firebase_config: (Provided by Canvas/Render environment) Your Firebase project configuration in JSON format.

__initial_auth_token: (Provided by Canvas/Render environment) A Firebase custom authentication token.

Install Dependencies: Open your terminal in the bot's root directory and run:

npm install discord.js dotenv firebase

Run the Bot:

node index.js

Invite the Bot to Your Server:

In the Discord Developer Portal, go to "OAuth2" -> "URL Generator".

Select bot and applications.commands scopes.

Under "Bot Permissions", grant the following permissions:

Manage Channels

Manage Roles

Kick Members

Ban Members

Timeout Members

Read Message History

Send Messages

Manage Messages

Copy the generated URL and paste it into your browser to invite the bot to your server.

Configure with /setup: Once the bot is in your server, use the /setup command to configure moderator/admin roles and logging channels. This is crucial for the bot's functionality.

Enjoy using Karma to moderate your Discord server!
