// index.js - Main entry point for the combined web server and Discord bot
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, 'karma_bot.env') }); // Load environment variables from karma_bot.env

const { Client, Collection, GatewayIntentBits, Partials, PermissionsBitField, MessageFlags } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const { initializeApp } = require('firebase/app');
const { getAuth, signInAnonymously, signInWithCustomToken } = require('firebase/auth');
const { getFirestore, doc, getDoc, setDoc, updateDoc, collection, addDoc, query, where, limit, getDocs } = require('firebase/firestore');
const express = require('express');
const axios = require('axios'); // For OAuth calls

// Create a new Discord client instance
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildPresences, // Required for userUpdate, guildMemberUpdate (presence changes)
        GatewayIntentBits.GuildModeration, // Required for audit log, guildScheduledEvent*
        GatewayIntentBits.GuildMessageTyping, // Often useful for bot interactions, though not strictly for logging
        GatewayIntentBits.GuildInvites // Required to read invites for join tracking
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember, Partials.User] // Added GuildMember, User for member/user updates
});

// Create a collection to store commands
client.commands = new Collection();
// Collection to store guild invites for tracking (stores Map<string, number> of code -> uses)
client.invites = new Collection();

// Firebase and Google API variables - will be initialized in client.once('ready')
client.db = null;
client.auth = null;
client.appId = null;
client.googleApiKey = null;
client.tenorApiKey = process.env.TENOR_API_KEY; // New environment variable for Tenor
client.userId = null; // Also store userId on client


// Import helper functions (relative to index.js)
const { hasPermission, isExempt } = require('./helpers/permissions');
const logging = require('./logging/logging'); // Core logging functions
const karmaSystem = require('./karma/karmaSystem'); // Karma system functions
const autoModeration = require('./automoderation/autoModeration'); // Auto-moderation functions
const handleMessageReactionAdd = require('./events/messageReactionAdd'); // Emoji reaction handler

// New logging handlers
const messageLogHandler = require('./logging/messageLogHandler');
const memberLogHandler = require('./logging/memberLogHandler');
const adminLogHandler = require('./logging/adminLogHandler');
const joinLeaveLogHandler = require('./logging/joinLeaveLogHandler');
const boostLogHandler = require('./logging/boostLogHandler');

// New game handlers
const countingGame = require('./games/countingGame');

// New event handlers
const spamGame = require('./events/spamFun'); // Updated from lemons to spamFun

// --- Discord OAuth Configuration (Bot's Permissions for Invite) ---
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;
const DISCORD_OAUTH_SCOPES = 'identify guilds'; // Scopes for user identification and guild list
const DISCORD_BOT_PERMISSIONS = new PermissionsBitField([
    PermissionsBitField.Flags.ManageChannels,
    PermissionsBitField.Flags.ManageRoles,
    PermissionsBitField.Flags.KickMembers,
    PermissionsBitField.Flags.BanMembers,
    PermissionsBitField.Flags.ModerateMembers,
    PermissionsBitField.Flags.ReadMessageHistory,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.ManageMessages,
    PermissionsBitField.Flags.ViewAuditLog, // Added for admin logging
    PermissionsBitField.Flags.ManageGuild // Added for invite tracking
]).bitfield.toString();

