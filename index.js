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
    PermissionsBitField.Flags.ManageMessages,
    PermissionsBitField.Flags.ViewAuditLog // Added for admin logging
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

// Discord OAuth Callback Route (Handles GET redirect from Discord)
app.get('/callback', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// Discord OAuth Token Exchange Route (Frontend POSTs the code here)
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

// Start Express server FIRST
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Web server listening on port ${PORT}`);
});

// --- Start the Discord Bot (Imported from bot.js) ---
let botClient = null; // Will hold the Discord client instance
let botReadyPromise; // This promise will resolve when the bot is fully ready

// Use an async IIFE to start the Discord bot process
(async () => {
    try {
        const initializeAndGetClient = require('./bot'); // Import the default export
        botReadyPromise = initializeAndGetClient(); // Call the default exported function
        botClient = await botReadyPromise; // Await the bot's full readiness
        
        console.log("Discord bot initialization completed and ready for API use.");
    } catch (error) {
        console.error("Failed to start Discord bot from bot.js:", error);
        process.exit(1); // Exit if bot fails to start
    }
})();

// Middleware to check if botClient is ready for API calls
const checkBotReadiness = async (req, res, next) => {
    // If botClient is not yet assigned, wait for the botReadyPromise to resolve
    if (!botClient) {
        try {
            await botReadyPromise; // Wait for the bot to become ready
            // After awaiting, botClient should now be assigned.
            // Re-check if it's actually ready (isReady() and Firebase initialized)
            if (!botClient || !botClient.isReady() || !botClient.db || !botClient.appId) {
                console.warn('BotClient still not fully ready after awaiting botReadyPromise. Returning 503.');
                return res.status(503).json({ message: 'Bot backend is still starting up. Please try again in a moment.' });
            }
        } catch (error) {
            // If botReadyPromise rejected (bot failed to start)
            console.error('Bot failed to initialize. Returning 503.', error);
            return res.status(503).json({ message: 'Bot backend failed to start. Please check logs.' });
        }
    } else if (!botClient.isReady() || !botClient.db || !botClient.appId) {
        // If botClient is assigned but not fully ready (e.g., Firebase failed after ready event)
        console.warn('BotClient assigned but not fully ready. Returning 503.');
        return res.status(503).json({ message: 'Bot backend is still starting up. Please try again in a moment.' });
    }
    // If botClient is not null and isReady, proceed
    next();
};


// API route to get current Discord user info
app.get('/api/user', verifyDiscordToken, checkBotReadiness, (req, res) => {
    res.json(req.discordUser);
});

// API route to get guilds where the bot is present and the user has admin permissions
app.get('/api/guilds', verifyDiscordToken, checkBotReadiness, async (req, res) => {
    const MAX_RETRIES = 5;
    const RETRY_DELAY_MS = 2000; // 2 seconds

    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            const guildsResponse = await axios.get('https://discord.com/api/users/@me/guilds', {
                headers: { 'Authorization': `Bearer ${req.discordAccessToken}` }
            });
            const userGuilds = guildsResponse.data;

            const botGuilds = botClient.guilds.cache;
            
            // Check if bot's guild cache is populated. If not, wait and retry.
            if (botGuilds.size === 0 && i < MAX_RETRIES - 1) {
                console.warn(`Bot's guild cache is empty. Retrying guild fetch in ${RETRY_DELAY_MS / 1000} seconds... (Attempt ${i + 1}/${MAX_RETRIES})`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                continue; // Retry the loop
            }

            console.log("User's guilds:", userGuilds.map(g => g.name)); // Debugging
            console.log("Bot's guilds:", botGuilds.map(g => g.name)); // Debugging

            const manageableGuilds = userGuilds.filter(userGuild => {
                const hasAdminPerms = (BigInt(userGuild.permissions) & PermissionsBitField.Flags.Administrator) === PermissionsBitField.Flags.Administrator;
                const botInGuild = botGuilds.has(userGuild.id);
                
                // Debugging: Log why a guild is filtered out
                if (!botInGuild) {
                    console.log(`Filtering out guild ${userGuild.name}: Bot not in guild.`);
                } else if (!hasAdminPerms) {
                    console.log(`Filtering out guild ${userGuild.name}: User does not have admin permissions.`);
                }

                return botInGuild && hasAdminPerms;
            });

            console.log("Manageable guilds sent to frontend:", manageableGuilds.map(g => g.name)); // Debugging
            return res.json(manageableGuilds); // Success, send response and exit function

        } catch (error) {
            console.error('Error fetching user guilds:', error.response ? error.response.data : error.message);
            // If it's a 503 or network error, retry. Otherwise, rethrow or handle.
            if (error.response?.status === 503 && i < MAX_RETRIES - 1) {
                console.warn(`Bot backend not ready (503) during guild fetch. Retrying in ${RETRY_DELAY_MS / 1000} seconds... (Attempt ${i + 1}/${MAX_RETRIES})`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                continue; // Retry the loop
            }
            // If it's another error or retries exhausted, send error response
            return res.status(error.response?.status || 500).json({ message: 'Internal server error fetching guilds.' });
        }
    }
    // Fallback if loop finishes without success (e.g., max retries reached)
    return res.status(500).json({ message: 'Failed to fetch guilds after multiple retries. Bot may not be fully ready.' });
});

// API route to get a specific guild's roles and channels, and bot's current config
app.get('/api/guild-config', verifyDiscordToken, checkBotReadiness, async (req, res) => {
    const guildId = req.query.guildId;
    if (!guildId) {
        return res.status(400).json({ message: 'Guild ID is required.' });
    }

    try {
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
app.post('/api/save-config', verifyDiscordToken, checkBotReadiness, async (req, res) => {
    const guildId = req.query.guildId;
    const newConfig = req.body;

    if (!guildId || !newConfig) {
        return res.status(400).json({ message: 'Guild ID and config data are required.' });
    }

    try {
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
        if (newConfig.memberLogChannelId) validConfig.memberLogChannelId = newConfig.memberLogChannelId;
        if (newConfig.adminLogChannelId) validConfig.adminLogChannelId = newConfig.adminLogChannelId;
        if (newConfig.joinLeaveLogChannelId) validConfig.joinLeaveLogChannelId = newConfig.joinLeaveLogChannelId;
        if (newConfig.boostLogChannelId) validConfig.boostLogChannelId = newConfig.boostLogChannelId;
        if (newConfig.countingChannelId) validConfig.countingChannelId = newConfig.countingChannelId;

        await botClient.saveGuildConfig(guildId, validConfig);
        res.json({ message: 'Configuration saved successfully!' });

    } catch (error) {
        console.error(`Error saving config for guild ${guildId}:`, error.response ? error.response.data : error.message);
        res.status(error.response?.status || 500).json({ message: 'Internal server error saving config.' });
    }
});
