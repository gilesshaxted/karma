// index.js
require('dotenv').config();
const { Client, Collection, GatewayIntentBits, Partials, PermissionsBitField } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const { initializeApp } = require('firebase/app');
const { getAuth, signInAnonymously, signInWithCustomToken } = require('firebase/auth');
const { getFirestore, doc, getDoc, setDoc, updateDoc, collection, addDoc, query, where, limit, getDocs } = require('firebase/firestore');
const express = require('express');
const axios = require('axios'); // Changed from node-fetch to axios

// Create a new Discord client with necessary intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// Create a collection to store commands
client.commands = new Collection();

// Firebase and Google API variables - Initialize them early to prevent 'null' errors
client.db = null;
client.auth = null;
client.appId = null;
client.googleApiKey = null;


// Import helper functions
const { hasPermission, isExempt } = require('./helpers/permissions');
const logging = require('./logging/logging');
const karmaSystem = require('./karma/karmaSystem');
const autoModeration = require('./automoderation/autoModeration');
const handleMessageReactionAdd = require('./events/messageReactionAdd');

// --- Discord OAuth Configuration ---
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;
const DISCORD_OAUTH_SCOPES = 'identify guilds'; // Scopes for user identification and guild list
const DISCORD_BOT_PERMISSIONS = [ // Bot permissions for the invite link
    PermissionsBitField.Flags.ManageChannels,
    PermissionsBitField.Flags.ManageRoles,
    PermissionsBitField.Flags.KickMembers,
    PermissionsBitField.Flags.BanMembers,
    PermissionsBitField.Flags.ModerateMembers, // For timeout
    PermissionsBitField.Flags.ReadMessageHistory,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.ManageMessages
].reduce((acc, perm) => acc | perm, 0n).toString(); // Changed 0 to 0n for BigInt compatibility

// --- Express Web Server for Dashboard ---
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json()); // For parsing application/json
app.use(express.static('public')); // Serve static files from the 'public' directory

// Basic health check endpoint
app.get('/', (req, res) => {
    // If user navigates to root, serve the dashboard HTML
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

        res.json(tokenResponse.data); // axios puts response data in .data
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
        req.discordUser = userResponse.data; // axios puts response data in .data
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
        const guildsResponse = await axios.get('https://discord.com/api/users/@me/guilds', {
            headers: { 'Authorization': `Bearer ${req.discordAccessToken}` }
        });
        const userGuilds = guildsResponse.data; // axios puts response data in .data

        const botGuilds = client.guilds.cache; // Get guilds where the bot is currently in

        // Filter guilds: bot is in it AND user has Administrator permission in that guild
        const manageableGuilds = userGuilds.filter(userGuild => {
            const hasAdminPerms = (parseInt(userGuild.permissions) & PermissionsBitField.Flags.Administrator) === PermissionsBitField.Flags.Administrator;
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
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            return res.status(404).json({ message: 'Bot is not in this guild or guild not found.' });
        }

        // Ensure the logged-in user is actually an admin in this guild
        const member = await guild.members.fetch(req.discordUser.id).catch(() => null);
        if (!member || !member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return res.status(403).json({ message: 'You do not have administrator permissions in this guild.' });
        }

        // Fetch roles
        const roles = guild.roles.cache.map(role => ({ id: role.id, name: role.name }));

        // Fetch channels (only text channels for now, as per setup needs)
        const channels = guild.channels.cache
            .filter(channel => channel.isTextBased())
            .map(channel => ({ id: channel.id, name: channel.name, type: channel.type }));

        // Get current bot config from Firestore
        const currentConfig = await getGuildConfig(guildId);

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
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            return res.status(404).json({ message: 'Bot is not in this guild or guild not found.' });
        }

        // Ensure the logged-in user is actually an an admin in this guild
        const member = await guild.members.fetch(req.discordUser.id).catch(() => null);
        if (!member || !member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return res.status(403).json({ message: 'You do not have administrator permissions in this guild to save settings.' });
        }

        // Validate incoming config (basic validation)
        const validConfig = {};
        if (newConfig.modRoleId) validConfig.modRoleId = newConfig.modRoleId;
        if (newConfig.adminRoleId) validConfig.adminRoleId = newConfig.adminRoleId;
        if (newConfig.moderationLogChannelId) validConfig.moderationLogChannelId = newConfig.moderationLogChannelId;
        if (newConfig.messageLogChannelId) validConfig.messageLogChannelId = newConfig.messageLogChannelId;
        if (newConfig.modAlertChannelId) validConfig.modAlertChannelId = newConfig.modAlertChannelId;
        if (newConfig.modPingRoleId) validConfig.modPingRoleId = newConfig.modPingRoleId;

        await saveGuildConfig(guildId, validConfig);
        res.json({ message: 'Configuration saved successfully!' });

    } catch (error) {
        console.error(`Error saving config for guild ${guildId}:`, error.response ? error.response.data : error.message);
        res.status(error.response?.status || 500).json({ message: 'Internal server error saving config.' });
    }
});