// Helper function to get guild-specific config from Firestore
// This function now explicitly takes 'clientInstance' as an argument
const getGuildConfig = async (clientInstance, guildId) => {
    const db = clientInstance.db;
    const appId = clientInstance.appId;

    if (!db || !appId) {
        console.error('Firestore not initialized yet when getGuildConfig was called.');
        return null;
    }
    const configRef = doc(db, `artifacts/${appId}/public/data/guilds/${guildId}/configs`, 'settings');
    const configSnap = await getDoc(configRef);

    if (configSnap.exists()) {
        const configData = configSnap.data();
        // Set default values for new moderation settings if they don't exist
        return {
            ...configData,
            moderationLevel: configData.moderationLevel || 'none',
            blacklistedWords: configData.blacklistedWords || '',
            whitelistedWords: configData.whitelistedWords || '',
            spamDetectionEnabled: configData.spamDetectionEnabled !== undefined ? configData.spamDetectionEnabled : false,
            maxMessages: configData.maxMessages !== undefined ? configData.maxMessages : 5,
            timeframeSeconds: configData.timeframeSeconds !== undefined ? configData.timeframeSeconds : 5,
            repeatedTextEnabled: configData.repeatedTextEnabled !== undefined ? configData.repeatedTextEnabled : false,
            externalLinksEnabled: configData.externalLinksEnabled !== undefined ? configData.externalLinksEnabled : false,
            discordInviteLinksEnabled: configData.discordInviteLinksEnabled !== undefined ? configData.discordInviteLinksEnabled : false,
            excessiveEmojiEnabled: configData.excessiveEmojiEnabled !== undefined ? configData.excessiveEmojiEnabled : false,
            excessiveEmojiCount: configData.excessiveEmojiCount !== undefined ? configData.excessiveEmojiCount : 5,
            excessiveMentionsEnabled: configData.excessiveMentionsEnabled !== undefined ? configData.excessiveMentionsEnabled : false,
            excessiveMentionsCount: configData.excessiveMentionsCount !== undefined ? configData.excessiveMentionsCount : 5,
            excessiveCapsEnabled: configData.excessiveCapsEnabled !== undefined ? configData.excessiveCapsEnabled : false,
            excessiveCapsPercentage: configData.excessiveCapsPercentage !== undefined ? configData.excessiveCapsPercentage : 70,
            immuneRoles: configData.immuneRoles || '',
            immuneChannels: configData.immuneChannels || ''
        };
    } else {
        const defaultConfig = {
            modRoleId: null,
            adminRoleId: null,
            moderationLogChannelId: null,
            messageLogChannelId: null,
            modAlertChannelId: null,
            modPingRoleId: null,
            memberLogChannelId: null, // New: Member log channel
            adminLogChannelId: null,   // New: Admin log channel
            joinLeaveLogChannelId: null, // New: Join/Leave log channel
            boostLogChannelId: null,   // New: Boost log channel
            karmaChannelId: null,      // New: Karma Channel
            countingChannelId: null,   // New: Counting game channel
            currentCount: 0,           // New: Counting game current count
            lastCountMessageId: null,  // New: Counting game last correct message ID
            spamChannelId: null,      // Spam channel ID
            spamKeywords: null,       // Spam keywords
            spamEmojis: null,         // Spam emojis
            caseNumber: 0,
            // NEW AUTO-MODERATION FIELDS
            moderationLevel: 'none', // high, medium, low
            blacklistedWords: '',
            whitelistedWords: '',
            spamDetectionEnabled: false,
            maxMessages: 5,
            timeframeSeconds: 5,
            repeatedTextEnabled: false,
            externalLinksEnabled: false,
            discordInviteLinksEnabled: false,
            excessiveEmojiEnabled: false,
            excessiveEmojiCount: 5,
            excessiveMentionsEnabled: false,
            excessiveMentionsCount: 5,
            excessiveCapsEnabled: false,
            excessiveCapsPercentage: 70,
            immuneRoles: '',
            immuneChannels: ''
        };
        await setDoc(configRef, defaultConfig);
        return defaultConfig;
    }
};

// Helper function to save guild-specific config to Firestore
// This function now explicitly takes 'clientInstance' as an argument
const saveGuildConfig = async (clientInstance, guildId, newConfig) => {
    const db = clientInstance.db;
    const appId = clientInstance.appId;

    if (!db || !appId) {
        console.error('Firestore not initialized yet when saveGuildConfig was called.');
        return;
    }
    const configRef = doc(db, `artifacts/${appId}/public/data/guilds/${guildId}/configs`, 'settings');
    await setDoc(configRef, newConfig, { merge: true });
};


// --- Dynamic Command Loading ---
const commandsPath = path.join(__dirname, 'commands');
const folders = fs.readdirSync(commandsPath);

for (const folder of folders) {
    const folderPath = path.join(commandsPath, folder);
    if (fs.lstatSync(folderPath).isDirectory()) {
        const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));
        for (const file of commandFiles) {
            const command = require(path.join(folderPath, file));
            if ('data' in command && 'execute' in command) {
                client.commands.set(command.data.name, command);
            } else {
                console.log(`[WARNING] The command at ${file} is missing a required "data" or "execute" property.`);
            }
        }
    }
}


// --- Express Web Server Setup ---
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json()); // For parsing application/json
app.use(express.static('public')); // Serve static files from the 'public' directory

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
        res.status(error.response?.status || 500).json({ message: 'Internal server error during OAuth.' });
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

