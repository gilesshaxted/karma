// index.js - Main entry point for the combined web server and Discord bot
require('dotenv').config();
const express = require('express');
const axios = require('axios'); // For OAuth calls
const { PermissionsBitField } = require('discord.js'); // For bot permissions in OAuth URL

// --- Express Web Server Setup ---
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json()); // For parsing application/json
app.use(express.static('public')); // Serve static files from the 'public' directory

// Discord OAuth Configuration (for web dashboard)
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;
const DISCORD_OAUTH_SCOPES = 'identify guilds'; // Scopes for user identification and guild list
const DISCORD_BOT_PERMISSIONS = new PermissionsBitField([ // Bot permissions for the invite link
    PermissionsBitField.Flags.ManageChannels,
    PermissionsBitField.Flags.ManageRoles,
    PermissionsBitField.Flags.KickMembers,
    PermissionsBitField.Flags.BanMembers,
    PermissionsBitField.Flags.ModerateMembers,
    PermissionsBitField.Flags.ReadMessageHistory,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.ManageMessages
]).bitfield.toString(); // Get the BigInt bitfield and convert to string

// Basic health check endpoint (serves dashboard HTML)
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// Discord OAuth Login Route
app.get('/api/login', (req, res) => {
    const authorizeUrl = `https://discord.com/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(DISCORD_OAUTH_SCOPES)}&permissions=${DISCORD_BOT_PERMISSIONS}`;
    res.redirect(authorizeUrl);
});

// Discord OAuth Callback Route
app.post('/api/token', async (req, res) => {
    const { code } = req.body;
    if (!code) {
        return res.status(400).json({ message: 'No code provided.' });
    }

    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: DISCORD_CLIENT_ID,
            client_secret: DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: DISCORD_REDIRECT_URI,
            scope: DISCORD_OAUTH_SCOPES,
        }), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        res.json(tokenResponse.data);
    } catch (error) {
        console.error('Error exchanging Discord OAuth code:', error.response ? error.response.data : error.message);
        res.status(error.response?.status || 500).json({ message: error.response?.data?.error_description || 'Internal server error during OAuth.' });
    }
});

// Middleware to verify Discord access token for API routes
const verifyDiscordToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Authorization token required.' });
    }
    const accessToken = authHeader.split(' ')[1];

    try {
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        req.discordUser = userResponse.data;
        req.discordAccessToken = accessToken;
        next();
    } catch (error) {
        console.error('Error verifying Discord token:', error.response ? error.response.data : error.message);
        res.status(error.response?.status || 500).json({ message: 'Invalid or expired access token.' });
    }
};

// API route to get current Discord user info
app.get('/api/user', verifyDiscordToken, (req, res) => {
    res.json(req.discordUser);
});

// API route to get guilds where the bot is present and the user has admin permissions
app.get('/api/guilds', verifyDiscordToken, async (req, res) => {
    try {
        // This route depends on the Discord client being ready to access client.guilds.cache
        // botClient is now imported from bot.js
        if (!botClient || !botClient.guilds || botClient.guilds.cache.size === 0) {
             return res.status(503).json({ message: 'Bot not fully initialized. Please try again in a moment.' });
        }

        const guildsResponse = await axios.get('https://discord.com/api/users/@me/guilds', {
            headers: { 'Authorization': `Bearer ${req.discordAccessToken}` }
        });
        const userGuilds = guildsResponse.data;

        const botGuilds = botClient.guilds.cache;

        const manageableGuilds = userGuilds.filter(userGuild => {
            const hasAdminPerms = (BigInt(userGuild.permissions) & PermissionsBitField.Flags.Administrator) === PermissionsBitField.Flags.Administrator;
            return botGuilds.has(userGuild.id) && hasAdminPerms;
        });

        res.json(manageableGuilds);
    } catch (error) {
        console.error('Error fetching user guilds:', error.response ? error.response.data : error.message);
        res.status(error.response?.status || 500).json({ message: 'Internal server error fetching guilds.' });
    }
});

