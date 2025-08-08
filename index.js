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
const MAX_READY_RETRIES = 5; // Or whatever number of retries you want
const express = require('express');
const axios = require('axios'); // For OAuth calls
const cookieParser = require('cookie-parser'); // NEW: For handling cookies

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
const meowFun = require('./events/meow'); // NEW: Import meowFun handler

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
            immuneChannels: configData.immuneChannels || '',
            meowFunEnabled: configData.meowFunEnabled !== undefined ? configData.meowFunEnabled : false // NEW: Meow Fun setting
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
            adminLogChannelId: null,    // New: Admin log channel
            joinLeaveLogChannelId: null, // New: Join/Leave log channel
            boostLogChannelId: null,    // New: Boost log channel
            karmaChannelId: null,       // New: Karma Channel
            countingChannelId: null,    // New: Counting game channel
            currentCount: 0,            // New: Counting game current count
            lastCountMessageId: null,   // New: Counting game last correct message ID
            spamChannelId: null,       // Spam channel ID
            spamKeywords: null,         // Spam keywords
            spamEmojis: null,           // Spam emojis
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
            immuneChannels: '',
            meowFunEnabled: false // NEW: Default Meow Fun to false
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
app.use(cookieParser()); // NEW: Use cookie-parser middleware

// Basic health check endpoint (serves dashboard HTML)
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// Discord OAuth Login Route
app.get('/api/login', (req, res) => {
    const authorizeUrl = `https://discord.com/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(DISCORD_OAUTH_SCOPES)}`;
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

        // NEW: Extract access and refresh tokens from the response
        const { access_token, refresh_token, expires_in } = tokenResponse.data;

        // NEW: Set the refresh token in a secure, HTTP-only cookie
        res.cookie('refresh_token', refresh_token, {
            httpOnly: true, // Not accessible by client-side JavaScript
            secure: process.env.NODE_ENV === 'production', // Only send over HTTPS in production
            maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
            path: '/'
        });

        // Send back a reduced response to the client
        res.json({ access_token: access_token, expires_in: expires_in });
    } catch (error) {
        console.error('Error exchanging Discord OAuth code:', error.response ? error.response.data : error.message);
        res.status(error.response?.status || 500).json({ message: 'Internal server error during OAuth.' });
    }
});

// NEW: Endpoint to refresh the access token using the stored refresh token
app.post('/api/refresh', async (req, res) => {
    const { refresh_token } = req.cookies;
    if (!refresh_token) {
        return res.status(401).json({ message: 'No refresh token found.' });
    }

    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: DISCORD_CLIENT_ID,
            client_secret: DISCORD_CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: refresh_token,
        }), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        // Get the new tokens
        const { access_token, refresh_token: new_refresh_token, expires_in } = tokenResponse.data;

        // Set the new refresh token in the cookie to extend the session
        res.cookie('refresh_token', new_refresh_token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 30 * 24 * 60 * 60 * 1000,
            path: '/'
        });

        res.json({ access_token: access_token, expires_in: expires_in });
    } catch (error) {
        console.error('Error refreshing Discord OAuth token:', error.response ? error.response.data : error.message);
        // Clear the invalid cookie on failure
        res.clearCookie('refresh_token');
        res.status(error.response?.status || 500).json({ message: 'Failed to refresh token. Please log in again.' });
    }
});