// Middleware to check if botClient is ready for API calls
const checkBotReadiness = async (req, res, next) => {
    const MAX_READY_RETRIES = 10; // Max attempts to wait for bot readiness
    const READY_RETRY_DELAY_MS = 1000; // 1 second delay between retries

    for (let i = 0; i < MAX_READY_RETRIES; i++) {
        if (client.isReady() && client.db && client.appId && client.guilds.cache.size > 0) {
            // Bot is ready, Firebase initialized, and guilds cached
            return next();
        }
        console.warn(`Bot backend not fully initialized. Retrying in ${READY_RETRY_DELAY_MS / 1000}s... (Attempt ${i + 1}/${MAX_READY_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, READY_RETRY_DELAY_MS));
    }

    // If loop finishes, bot is still not ready
    console.error('Bot backend failed to initialize within expected time. Returning 503.');
    return res.status(503).json({ message: 'Bot backend failed to start or initialize fully. Please try again later.' });
};


// API route to get current Discord user info
app.get('/api/user', verifyDiscordToken, checkBotReadiness, (req, res) => {
    res.json(req.discordUser);
});

// API route to get guilds where the bot is present and the user has admin permissions
app.get('/api/guilds', verifyDiscordToken, checkBotReadiness, async (req, res) => {
    const MAX_GUILD_FETCH_RETRIES = 5; // Max retries for guild cache population
    const GUILD_FETCH_RETRY_DELAY_MS = 1000; // 1 second delay
    
    const RETRY_DELAY_MS = 1000;

    for (let i = 0; i < MAX_GUILD_FETCH_RETRIES; i++) {
        try {
            const guildsResponse = await axios.get('https://discord.com/api/users/@me/guilds', {
                headers: { 'Authorization': `Bearer ${req.discordAccessToken}` }
            });
            const userGuilds = guildsResponse.data;

            const botGuilds = client.guilds.cache;
            
            // If bot's guild cache is still empty, and we have retries left, wait and retry.
            if (botGuilds.size === 0 && i < MAX_GUILD_FETCH_RETRIES - 1) {
                console.warn(`Bot's guild cache is empty. Retrying guild fetch in ${GUILD_FETCH_RETRY_DELAY_MS / 1000} seconds... (Attempt ${i + 1}/${MAX_GUILD_FETCH_RETRIES})`);
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
            if (error.response?.status === 503 && i < MAX_GUILD_FETCH_RETRIES - 1) {
                console.warn(`Bot backend not ready (503) during guild fetch. Retrying in ${RETRY_DELAY_MS / 1000} seconds... (Attempt ${i + 1}/${MAX_GUILD_FETCH_RETRIES})`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                continue; // Retry the loop
            }
            // If it's another error or retries exhausted, send error response
            return res.status(error.response?.status || 500).json({ message: 'Internal server error fetching guilds.' });
        }
    }
    // Fallback if loop finishes without success (e.g., max retries reached)
    return res.status(500).json({ message: 'Failed to fetch guilds after multiple retries. Bot may not be fully ready or accessible.' });
});