// Event: Bot is ready
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    // Initialize Firebase and Google API Key
    try {
        client.appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        client.googleApiKey = process.env.GOOGLE_API_KEY || "";

        const firebaseConfig = {
            apiKey: process.env.FIREBASE_API_KEY,
            authDomain: process.env.FIREBASE_AUTH_DOMAIN,
            projectId: process.env.FIREBASE_PROJECT_ID,
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
            messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
            appId: process.env.FIREBASE_APP_ID
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
        const applicationID = process.env.DISCORD_APPLICATION_ID;
        if (!applicationID) {
            console.error('DISCORD_APPLICATION_ID environment variable is not set. Slash commands might not register.');
            return;
        }

        await rest.put(
            Routes.applicationCommands(applicationID),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error refreshing application commands:', error);
    }
});

// Event: Message Creation (for Karma system and Auto-Moderation)
client.on('messageCreate', async message => {
    // Ignore bot messages and DMs
    if (message.author.bot || !message.guild) return;

    // Crucial check: Ensure Firebase and essential services are initialized
    if (!client.db || !client.appId || !client.googleApiKey) {
        console.warn('Skipping message processing: Firebase or API keys not fully initialized yet.');
        return;
    }

    const guild = message.guild;
    const author = message.author;

    // --- Auto-Moderation Check ---
    await autoModeration.checkMessageForModeration(
        message,
        client,
        getGuildConfig,
        saveGuildConfig,
        isExempt,
        logging.logModerationAction,
        logging.logMessage,
        client.googleApiKey
    );

    // --- Karma System Update ---
    try {
        const authorKarmaData = await karmaSystem.getOrCreateUserKarma(guild.id, author.id, client.db, client.appId);
        await karmaSystem.updateUserKarmaData(guild.id, author.id, {
            messagesToday: (authorKarmaData.messagesToday || 0) + 1,
            lastActivityDate: new Date()
        }, client.db, client.appId);
        await karmaSystem.calculateAndAwardKarma(
            guild,
            author,
            { ...authorKarmaData, messagesToday: (authorKarmaData.messagesToday || 0) + 1 },
            client.db,
            client.appId,
            client.googleApiKey
        );

        // If it's a reply, track replies received by the original author
        if (message.reference && message.reference.messageId) {
            const repliedToMessage = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
            if (repliedToMessage && !repliedToMessage.author.bot && repliedToMessage.author.id !== author.id) {
                const repliedToAuthor = repliedToMessage.author;
                const repliedToKarmaData = await karmaSystem.getOrCreateUserKarma(guild.id, repliedToAuthor.id, client.db, client.appId);

                const sentiment = await karmaSystem.analyzeSentiment(message.content, client.googleApiKey);
                if (sentiment === 'negative') {
                    console.log(`Negative reply sentiment detected for message from ${author.tag} to ${repliedToAuthor.tag}. Skipping karma gain for reply.`);
                } else {
                    await karmaSystem.updateUserKarmaData(guild.id, repliedToAuthor.id, {
                        repliesReceivedToday: (repliedToKarmaData.repliesReceivedToday || 0) + 1,
                        lastActivityDate: new Date()
                    }, client.db, client.appId);
                    await karmaSystem.calculateAndAwardKarma(
                        guild,
                        repliedToAuthor,
                        { ...repliedToKarmaData, repliesReceivedToday: (repliedToKarmaData.repliesReceivedToday || 0) + 1 },
                        client.db,
                        client.appId,
                        client.googleApiKey
                    );
                }
            }
        }
    } catch (error) {
        console.error(`Error in messageCreate karma tracking for ${author.tag}:`, error);
    }
});