// NEW: Endpoint to log out and clear the refresh token cookie
app.post('/api/logout', (req, res) => {
    res.clearCookie('refresh_token');
    res.status(200).json({ message: 'Logged out successfully.' });
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
        
        // FIX: Re-structured the validConfig object to ensure all settings are saved.
        const validConfig = {
            modRoleId: newConfig.modRoleId || null,
            adminRoleId: newConfig.adminRoleId || null,
            modPingRoleId: newConfig.modPingRoleId || null,
            karmaChannelId: newConfig.karmaChannelId || null,
            countingChannelId: newConfig.countingChannelId || null,
            moderationLogChannelId: newConfig.moderationLogChannelId || null,
            messageLogChannelId: newConfig.messageLogChannelId || null,
            memberLogChannelId: newConfig.memberLogChannelId || null,
            adminLogChannelId: newConfig.adminLogChannelId || null,
            joinLeaveLogChannelId: newConfig.joinLeaveLogChannelId || null,
            boostLogChannelId: newConfig.boostLogChannelId || null,
            modAlertChannelId: newConfig.modAlertChannelId || null,
            spamChannelId: newConfig.spamChannelId || null,
            spamKeywords: newConfig.spamKeywords || null,
            spamEmojis: newConfig.spamEmojis || null,
            moderationLevel: newConfig.moderationLevel || 'none',
            blacklistedWords: newConfig.blacklistedWords || '',
            whitelistedWords: newConfig.whitelistedWords || '',
            spamDetectionEnabled: newConfig.spamDetectionEnabled,
            maxMessages: newConfig.maxMessages,
            timeframeSeconds: newConfig.timeframeSeconds,
            repeatedTextEnabled: newConfig.repeatedTextEnabled,
            externalLinksEnabled: newConfig.externalLinksEnabled,
            discordInviteLinksEnabled: newConfig.discordInviteLinksEnabled,
            excessiveEmojiEnabled: newConfig.excessiveEmojiEnabled,
            excessiveEmojiCount: newConfig.excessiveEmojiCount,
            excessiveMentionsEnabled: newConfig.excessiveMentionsEnabled,
            excessiveMentionsCount: newConfig.excessiveMentionsCount,
            excessiveCapsEnabled: newConfig.excessiveCapsEnabled,
            excessiveCapsPercentage: newConfig.excessiveCapsPercentage,
            immuneRoles: newConfig.immuneRoles || '',
            immuneChannels: newConfig.immuneChannels || '',
            meowFunEnabled: newConfig.meowFunEnabled, // FIX: Meow Fun is now correctly saved.
        };

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

        // Attach getGuildConfig and saveGuildConfig to the client object
        client.getGuildConfig = (guildId) => getGuildConfig(client, guildId);
        client.saveGuildConfig = (guildId, newConfig) => saveGuildConfig(client, guildId, newConfig);

    } catch (firebaseError) {
        console.error('Failed to initialize Firebase:', firebaseError);
        process.exit(1);
    }

    // Register slash commands
    const commands = [];
    client.commands.forEach(command => {
        commands.push(command.data.toJSON());
    });

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

    try {
        console.log('Started refreshing application (/) commands.');
        const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID; // Use local const
        if (!APPLICATION_ID) {
            console.error('DISCORD_APPLICATION_ID environment variable is not set. Slash commands might not register.');
            return;
        }

        await rest.put(
            Routes.applicationCommands(APPLICATION_ID),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error refreshing application commands:', error);
    }

    // --- Populate invite cache for join tracking ---
    client.guilds.cache.forEach(async guild => {
        // Ensure bot has 'Manage Guild' permission to fetch invites
        if (guild.members.me.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            try {
                const invites = await guild.invites.fetch();
                // Store invites as a Map of code -> uses
                client.invites.set(guild.id, new Map(invites.map(invite => [invite.code, invite.uses])));
                console.log(`Cached initial invites for guild ${guild.name}`);
            } catch (error) {
                console.warn(`Could not fetch initial invites for guild ${guild.name}. Ensure bot has 'Manage Guild' permission.`, error);
            }
        } else {
            console.warn(`Bot does not have 'Manage Guild' permission in ${guild.name}. Cannot track invites.`);
        }
    });


    // --- Register ALL Event Listeners HERE, after client is ready and Firebase is initialized ---

    // Message-related events
    client.on('messageCreate', async message => {
        if (!message.author.bot && message.guild) { // Ignore bot messages and DMs
            // Ensure message.author is not null/undefined before accessing properties
            if (!message.author) {
                console.warn(`Message ${message.id} has no author. Skipping message processing.`);
                return;
            }
            
            // Check if the author is a partial user and fetch if necessary
            if (message.author.partial) {
                try {
                    await message.author.fetch();
                } catch (error) {
                    console.error(`Failed to fetch partial author for message ${message.id}:`, error);
                    return; // Skip message if author cannot be fetched
                }
            }


            if (!client.db || !client.appId || !client.googleApiKey) {
                console.warn('Skipping message processing: Firebase or API keys not fully initialized yet.');
                return;
            }
            const guild = message.guild;
            const author = message.author;

            // --- Spam Fun Game Check ---
            const guildConfig = await client.getGuildConfig(guild.id); // Use client.getGuildConfig
            if (spamGame.shouldHandle(message, guildConfig)) {
                await spamGame.handleMessage(message, client.tenorApiKey, guildConfig.spamKeywords, guildConfig.spamEmojis); // Pass keywords and emojis
                return; // Stop further processing
            }

            // --- Meow Fun Check ---
            // FIX: Pass the logMessage function and client to handleMeow
            await meowFun.handleMeow(message, process.env.THE_CAT_API_KEY, client.getGuildConfig, logging.logMessage, client);

            // --- Counting Game Check (after auto-mod) ---
            if (guildConfig.countingChannelId && message.channel.id === guildConfig.countingChannelId) {
                const handledByCountingGame = await countingGame.checkCountMessage(
                    message,
                    client,
                    client.getGuildConfig, // Pass the client's getGuildConfig
                    client.saveGuildConfig, // Pass the client's saveGuildConfig
                    isExempt,
                    logging.logMessage
                );
                if (handledByCountingGame) {
                    return; // Message was handled by counting game, stop further processing
                }
            }
            
            // Replaced AI-based moderation with the new function call
            await autoModeration.checkMessageForModeration(
                message, client, client.getGuildConfig, client.saveGuildConfig, isExempt, logging.logModerationAction, logging.logMessage, karmaSystem // Pass karmaSystem
            );
            
            try {
                const authorKarmaData = await karmaSystem.getOrCreateUserKarma(guild.id, author.id, client.db, client.appId);
                await karmaSystem.updateUserKarmaData(guild.id, author.id, { messagesToday: (authorKarmaData.messagesToday || 0) + 1, lastActivityDate: new Date() }, client.db, client.appId);
                await karmaSystem.calculateAndAwardKarma(guild, author, { ...authorKarmaData, messagesToday: (authorKarmaData.messagesToday || 0) + 1 }, client.db, client.appId); // Removed Google API Key
                
                if (message.reference && message.reference.messageId) {
                    const repliedToMessage = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
                    if (repliedToMessage && !repliedToMessage.author.bot && repliedToMessage.author.id !== author.id) {
                        const repliedToAuthor = repliedToMessage.author;
                        const repliedToKarmaData = await karmaSystem.getOrCreateUserKarma(guild.id, repliedToAuthor.id, client.db, client.appId);
                        // AI-based sentiment analysis removed here. You can add a new system or keep a neutral karma value.
                        // For now, replies will not influence karma based on sentiment.
                        await karmaSystem.updateUserKarmaData(guild.id, repliedToAuthor.id, { repliesReceivedToday: (repliedToKarmaData.repliesReceivedToday || 0) + 1, lastActivityDate: new Date() }, client.db, client.appId);
                        await karmaSystem.calculateAndAwardKarma(guild, repliedToAuthor, { ...repliedToKarmaData, repliesReceivedToday: (repliedToKarmaData.repliesReceivedToday || 0) + 1 }, client.db, client.appId);
                    }
                }
            } catch (error) {
                console.error(`Error in messageCreate karma tracking for ${author.tag}:`, error);
            }
        }
    });

    client.on('messageDelete', async message => {
        if (!message.guild) return;
        await messageLogHandler.handleMessageDelete(message, client.getGuildConfig, logging.logMessage); // Use client.getGuildConfig
    });

    client.on('messageUpdate', async (oldMessage, newMessage) => {
        if (!newMessage.guild) return;
        await messageLogHandler.handleMessageUpdate(oldMessage, newMessage, client.getGuildConfig, logging.logMessage); // Use client.getGuildConfig
    });

    // Member-related events
    client.on('guildMemberUpdate', async (oldMember, newMember) => {
        await memberLogHandler.handleGuildMemberUpdate(oldMember, newMember, client.getGuildConfig); // Use client.getGuildConfig
    });

    client.on('userUpdate', async (oldUser, newUser) => {
        await memberLogHandler.handleUserUpdate(oldUser, newUser, client.getGuildConfig, client); // Use client.getGuildConfig
    });

    client.on('guildMemberAdd', async member => {
        // Store the old invites map *before* fetching new ones for comparison
        const oldInvitesMap = client.invites.has(member.guild.id) ? new Map(client.invites.get(member.guild.id)) : new Map();

        // Fetch new invites immediately to get latest uses
        let newInvitesMap = new Collection();
        if (member.guild.me.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            try {
                const invites = await member.guild.invites.fetch();
                newInvitesMap = new Map(invites.map(invite => [invite.code, invite.uses]));
            } catch (error) {
                console.warn(`Could not fetch initial invites for guild ${member.guild.name} on member join:`, error);
            }
        }

        await joinLeaveLogHandler.handleGuildMemberAdd(member, client.getGuildConfig, oldInvitesMap, newInvitesMap, karmaSystem.sendKarmaAnnouncement, karmaSystem.addKarmaPoints, client.db, client.appId, client);

        if (member.guild.me.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            client.invites.set(member.guild.id, newInvitesMap);
        }
        
        // --- New Member Greeting and +1 Karma ---
        const guildConfig = await client.getGuildConfig(member.guild.id);
        if (guildConfig.karmaChannelId) {
            try {
                const newKarma = await karmaSystem.addKarmaPoints(member.guild.id, member.user, 1, client.db, client.appId);
                await karmaSystem.sendKarmaAnnouncement(member.guild, member.user.id, 1, newKarma, client.getGuildConfig, client, true);
            } catch (error) {
                console.error(`Error greeting new member ${member.user.tag} or giving initial karma:`, error);
            }
        }
    });

    client.on('guildMemberRemove', async member => {
        await joinLeaveLogHandler.handleGuildMemberRemove(member, client.getGuildConfig);
    });

    // Admin-related events (channels, roles, emojis, scheduled events)
    client.on('channelCreate', async channel => {
        await adminLogHandler.handleChannelCreate(channel, client.getGuildConfig);
    });
    client.on('channelDelete', async channel => {
        await adminLogHandler.handleChannelDelete(channel, client.getGuildConfig);
    });
    client.on('channelUpdate', async (oldChannel, newChannel) => {
        await adminLogHandler.handleChannelUpdate(oldChannel, newChannel, client.getGuildConfig);
    });
    client.on('channelPinsUpdate', async (channel, time) => {
        // console.log(`Pins updated in channel ${channel.name} at ${time}`);
    });
    client.on('roleCreate', async role => {
        await adminLogHandler.handleRoleCreate(role, client.getGuildConfig);
    });
    client.on('roleDelete', async role => {
        await adminLogHandler.handleRoleDelete(role, client.getGuildConfig);
    });
    client.on('roleUpdate', async (oldRole, newRole) => {
        await adminLogHandler.handleRoleUpdate(oldRole, newRole, client.getGuildConfig);
    });
    client.on('emojiCreate', async emoji => {
        await adminLogHandler.handleEmojiCreate(emoji, client.getGuildConfig);
    });
    client.on('emojiDelete', async emoji => {
        await adminLogHandler.handleEmojiDelete(emoji, client.getGuildConfig);
    });
    client.on('emojiUpdate', async (oldEmoji, newEmoji) => {
        await adminLogHandler.handleEmojiUpdate(oldEmoji, newEmoji, client.getGuildConfig);
    });
    client.on('guildScheduledEventCreate', async guildScheduledEvent => {
        await adminLogHandler.handleGuildScheduledEventCreate(guildScheduledEvent, client.getGuildConfig);
    });
    client.on('guildScheduledEventDelete', async guildScheduledEvent => {
        await adminLogHandler.handleGuildScheduledEventDelete(guildScheduledEvent, client.getGuildConfig);
    });
    client.on('guildScheduledEventUpdate', async (oldGuildScheduledEvent, newGuildScheduledEvent) => {
        await adminLogHandler.handleGuildScheduledEventUpdate(oldGuildScheduledEvent, newGuildScheduledEvent, client.getGuildConfig);
    });

    // Invite tracking events
    client.on('inviteCreate', async invite => {
        if (invite.guild && invite.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            try {
                const newInvites = await invite.guild.invites.fetch();
                client.invites.set(invite.guild.id, new Map(newInvites.map(i => [i.code, i.uses])));
                console.log(`Cached invites for guild ${invite.guild.name} after new invite created.`);
            } catch (error) {
                console.warn(`Could not fetch invites for guild ${invite.guild.name} after invite create:`, error);
            }
        }
    });

    client.on('inviteDelete', async invite => {
        if (invite.guild && client.invites.has(invite.guild.id)) {
            client.invites.get(invite.guild.id).delete(invite.code);
        }
    });

    // Event: Message reaction added (for emoji moderation and karma system reactions)
    client.on('messageReactionAdd', async (reaction, user) => {
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                console.error('Failed to fetch partial reaction message:', error);
                return;
            }
        }

        if (!reaction.message || !reaction.message.guild || !reaction.message.author) {
            console.warn('Skipping reaction processing: Message, guild, or author is null/undefined.');
            return;
        }

        if (!client.db || !client.appId || !client.googleApiKey) {
            console.warn('Skipping reaction processing: Firebase or API keys not fully initialized yet.');
            reaction.users.remove(user.id).catch(e => console.error('Failed to remove reaction for uninitialized bot:', e));
            return;
        }
        
        if (['👍', '👎'].includes(reaction.emoji.name)) {
            const reactorMember = await reaction.message.guild.members.fetch(user.id).catch(() => null);
            const guildConfig = await client.getGuildConfig(reaction.message.guild.id);
            
            const targetUser = reaction.message.author;
            let karmaChange = 0;
            let actionText = '';

            if (reaction.emoji.name === '👍') {
                karmaChange = 1;
                actionText = '+1 Karma';
            } else { // 👎
                karmaChange = -1;
                actionText = '-1 Karma';
            }

            if (reactorMember && hasPermission(reactorMember, guildConfig)) {
                try {
                    const newKarma = await karmaSystem.addKarmaPoints(reaction.message.guild.id, targetUser, karmaChange, client.db, client.appId);
                    await karmaSystem.sendKarmaAnnouncement(reaction.message.guild, targetUser.id, karmaChange, newKarma, client.getGuildConfig, client);
                } catch (error) {
                    console.error(`Error adjusting karma for ${targetUser.tag} via emoji:`, error);
                    reaction.message.channel.send(`Failed to adjust Karma for <@${targetUser.id}>. An error occurred.`).catch(console.error);
                } finally {
                    reaction.users.remove(user.id).catch(e => console.error(`Failed to remove karma emoji reaction:`, e));
                }
                return;
            }
        }

        await handleMessageReactionAdd(
            reaction, user, client, client.getGuildConfig, client.saveGuildConfig, hasPermission, isExempt, logging.logModerationAction, logging.logMessage, karmaSystem
        );
    });

    // Event: Interaction created (for slash commands and buttons)
    client.on('interactionCreate', async interaction => {
        if (!client.db || !client.appId) {
            console.warn('Skipping interaction processing: Firebase or API keys not fully initialized yet.');
            return;
        }

        try {
            let ephemeral = true;
            if (interaction.isCommand() && interaction.commandName === 'leaderboard') {
                ephemeral = false;
            }
            
            if (interaction.isCommand()) {
                const { commandName } = interaction;
                const command = client.commands.get(commandName);

                if (!command) {
                    return interaction.reply({ content: 'No command matching that name was found.', flags: [MessageFlags.Ephemeral] });
                }

                const guildConfig = await client.getGuildConfig(interaction.guildId);

                if (['karma_plus', 'karma_minus', 'karma_set'].includes(commandName)) {
                    if (!hasPermission(interaction.member, guildConfig)) {
                        if (!interaction.deferred && !interaction.replied) {
                           await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                        }
                        return interaction.editReply({ content: 'You do not have permission to use this karma command.', flags: [MessageFlags.Ephemeral] });
                    }
                } else {
                    if (!hasPermission(interaction.member, guildConfig)) {
                        if (!interaction.deferred && !interaction.replied) {
                            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                        }
                        return interaction.editReply({ content: 'You do not have permission to use this command.', flags: [MessageFlags.Ephemeral] });
                    }
                }

                await command.execute(interaction, {
                    getGuildConfig: client.getGuildConfig,
                    saveGuildConfig: client.saveGuildConfig,
                    hasPermission,
                    isExempt,
                    logModerationAction: logging.logModerationAction,
                    logMessage: logging.logMessage,
                    MessageFlags,
                    db: client.db,
                    appId: client.appId,
                    getOrCreateUserKarma: karmaSystem.getOrCreateUserKarma,
                    updateUserKarmaData: karmaSystem.updateUserKarmaData,
                    calculateAndAwardKarma: karmaSystem.calculateAndAwardKarma,
                    addKarmaPoints: karmaSystem.addKarmaPoints,
                    subtractKarmaPoints: karmaSystem.subtractKarmaPoints,
                    setKarmaPoints: karmaSystem.setKarmaPoints,
                    client,
                    karmaSystem
                });
            } else if (interaction.isButton()) {
                // For buttons, deferUpdate is usually sufficient and handled above.
                // No specific button logic here for now.
            }
        } catch (error) {
            console.error('Error during interaction processing:', error);
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: 'An unexpected error occurred while processing your command.', flags: [MessageFlags.Ephemeral] }).catch(e => console.error('Failed to edit reply for uninitialized bot:', e));
            } else {
                await interaction.reply({ content: 'An unexpected error occurred while processing your command.', flags: [MessageFlags.Ephemeral] }).catch(e => console.error('Failed to reply for uninitialized bot:', e));
            }
        }
    });
});

// Log in to Discord with the client's token
client.login(process.env.DISCORD_BOT_TOKEN).catch(err => {
    console.error("Discord login failed:", err);
    // Do not exit here, let the process continue for the web server
});