// API route to get a specific guild's roles and channels, and bot's current config
app.get('/api/guild-config', verifyDiscordToken, checkBotReadiness, async (req, res) => {
    const guildId = req.query.guildId;
    if (!guildId) {
        return res.status(400).json({ message: 'Guild ID is required.' });
    }

    try {
        const guild = client.guilds.cache.get(guildId);
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
        
        // NEW: Fetch all custom emojis for the guild
        const emojis = guild.emojis.cache.map(emoji => ({
            id: emoji.id,
            name: emoji.name,
            url: emoji.url,
            animated: emoji.animated,
            identifier: `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`
        }));

        const currentConfig = await getGuildConfig(client, guildId); // Pass client to getGuildConfig

        res.json({
            guildData: {
                id: guild.id,
                name: guild.name,
                roles: roles,
                channels: channels,
                emojis: emojis // NEW: Include emojis in the response
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
        const guild = client.guilds.cache.get(guildId);
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
        if (newConfig.modPingRoleId) validConfig.modPingRoleId = newConfig.modPingRoleId;
        if (newConfig.karmaChannelId) validConfig.karmaChannelId = newConfig.karmaChannelId;
        if (newConfig.countingChannelId) validConfig.countingChannelId = newConfig.countingChannelId;
        if (newConfig.moderationLogChannelId) validConfig.moderationLogChannelId = newConfig.moderationLogChannelId;
        if (newConfig.messageLogChannelId) validConfig.messageLogChannelId = newConfig.messageLogChannelId;
        if (newConfig.memberLogChannelId) validConfig.memberLogChannelId = newConfig.memberLogChannelId;
        if (newConfig.adminLogChannelId) validConfig.adminLogChannelId = newConfig.adminLogChannelId;
        if (newConfig.joinLeaveLogChannelId) validConfig.joinLeaveLogChannelId = newConfig.joinLeaveLogChannelId;
        if (newConfig.boostLogChannelId) validConfig.boostLogChannelId = newConfig.boostLogChannelId;
        if (newConfig.modAlertChannelId) validConfig.modAlertChannelId = newConfig.modAlertChannelId;
        if (newConfig.spamChannelId) validConfig.spamChannelId = newConfig.spamChannelId; // NEW: Save spam channel ID
        if (newConfig.spamKeywords) validConfig.spamKeywords = newConfig.spamKeywords; // NEW: Save spam keywords
        if (newConfig.spamEmojis) validConfig.spamEmojis = newConfig.spamEmojis; // NEW: Save spam emojis
        // NEW AUTO-MODERATION FIELDS
        validConfig.moderationLevel = newConfig.moderationLevel; // Always save, even if null/empty
        validConfig.blacklistedWords = newConfig.blacklistedWords;
        validConfig.whitelistedWords = newConfig.whitelistedWords;
        validConfig.spamDetectionEnabled = newConfig.spamDetectionEnabled;
        validConfig.maxMessages = newConfig.maxMessages;
        validConfig.timeframeSeconds = newConfig.timeframeSeconds;
        validConfig.repeatedTextEnabled = newConfig.repeatedTextEnabled;
        validConfig.externalLinksEnabled = newConfig.externalLinksEnabled;
        validConfig.discordInviteLinksEnabled = newConfig.discordInviteLinksEnabled;
        validConfig.excessiveEmojiEnabled = newConfig.excessiveEmojiEnabled;
        validConfig.excessiveEmojiCount = newConfig.excessiveEmojiCount;
        validConfig.excessiveMentionsEnabled = newConfig.excessiveMentionsEnabled;
        validConfig.excessiveMentionsCount = newConfig.excessiveMentionsCount;
        validConfig.excessiveCapsEnabled = newConfig.excessiveCapsEnabled;
        validConfig.excessiveCapsPercentage = newConfig.excessiveCapsPercentage;
        validConfig.immuneRoles = newConfig.immuneRoles;
        validConfig.immuneChannels = newConfig.immuneChannels;

        await saveGuildConfig(client, guildId, validConfig); // Pass client to saveGuildConfig
        res.json({ message: 'Configuration saved successfully!' });

    } catch (error) {
        console.error(`Error saving config for guild ${guildId}:`, error.response ? error.response.data : error.message);
        res.status(error.response?.status || 500).json({ message: 'Internal server error saving config.' });
    }
});

// --- Discord Bot Client Setup ---
// Event: Bot is ready
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    // Initialize Firebase and Google API Key
    try {
        // Use FIREBASE_APP_ID environment variable for client.appId
        client.appId = process.env.FIREBASE_APP_ID;
        client.googleApiKey = process.env.GOOGLE_API_KEY || "";
        client.tenorApiKey = process.env.TENOR_API_KEY || "";

        const firebaseConfig = {
            apiKey: process.env.FIREBASE_API_KEY,
            authDomain: process.env.FIREBASE_AUTH_DOMAIN,
            projectId: process.env.FIREBASE_PROJECT_ID,
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
            messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
            appId: process.env.FIREBASE_APP_ID // Ensure this matches the App ID in Firebase Console
        };

        if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.appId || !firebaseConfig.authDomain) {
            console.error('Missing essential Firebase environment variables. Please check your .env or hosting configuration.');
            process.exit(1);
        }

        const firebaseApp = initializeApp(firebaseConfig);
        client.db = getFirestore(firebaseApp);
        client.auth = getAuth(firebaseApp);

        if (typeof __initial_auth_token !== 'undefined') {
            await signInWithCustomToken(client.auth, __initial_auth_token);
        } else {
            await signInAnonymously(client.auth);
        }
        client.userId = client.auth.currentUser?.uid || crypto.randomUUID();
        console.log(`Firebase initialized. User ID: ${client.userId}. App ID for Firestore: ${client.appId}`);

        // Attach getGuildConfig and saveGuildConfig to