// Event: Interaction created (for slash commands and buttons)
client.on('interactionCreate', async interaction => {
    // Crucial check: Ensure Firebase and essential services are initialized
    if (!client.db || !client.appId) {
        console.warn('Skipping interaction processing: Firebase not fully initialized yet.');
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: 'Bot is still starting up, please try again in a moment.' }).catch(e => console.error('Failed to edit reply for uninitialized bot:', e));
        } else {
            await interaction.reply({ content: 'Bot is still starting up, please try again in a moment.', ephemeral: true }).catch(e => console.error('Failed to reply for uninitialized bot:', e));
        }
        return;
    }

    try {
        if (interaction.isCommand()) {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

            const { commandName } = interaction;

            const command = client.commands.get(commandName);

            if (!command) {
                return interaction.editReply({ content: 'No command matching that name was found.' });
            }

            const guildConfig = await getGuildConfig(interaction.guildId);

            if (!hasPermission(interaction.member, guildConfig)) {
                return interaction.editReply({ content: 'You do not have permission to use this command.' });
            }

            // Pass all necessary dependencies to command execute functions
            await command.execute(interaction, {
                getGuildConfig,
                saveGuildConfig,
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
                analyzeSentiment: karmaSystem.analyzeSentiment,
                client
            });
        } else if (interaction.isButton()) {
            await interaction.deferUpdate();

            const { customId } = interaction;
            const guildConfig = await getGuildConfig(interaction.guildId);

            if (customId.startsWith('warnings_page_')) {
                const [_, action, targetUserId, currentPageStr] = customId.split('_');
                const currentPage = parseInt(currentPageStr);
                const targetUser = await client.users.fetch(targetUserId);

                const warningsCommand = client.commands.get('warnings');
                if (warningsCommand) {
                    await warningsCommand.handlePagination(interaction, targetUser, action, currentPage, { db: client.db, appId: client.appId, MessageFlags });
                }
                return;
            }

            if (customId === 'setup_roles') {
                await interaction.followUp({ content: 'Please mention the Moderator role and then the Administrator role (e.g., `@Moderator @Administrator`). Type `none` if you don\'t have one of them.', flags: [MessageFlags.Ephemeral] });

                const filter = m => m.author.id === interaction.user.id;
                const collector = interaction.channel.createMessageCollector({ filter, time: 60000 });

                collector.on('collect', async m => {
                    const roles = m.mentions.roles;
                    let modRole = null;
                    let adminRole = null;

                    if (roles.size >= 1) {
                        modRole = roles.first();
                        if (roles.size >= 2) {
                            adminRole = roles.last();
                        }
                    } else if (m.content.toLowerCase() === 'none') {
                        // User explicitly said 'none' for both
                    } else {
                        await interaction.followUp({ content: 'Please mention the roles correctly or type `none`.', flags: [MessageFlags.Ephemeral] });
                        return;
                    }

                    guildConfig.modRoleId = modRole ? modRole.id : null;
                    guildConfig.adminRoleId = adminRole ? adminRole.id : null;
                    await saveGuildConfig(interaction.guildId, guildConfig);

                    await interaction.followUp({ content: `Moderator role set to: ${modRole ? modRole.name : 'None'}\nAdministrator role set to: ${adminRole ? adminRole.name : 'None'}`, flags: [MessageFlags.Ephemeral] });
                    collector.stop();
                    m.delete().catch(console.error);
                });

                collector.on('end', collected => {
                    if (collected.size === 0) {
                        interaction.followUp({ content: 'You did not respond in time. Role setup cancelled.', flags: [MessageFlags.Ephemeral] }).catch(console.error);
                    }
                });

            } else if (customId === 'setup_channels') {
                await interaction.followUp({ content: 'Please mention the Moderation Log Channel and then the Message Log Channel (e.g., `#mod-logs #message-logs`).', flags: [MessageFlags.Ephemeral] });

                const filter = m => m.author.id === interaction.user.id;
                const collector = interaction.channel.createMessageCollector({ filter, time: 60000 });

                collector.on('collect', async m => {
                    const channels = m.mentions.channels;
                    let modLogChannel = null;
                    let msgLogChannel = null;

                    if (channels.size >= 1) {
                        modLogChannel = channels.first();
                        if (channels.size >= 2) {
                            msgLogChannel = channels.last();
                        }
                    } else {
                        await interaction.followUp({ content: 'Please mention the channels correctly.', flags: [MessageFlags.Ephemeral] });
                        return;
                    }

                    guildConfig.moderationLogChannelId = modLogChannel ? modLogChannel.id : null;
                    guildConfig.messageLogChannelId = msgLogChannel ? msgLogChannel.id : null;
                    await saveGuildConfig(interaction.guildId, guildConfig);

                    await interaction.followUp({ content: `Moderation Log Channel set to: ${modLogChannel ? modLogChannel.name : 'None'}\nMessage Log Channel set to: ${msgLogChannel ? msgLogChannel.name : 'None'}`, flags: [MessageFlags.Ephemeral] });
                    collector.stop();
                    m.delete().catch(console.error);
                });

                collector.on('end', collected => {
                    if (collected.size === 0) {
                        interaction.followUp({ content: 'You did not respond in time. Channel setup cancelled.', flags: [MessageFlags.Ephemeral] }).catch(console.error);
                    }
                });
            } else if (customId === 'setup_auto_mod_channels') {
                await interaction.followUp({ content: 'Please mention the Auto-Moderation Alert Channel and then the Role to ping (e.g., `#mod-alerts @Moderators`). Type `none` if you don\'t have one of them.', flags: [MessageFlags.Ephemeral] });

                const filter = m => m.author.id === interaction.user.id;
                const collector = interaction.channel.createMessageCollector({ filter, time: 60000 });

                collector.on('collect', async m => {
                    const channels = m.mentions.channels;
                    const roles = m.mentions.roles;
                    let modAlertChannel = null;
                    let modPingRole = null;

                    if (channels.size >= 1) {
                        modAlertChannel = channels.first();
                    }
                    if (roles.size >= 1) {
                        modPingRole = roles.first();
                    } else if (m.content.toLowerCase() === 'none') {
                        // User explicitly said 'none'
                    } else {
                        await interaction.followUp({ content: 'Please mention the channel and role correctly or type `none`.', flags: [MessageFlags.Ephemeral] });
                        return;
                    }

                    guildConfig.modAlertChannelId = modAlertChannel ? modAlertChannel.id : null;
                    guildConfig.modPingRoleId = modPingRole ? modPingRole.id : null;
                    await saveGuildConfig(interaction.guildId, guildConfig);

                    await interaction.followUp({ content: `Auto-Moderation Alert Channel set to: ${modAlertChannel ? modAlertChannel.name : 'None'}\nModerator Ping Role set to: ${modPingRole ? modPingRole.name : 'None'}`, flags: [MessageFlags.Ephemeral] });
                    collector.stop();
                    m.delete().catch(console.error);
                });

                collector.on('end', collected => {
                    if (collected.size === 0) {
                        interaction.followUp({ content: 'You did not respond in time. Auto-moderation channel setup cancelled.', flags: [MessageFlags.Ephemeral] }).catch(console.error);
                    }
                });
            }
        }
    } catch (error) {
        console.error('Error during interaction processing:', error);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: 'An unexpected error occurred while processing your command.' }).catch(e => console.error('Failed to edit reply after error:', e));
        } else {
            await interaction.reply({ content: 'An unexpected error occurred while processing your command.', flags: [MessageFlags.Ephemeral] }).catch(e => console.error('Failed to reply after error:', e));
        }
    }
});

// Event: Message reaction added (for emoji moderation and karma system reactions)
client.on('messageReactionAdd', async (reaction, user) => {
    // Crucial check: Ensure Firebase and essential services are initialized
    if (!client.db || !client.appId || !client.googleApiKey) {
        console.warn('Skipping reaction processing: Firebase or API keys not fully initialized yet.');
        reaction.users.remove(user.id).catch(e => console.error('Failed to remove reaction for uninitialized bot:', e));
        return;
    }

    // Delegate to the external event handler
    await handleMessageReactionAdd(
        reaction,
        user,
        client,
        getGuildConfig,
        saveGuildConfig,
        hasPermission,
        isExempt,
        logging.logModerationAction,
        logging.logMessage,
        karmaSystem
    );
});


// Log in to Discord with your client's token
client.login(process.env.DISCORD_BOT_TOKEN);