// API route to get a specific guild's roles and channels, and bot's current config
app.get('/api/guild-config', verifyDiscordToken, async (req, res) => {
    const guildId = req.query.guildId;
    if (!guildId) {
        return res.status(400).json({ message: 'Guild ID is required.' });
    }

    try {
        if (!botClient || !botClient.db || !botClient.appId) {
            return res.status(503).json({ message: 'Bot backend not fully initialized. Please try again in a moment.' });
        }

        const guild = botClient.guilds.cache.get(guildId);
        if (!guild) {
            return res.status(404).json({ message: 'Bot is not in this guild or guild not found.' });
        }

        const member = await guild.members.fetch(req.discordUser.id).catch(() => null);
        if (!member || !member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return res.status(403).json({ message: 'You do not have administrator permissions in this guild.' });
        }

        const roles = guild.roles.cache.map(role => ({ id: role.id, name: role.name }));
        const channels = guild.channels.cache
            .filter(channel => channel.isTextBased())
            .map(channel => ({ id: channel.id, name: channel.name, type: channel.type }));

        // Get current bot config from Firestore using botClient's getGuildConfig
        const currentConfig = await botClient.getGuildConfig(guildId);

        res.json({
            guildData: {
                id: guild.id,
                name: guild.name,
                roles: roles,
                channels: channels
            },
            currentConfig: currentConfig
        });

    } catch (error) {
        console.error(`Error fetching config for guild ${guildId}:`, error.response ? error.response.data : error.message);
        res.status(error.response?.status || 500).json({ message: 'Internal server error fetching guild config.' });
    }
});

// API route to save guild configuration
app.post('/api/save-config', verifyDiscordToken, async (req, res) => {
    const guildId = req.query.guildId;
    const newConfig = req.body;

    if (!guildId || !newConfig) {
        return res.status(400).json({ message: 'Guild ID and config data are required.' });
    }

    try {
        if (!botClient || !botClient.db || !botClient.appId) {
            return res.status(503).json({ message: 'Bot backend not fully initialized. Please try again in a moment.' });
        }

        const guild = botClient.guilds.cache.get(guildId);
        if (!guild) {
            return res.status(404).json({ message: 'Bot is not in this guild or guild not found.' });
        }

        const member = await guild.members.fetch(req.discordUser.id).catch(() => null);
        if (!member || !member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return res.status(403).json({ message: 'You do not have administrator permissions in this guild to save settings.' });
        }

        const validConfig = {};
        if (newConfig.modRoleId) validConfig.modRoleId = newConfig.modRoleId;
        if (newConfig.adminRoleId) validConfig.adminRoleId = newConfig.adminRoleId;
        if (newConfig.moderationLogChannelId) validConfig.moderationLogChannelId = newConfig.moderationLogChannelId;
        if (newConfig.messageLogChannelId) validConfig.messageLogChannelId = newConfig.messageLogChannelId;
        if (newConfig.modAlertChannelId) validConfig.modAlertChannelId = newConfig.modAlertChannelId;
        if (newConfig.modPingRoleId) validConfig.modPingRoleId = newConfig.modPingRoleId;

        // Save config using botClient's saveGuildConfig
        await botClient.saveGuildConfig(guildId, validConfig);
        res.json({ message: 'Configuration saved successfully!' });

    } catch (error) {
        console.error(`Error saving config for guild ${guildId}:`, error.response ? error.response.data : error.message);
        res.status(error.response?.status || 500).json({ message: 'Internal server error saving config.' });
    }
});


// Start Express server FIRST
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Web server listening on port ${PORT}`);
});

// --- Start the Discord Bot (Imported from bot.js) ---
let botClient; // Declare botClient here so it's accessible in API routes

// Use an async IIFE to start the the Discord bot process
(async () => {
    try {
        // Dynamically import bot.js to get the client instance and start it
        const botModule = require('./bot');
        botClient = botModule.client; // Assign the client instance from bot.js
        botClient.getGuildConfig = botModule.getGuildConfig; // Attach getGuildConfig for API routes
        botClient.saveGuildConfig = botModule.saveGuildConfig; // Attach saveGuildConfig for API routes
        
        // The botModule already calls client.login() internally
        console.log("Discord bot initialization initiated from bot.js");
    } catch (error) {
        console.error("Failed to start Discord bot from bot.js:", error);
        process.exit(1); // Exit if bot fails to start
    }
})();
