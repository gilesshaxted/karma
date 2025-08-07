// index.js - Main entry point for the combined web server and Discord bot
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, 'karma_bot.env') }); // Load environment variables from karma_bot.env

const { Client, Collection, GatewayIntentBits, Partials, PermissionsBitField, MessageFlags } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const { initializeApp } = require('firebase/app');
const { getAuth, signInAnonymously, signInWithCustomToken } = require('firebase/auth');
const { getFirestore } = require('firebase/firestore'); // Only getFirestore needed here

// Import core helper functions and modules
const { hasPermission, isExempt } = require('./helpers/permissions');
const logging = require('./logging/logging');
const karmaSystem = require('./karma/karmaSystem');
const autoModeration = require('./automoderation/autoModeration');
const handleMessageReactionAdd = require('./events/messageReactionAdd');

// Import new logging handlers (already separate files)
const messageLogHandler = require('./logging/messageLogHandler');
const memberLogHandler = require('./logging/memberLogHandler');
const adminLogHandler = require('./logging/adminLogHandler');
const joinLeaveLogHandler = require('./logging/joinLeaveLogHandler');
const boostLogHandler = require('./logging/boostLogHandler');

// Import new game handlers
const countingGame = require('./games/countingGame');
const spamGame = require('./events/spamFun'); 

// NEW: Import Firestore helper functions from their new file
const { getGuildConfig, saveGuildConfig } = require('./helpers/firestoreHelpers'); 

// NEW: Import and initialize dashboard routes (assuming you'll create web/dashboardRoutes.js)
const initializeDashboardRoutes = require('./web/dashboardRoutes');

// Create a new Discord client instance
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessageTyping,
        GatewayIntentBits.GuildInvites
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember, Partials.User]
});

// Create a collection to store commands
client.commands = new Collection();
client.invites = new Collection(); // Collection to store guild invites for tracking

// Firebase and Google API variables - will be initialized in client.once('ready')
client.db = null;
client.auth = null;
client.appId = null;
client.googleApiKey = null;
client.tenorApiKey = process.env.TENOR_API_KEY;
client.userId = null;

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
const app = require('express')(); // Initialize Express app here
const PORT = process.env.PORT || 3000;

app.use(require('express').json()); // For parsing application/json
app.use(require('express').static('public')); // Serve static files from the 'public' directory

// Initialize dashboard routes, passing the client and app instances
initializeDashboardRoutes(app, client);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Web server listening on port ${PORT}`);
});


// --- Discord Bot Client Setup ---
// Event: Bot is ready
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    // Initialize Firebase and Google API Key
    try {
        client.appId = process.env.FIREBASE_APP_ID;
        client.googleApiKey = process.env.GOOGLE_API_KEY || "";
        client.tenorApiKey = process.env.TENOR_API_KEY || "";

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

        // Attach getGuildConfig and saveGuildConfig to the client object
        // These are now imported from helpers/firestoreHelpers.js
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
        const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
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
        if (guild.members.me.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            try {
                const invites = await guild.invites.fetch();
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
        if (!message.author.bot && message.guild) {
            if (!message.author) {
                console.warn(`Message ${message.id} has no author. Skipping message processing.`);
                return;
            }
            if (message.author.partial) {
                try {
                    await message.author.fetch();
                } catch (error) {
                    console.error(`Failed to fetch partial author for message ${message.id}:`, error);
                    return;
                }
            }

            if (!client.db || !client.appId || !client.googleApiKey) {
                console.warn('Skipping message processing: Firebase or API keys not fully initialized yet.');
                return;
            }
            const guild = message.guild;
            const author = message.author;

            // --- Spam Fun Game Check ---
            const guildConfig = await client.getGuildConfig(guild.id);
            if (spamGame.shouldHandle(message, guildConfig)) {
                await spamGame.handleMessage(message, client.tenorApiKey, guildConfig.spamKeywords, guildConfig.spamEmojis);
                return;
            }

            // --- Counting Game Check (after auto-mod) ---
            if (guildConfig.countingChannelId && message.channel.id === guildConfig.countingChannelId) {
                const handledByCountingGame = await countingGame.checkCountMessage(
                    message,
                    client,
                    client.getGuildConfig,
                    client.saveGuildConfig,
                    isExempt,
                    logging.logMessage // Pass logging.logMessage directly
                );
                if (handledByCountingGame) {
                    return;
                }
            }
            
            await autoModeration.checkMessageForModeration(
                message, client, client.getGuildConfig, client.saveGuildConfig, isExempt, logging.logModerationAction, logging.logMessage, karmaSystem
            );
            
            try {
                const authorKarmaData = await karmaSystem.getOrCreateUserKarma(guild.id, author.id, client.db, client.appId);
                await karmaSystem.updateUserKarmaData(guild.id, author.id, { messagesToday: (authorKarmaData.messagesToday || 0) + 1, lastActivityDate: new Date() }, client.db, client.appId);
                await karmaSystem.calculateAndAwardKarma(guild, author, { ...authorKarmaData, messagesToday: (authorKarmaData.messagesToday || 0) + 1 }, client.db, client.appId);
                
                if (message.reference && message.reference.messageId) {
                    const repliedToMessage = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
                    if (repliedToMessage && !repliedToMessage.author.bot && repliedToMessage.author.id !== author.id) {
                        const repliedToAuthor = repliedToMessage.author;
                        const repliedToKarmaData = await karmaSystem.getOrCreateUserKarma(guild.id, repliedToAuthor.id, client.db, client.appId);
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
        // FIX: Pass client to logMessage
        await messageLogHandler.handleMessageDelete(message, client.getGuildConfig, logging.logMessage, client); 
    });

    client.on('messageUpdate', async (oldMessage, newMessage) => {
        if (!newMessage.guild) return;
        // FIX: Pass client to logMessage
        await messageLogHandler.handleMessageUpdate(oldMessage, newMessage, client.getGuildConfig, logging.logMessage, client);
    });

    // Member-related events
    client.on('guildMemberUpdate', async (oldMember, newMember) => {
        // FIX: Pass client to logMessage
        await memberLogHandler.handleGuildMemberUpdate(oldMember, newMember, client.getGuildConfig, logging.logMessage, client);
    });

    client.on('userUpdate', async (oldUser, newUser) => {
        await memberLogHandler.handleUserUpdate(oldUser, newUser, client.getGuildConfig, client);
    });

    client.on('guildMemberAdd', async member => {
        // Store the old invites map *before* fetching new ones for comparison
        const oldInvitesMap = client.invites.has(member.guild.id) ? new Map(client.invites.get(member.guild.id)) : new Map();

        // Fetch new invites immediately to get latest uses
        let newInvitesMap = new Collection();
        if (member.guild.me.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            try {
                const invites = await guild.invites.fetch();
                client.invites.set(guild.id, new Map(invites.map(invite => [invite.code, invite.uses])));
                console.log(`Cached initial invites for guild ${guild.name}`);
            } catch (error) {
                console.warn(`Could not fetch initial invites for guild ${member.guild.name} on member join:`, error);
            }
        }
        // Pass newInvitesMap and oldInvitesMap to handler
        // FIX: Pass client to logMessage
        await joinLeaveLogHandler.handleGuildMemberAdd(member, client.getGuildConfig, oldInvitesMap, newInvitesMap, karmaSystem.sendKarmaAnnouncement, karmaSystem.addKarmaPoints, client.db, client.appId, client, logging.logMessage); 

        // Update client.invites cache AFTER the handler has used the old state
        if (member.guild.me.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            client.invites.set(guild.id, newInvitesMap); // Store the latest uses map
        }
        
        // --- New Member Greeting and +1 Karma ---
        const guildConfig = await client.getGuildConfig(member.guild.id);
        if (guildConfig.karmaChannelId) {
            try {
                const newKarma = await karmaSystem.addKarmaPoints(member.guild.id, member.user, 1, client.db, client.appId);
                await karmaSystem.sendKarmaAnnouncement(member.guild, member.user.id, 1, newKarma, client.getGuildConfig, client);
            } catch (error) {
                console.error(`Error greeting new member ${member.user.tag} or giving initial karma:`, error);
            }
        }
    });

    client.on('guildMemberRemove', async member => {
        // FIX: Pass client to logMessage
        await joinLeaveLogHandler.handleGuildMemberRemove(member, client.getGuildConfig, logging.logMessage, client);
    });

    // Admin-related events (channels, roles, emojis, scheduled events)
    client.on('channelCreate', async channel => {
        // FIX: Pass client to logMessage
        await adminLogHandler.handleChannelCreate(channel, client.getGuildConfig, logging.logMessage, client);
    });
    client.on('channelDelete', async channel => {
        // FIX: Pass client to logMessage
        await adminLogHandler.handleChannelDelete(channel, client.getGuildConfig, logging.logMessage, client);
    });
    client.on('channelUpdate', async (oldChannel, newChannel) => {
        // FIX: Pass client to logMessage
        await adminLogHandler.handleChannelUpdate(oldChannel, newChannel, client.getGuildConfig, logging.logMessage, client);
    });
    client.on('channelPinsUpdate', async (channel, time) => {
        // console.log(`Pins updated in channel ${channel.name} at ${time}`);
    });
    client.on('roleCreate', async role => {
        // FIX: Pass client to logMessage
        await adminLogHandler.handleRoleCreate(role, client.getGuildConfig, logging.logMessage, client);
    });
    client.on('roleDelete', async role => {
        // FIX: Pass client to logMessage
        await adminLogHandler.handleRoleDelete(role, client.getGuildConfig, logging.logMessage, client);
    });
    client.on('roleUpdate', async (oldRole, newRole) => {
        // FIX: Pass client to logMessage
        await adminLogHandler.handleRoleUpdate(oldRole, newRole, client.getGuildConfig, logging.logMessage, client);
    });
    client.on('emojiCreate', async emoji => {
        // FIX: Pass client to logMessage
        await adminLogHandler.handleEmojiCreate(emoji, client.getGuildConfig, logging.logMessage, client);
    });
    client.on('emojiDelete', async emoji => {
        // FIX: Pass client to logMessage
        await adminLogHandler.handleEmojiDelete(emoji, client.getGuildConfig, logging.logMessage, client);
    });
    client.on('emojiUpdate', async (oldEmoji, newEmoji) => {
        // FIX: Pass client to logMessage
        await adminLogHandler.handleEmojiUpdate(oldEmoji, newEmoji, client.getGuildConfig, logging.logMessage, client);
    });
    client.on('guildScheduledEventCreate', async guildScheduledEvent => {
        // FIX: Pass client to logMessage
        await adminLogHandler.handleGuildScheduledEventCreate(guildScheduledEvent, client.getGuildConfig, logging.logMessage, client);
    });
    client.on('guildScheduledEventDelete', async guildScheduledEvent => {
        // FIX: Pass client to logMessage
        await adminLogHandler.handleGuildScheduledEventDelete(guildScheduledEvent, client.getGuildConfig, logging.logMessage, client);
    });
    client.on('guildScheduledEventUpdate', async (oldGuildScheduledEvent, newGuildScheduledEvent) => {
        // FIX: Pass client to logMessage
        await adminLogHandler.handleGuildScheduledEventUpdate(oldGuildScheduledEvent, newGuildScheduledEvent, client.getGuildConfig, logging.logMessage, client);
    });

    // Invite tracking events
    client.on('inviteCreate', async invite => {
        if (invite.guild && invite.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            try {
                const newInvites = await guild.invites.fetch();
                client.invites.set(guild.id, new Map(newInvites.map(invite => [invite.code, invite.uses])));
                console.log(`Cached initial invites for guild ${guild.name}`);
            } catch (error) {
                console.warn(`Could not fetch initial invites for guild ${invite.guild.name} after invite create:`, error);
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
        // Add checks for partial messages and null properties
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                console.error('Failed to fetch partial reaction message:', error);
                return;
            }
        }

        // Now, safely check for null properties on the fetched message
        if (!reaction.message || !reaction.message.guild || !reaction.message.author) {
            console.warn('Skipping reaction processing: Message, guild, or author is null/undefined.');
            return;
        }

        if (!client.db || !client.appId || !client.googleApiKey) {
            console.warn('Skipping reaction processing: Firebase or API keys not fully initialized yet.');
            reaction.users.remove(user.id).catch(e => console.error('Failed to remove reaction for uninitialized bot:', e));
            return;
        }
        
        // Handle Karma reactions first
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

            // Only process karma reactions from moderators or admins
            if (reactorMember && hasPermission(reactorMember, guildConfig)) {
                try {
                    const newKarma = await karmaSystem.addKarmaPoints(reaction.message.guild.id, targetUser, karmaChange, client.db, client.appId);
                    await karmaSystem.sendKarmaAnnouncement(reaction.message.guild, targetUser.id, karmaChange, newKarma, client.getGuildConfig, client);
                } catch (error) {
                    console.error(`Error adjusting karma for ${targetUser.tag} via emoji:`, error);
                    reaction.message.channel.send(`Failed to adjust Karma for <@${targetUser.id}>. An error occurred.`).catch(console.error);
                } finally {
                    // Always remove the reaction after processing
                    reaction.users.remove(user.id).catch(e => console.error(`Failed to remove karma emoji reaction:`, e));
                }
                return; // Stop processing this reaction, it's handled
            }
        }

        // Delegate to the external moderation/karma reaction handler if not a karma emoji
        await handleMessageReactionAdd(
            reaction, user, client, client.getGuildConfig, client.saveGuildConfig, hasPermission, isExempt, logging.logModerationAction, logging.logMessage, karmaSystem
        );
    });

    // Event: Interaction created (for slash commands and buttons)
    client.on('interactionCreate', async interaction => {
        if (!client.db || !client.appId) {
            console.warn('Skipping interaction processing: Firebase or API keys not fully initialized yet.');
            // Removed direct reply here. Commands will handle their own deferrals/replies.
            return;
        }

        try {
            // Determine if the reply should be ephemeral based on command
            let ephemeral = true; // Default to ephemeral
            if (interaction.isCommand() && interaction.commandName === 'leaderboard') {
                ephemeral = false; // Make leaderboard public
            }
            
            // Individual commands are now responsible for deferring their replies.
            // Removed global deferral logic from here.

            if (interaction.isCommand()) {
                const { commandName } = interaction;
                const command = client.commands.get(commandName);

                if (!command) {
                    // If command is not found, reply immediately (not deferred)
                    return interaction.reply({ content: 'No command matching that name was found.', flags: [MessageFlags.Ephemeral] });
                }

                const guildConfig = await client.getGuildConfig(interaction.guildId); // Use client.getGuildConfig

                // Check permissions for karma commands
                if (['karma_plus', 'karma_minus', 'karma_set'].includes(commandName)) {
                    if (!hasPermission(interaction.member, guildConfig)) {
                        // Commands are now responsible for their own deferral.
                        // This path should defer if it hasn't already.
                        if (!interaction.deferred && !interaction.replied) {
                           await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                        }
                        return interaction.editReply({ content: 'You do not have permission to use this karma command.', flags: [MessageFlags.Ephemeral] });
                    }
                } else { // For other moderation commands
                    if (!hasPermission(interaction.member, guildConfig)) {
                        // Commands are now responsible for their own deferral.
                        // This path should defer if it hasn't already.
                        if (!interaction.deferred && !interaction.replied) {
                            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                        }
                        return interaction.editReply({ content: 'You do not have permission to use this command.', flags: [MessageFlags.Ephemeral] });
                    }
                }

                await command.execute(interaction, {
                    getGuildConfig: client.getGuildConfig, // Pass client's getGuildConfig
                    saveGuildConfig: client.saveGuildConfig, // Pass client's saveGuildConfig
                    hasPermission,
                    isExempt, // isExempt is still passed, but individual karma commands will ignore it for target
                    logModerationAction: logging.logModerationAction,
                    logMessage: logging.logMessage,
                    MessageFlags,
                    db: client.db,
                    appId: client.appId,
                    getOrCreateUserKarma: karmaSystem.getOrCreateUserKarma,
                    updateUserKarmaData: karmaSystem.updateUserKarmaData,
                    calculateAndAwardKarma: karmaSystem.calculateAndAwardKarma,
                    addKarmaPoints: karmaSystem.addKarmaPoints, // Passed new karma functions
                    subtractKarmaPoints: karmaSystem.subtractKarmaPoints, // Passed new karma functions
                    setKarmaPoints: karmaSystem.setKarmaPoints, // Passed new karma functions
                    client, // Pass client object for full context
                    karmaSystem // Pass karmaSystem module for moderation functions
                });
            } else if (interaction.isButton()) {
                // For buttons, deferUpdate is usually sufficient and handled above.
                // No specific button logic here for now.
            }
        } catch (error) {
            console.error('Error during interaction processing:', error);
            // If already deferred, edit reply. Otherwise, reply immediately.
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: 'An unexpected error occurred while processing your command.', flags: [MessageFlags.Ephemeral] }).catch(e => console.error('Failed to edit reply for uninitialized bot:', e));
            } else {
                await interaction.reply({ content: 'An unexpected error occurred while processing your command.', flags: [MessageFlags.Ephemeral] }).catch(e => console.error('Failed to reply for uninitialized bot:', e));
            }
        }
    });
    // End of event listener registrations
});

// Log in to Discord with the client's token
client.login(process.env.DISCORD_BOT_TOKEN).catch(err => {
    console.error("Discord login failed:", err);
    // Do not exit here, let the process continue for the web server
});
```

---

### 2. Updated `automoderation/autoModeration.js`

This file now correctly passes the `client` object to `logging.logModerationAction`.


```javascript
// automoderation/autoModeration.js
const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const cooldowns = new Map(); // In-memory map for spam cooldowns

// Load word lists from JSON file
const wordlists = JSON.parse(fs.readFileSync(path.join(__dirname, 'wordlists.json'), 'utf8'));

// Define regex patterns for common sensitive words to catch variations
// These patterns account for spaces, common leet speak (i, l, 1; a, @, 4; e, 3; o, 0; s, 5), and repeated characters.
const sensitiveWordRegex = {
    // Example: "fuck" with variations
    fuck: /(f[\s\.]*[uUu*][\s\.]*c[\s\.]*k)/i,
    // Example: "shit" with variations
    shit: /(s[\s\.]*h[\s\.]*i[\s\.]*t)/i,
    // Example: "bitch" with variations
    bitch: /(b[\s\.]*i[\s\.]*t[\s\.]*c[\s\.]*h)/i,
    // Example: "nigger" with variations (using non-capturing groups and character classes)
    nigger: /(n[\s\.]*[iI1!][\s\.]*g[\s\.]*[gG6][\s\.]*[eE3@a][\s\.]*r?)/i,
    // Example: "faggot" with variations
    faggot: /(f[\s\.]*[aA@4][\s\.]*g[\s\.]*[gG6][\s\.]*[oO0][\s\.]*t)/i,
    // Example: "cunt" with variations
    cunt: /(c[\s\.]*[uU*][\s\.]*n[\s\.]*t)/i,
    // Add more sensitive words with their regex patterns as needed
};


/**
 * Checks a message against all configured moderation rules and takes action.
 * @param {Message} message - The message object.
 * @param {Client} client - The Discord client.
 * @param {Function} getGuildConfig - Function to get the guild's config.
 * @param {Function} saveGuildConfig - Function to save the guild's config.
 * @param {Function} isExempt - Function to check for user/role immunity.
 * @param {Function} logModerationAction - Function to log moderation actions.
 * @param {Function} logMessage - Function to log general messages.
 * @param {Object} karmaSystem - The karmaSystem module for managing user data.
 */
const checkMessageForModeration = async (message, client, getGuildConfig, saveGuildConfig, isExempt, logModerationAction, logMessage, karmaSystem) => {
    // Ignore bots and DMs
    if (message.author.bot || !message.guild) {
        return;
    }

    const guildConfig = await getGuildConfig(message.guild.id);
    const member = message.member;

    // Check for immunity (Admins/Mods are always immune)
    if (isExempt(member, guildConfig)) {
        return;
    }

    const messageContent = message.content.toLowerCase();
    let reason = null;
    let rule = null;

    // --- Check Whitelisted Words (Override) ---
    const whitelist = guildConfig.whitelistedWords ? guildConfig.whitelistedWords.split(',').map(w => w.trim().toLowerCase()) : [];
    if (whitelist.some(w => messageContent.includes(w))) {
        return; // Whitelisted content overrides all other rules.
    }

    // --- Check Blacklisted Words & Tiers (now using regex for sensitive words) ---
    const blacklistedWords = new Set();
    // Add words based on moderation tier
    if (guildConfig.moderationLevel === 'high') {
        wordlists.highLevel.forEach(w => blacklistedWords.add(w));
    } else if (guildConfig.moderationLevel === 'medium') {
        wordlists.mediumLevel.forEach(w => blacklistedWords.add(w));
    } else if (guildConfig.moderationLevel === 'low') {
        wordlists.lowLevel.forEach(w => blacklistedWords.add(w));
    }
    // Add custom blacklisted words from config
    if (guildConfig.blacklistedWords) {
        guildConfig.blacklistedWords.split(',').map(w => w.trim().toLowerCase()).forEach(w => blacklistedWords.add(w));
    }

    // First, check against specific sensitive words using regex based on moderation level
    for (const key in sensitiveWordRegex) {
        if (sensitiveWordRegex.hasOwnProperty(key)) {
            const regex = sensitiveWordRegex[key];
            let shouldCheck = false;

            // Determine if this regex should be applied based on moderationLevel
            if (key === 'nigger' || key === 'faggot') { // All tiers
                shouldCheck = true;
            } else if (key === 'cunt' || key === 'bitch') { // Medium and High tiers
                if (guildConfig.moderationLevel === 'medium' || guildConfig.moderationLevel === 'high') {
                    shouldCheck = true;
                }
            } else if (key === 'shit' || key === 'fuck') { // Only High tier
                if (guildConfig.moderationLevel === 'high') {
                    shouldCheck = true;
                }
            }
            // Add more conditions for other sensitive words if needed

            if (shouldCheck && messageContent.match(regex)) {
                reason = `Sensitive word variation detected: "${message.content.substring(messageContent.match(regex).index, messageContent.match(regex).index + messageContent.match(regex)[0].length)}".`;
                rule = `Sensitive Word Detection (${key} - Regex)`;
                break;
            }
        }
    }

    // If no sensitive regex match, then check general blacklisted words
    if (!reason) {
        for (const word of blacklistedWords) {
            // For general blacklisted words, we can still use simple includes or more generic regex if needed
            if (messageContent.includes(word)) {
                reason = `Blacklisted word "${word}" used.`;
                rule = 'Blacklisted Words';
                break;
            }
        }
    }


    // --- Check Repeated Text ---
    if (!reason && guildConfig.repeatedTextEnabled) {
        const lastMessage = await message.channel.messages.fetch({ limit: 2 }).then(msgs => msgs.last()).catch(() => null);
        if (lastMessage && lastMessage.author.id === message.author.id && lastMessage.content === message.content) {
            reason = 'Repeated text.';
            rule = 'Repeated Text';
        }
    }

    // --- Check External Links ---
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    if (!reason && guildConfig.externalLinksEnabled && messageContent.match(urlRegex)) {
        reason = 'External link posted.';
        rule = 'External Links';
    }

    // --- Check Discord Invite Links ---
    const inviteRegex = /(discord\.gg\/|discordapp\.com\/invite\/)/g;
    if (!reason && guildConfig.discordInviteLinksEnabled && messageContent.match(inviteRegex)) {
        reason = 'Discord invite link posted.';
        rule = 'Discord Invites';
    }

    // --- Check Excessive Emojis ---
    if (!reason && guildConfig.excessiveEmojiEnabled) {
        const emojiCount = (message.content.match(/(<a?:[a-zA-Z0-9_]+:\d+>|[\u00A9\u00AE\u2000-\u3300\uD83C-\uDBFF\uDC00-\uDFFF])/g) || []).length;
        if (emojiCount > (guildConfig.excessiveEmojiCount || 5)) {
            reason = `Excessive emojis (${emojiCount}/${guildConfig.excessiveEmojiCount}).`;
            rule = 'Excessive Emojis';
        }
    }
    
    // --- Check Excessive Mentions ---
    if (!reason && guildConfig.excessiveMentionsEnabled && message.mentions.users.size + message.mentions.roles.size > (guildConfig.excessiveMentionsCount || 5)) {
        reason = `Excessive mentions (${message.mentions.users.size + message.mentions.roles.size}/${guildConfig.excessiveMentionsCount}).`;
        rule = 'Excessive Mentions';
    }

    // --- Check Excessive Caps ---
    if (!reason && guildConfig.excessiveCapsEnabled) {
        const letters = message.content.replace(/[^a-zA-Z]/g, '');
        if (letters.length > 0) { // Avoid division by zero for messages without letters
            const capsPercentage = (letters.match(/[A-Z]/g) || []).length / letters.length * 100;
            if (capsPercentage > (guildConfig.excessiveCapsPercentage || 70)) {
                reason = `Excessive caps (${capsPercentage.toFixed(0)}%/${guildConfig.excessiveCapsPercentage}%).`;
                rule = 'Excessive Caps';
            }
        }
    }

    // --- Spam Detection ---
    if (!reason && guildConfig.spamDetectionEnabled) {
        const now = Date.now();
        const userCooldown = cooldowns.get(message.author.id) || { messages: [], lastTimeout: 0, timeouts: [] };
        
        // Filter out old messages
        userCooldown.messages = userCooldown.messages.filter(time => now - time < (guildConfig.timeframeSeconds * 1000 || 5000));
        userCooldown.messages.push(now);

        if (userCooldown.messages.length > (guildConfig.maxMessages || 5)) {
            reason = `Spamming detected (${userCooldown.messages.length} messages in ${guildConfig.timeframeSeconds || 5}s).`;
            rule = 'Spam Detection';
            // Reset message counter after a penalty (this is for the in-memory cooldown, not Firestore data)
            userCooldown.messages = [];
        }

        cooldowns.set(message.author.id, userCooldown);
    }
    
    // --- Apply Moderation Action if a rule was triggered ---
    if (reason) {
        console.log(`[AUTOMOD] Rule triggered for ${message.author.tag} in ${message.guild.name}: ${reason}`); // Added for debugging
        try {
            // FIX: Add specific error handling for Unknown Message
            await message.delete().catch(err => {
                if (err.code === 10008) { // DiscordAPIError[10008]: Unknown Message
                    console.warn(`[AUTOMOD WARNING] Message from ${message.author.tag} already deleted or unknown. Skipping deletion.`);
                } else {
                    console.error(`[AUTOMOD ERROR] Failed to delete message from ${message.author.tag}:`, err);
                }
            });
            
            // Get user moderation data using karmaSystem
            const modData = await karmaSystem.getOrCreateUserKarma(message.guild.id, message.author.id, client.db, client.appId);

            // Log the action and get the case number
            const caseNumber = await logModerationAction('Warning', message.guild, message.author, client.user, reason, client); 

            // Add new warning to modData with caseNumber
            const warningTimestamp = Date.now();
            const newWarning = { timestamp: warningTimestamp, rule, reason, messageContent: message.content, caseNumber: caseNumber, moderatorId: client.user.id, moderatorTag: client.user.tag }; // Include moderator info
            modData.warnings.push(newWarning);
            await karmaSystem.updateUserKarmaData(message.guild.id, message.author.id, { warnings: modData.warnings }, client.db, client.appId);

            console.log(`[AUTOMOD DEBUG] ${message.author.tag} warnings count: ${modData.warnings.length}`); // DEBUG

            // Create embed for DM
            const userDmEmbed = new EmbedBuilder()
                .setTitle('Automoderation Warning!')
                .setDescription(`You received a warning in **${message.guild.name}**.`)
                .addFields(
                    { name: 'Reason', value: reason || 'No reason provided.' },
                    { name: 'Your Message', value: `\`\`\`${message.content.substring(0, 1000)}\`\`\`` }
                )
                .setColor('#FFD700') // Gold color for warnings
                .setTimestamp();

            // Check for 3 warnings in the last hour
            const recentWarnings = modData.warnings.filter(w => warningTimestamp - w.timestamp < 3600000); // 1 hour
            console.log(`[AUTOMOD DEBUG] ${message.author.tag} recent warnings count (last hour): ${recentWarnings.length}`); // DEBUG

            if (recentWarnings.length >= 3) {
                console.log(`[AUTOMOD] ${message.author.tag} reached 3 warnings. Applying 6-hour timeout.`); // Added for debugging
                // Time out the user for 6 hours
                const timeoutDuration = 6 * 3600000; // 6 hours
                try {
                    await member.timeout(timeoutDuration, `Automoderation: 3 warnings in 1 hour.`).catch(err => {
                        console.error(`[AUTOMOD ERROR] Failed to timeout member ${member.user.tag}:`, err);
                        // Attempt to send a message to the channel if timeout fails
                        message.channel.send(`Failed to timeout <@${member.user.id}>. Please check bot permissions.`).catch(console.error);
                    });
                    const newTimeout = { timestamp: warningTimestamp, duration: '6 hours', caseNumber: caseNumber, moderatorId: client.user.id, moderatorTag: client.user.tag }; // Include moderator info
                    modData.timeouts.push(newTimeout);
                    // Clear warnings after timeout to reset the 3-warning count for the next cycle
                    modData.warnings = []; 
                    await karmaSystem.updateUserKarmaData(message.guild.id, message.author.id, { timeouts: modData.timeouts, warnings: modData.warnings }, client.db, client.appId);

                    // Update DM embed for timeout
                    userDmEmbed.setTitle('Automoderation Timeout!')
                               .setDescription(`You have been timed out in **${message.guild.name}** for 6 hours due to repeated rule violations.`)
                               .setColor('#FF0000'); // Red for timeouts
                    await message.author.send({ embeds: [userDmEmbed] }).catch(console.error);
                    // Log the timeout action
                    logModerationAction('Timeout', message.guild, message.author, client.user, `Timed out for 6 hours for 3 warnings in 1 hour.`, reason, client); 

                } catch (timeoutError) {
                    console.error(`[AUTOMOD ERROR] Error during member timeout for ${member.user.tag}:`, timeoutError);
                }
            } else {
                // Notify user about warning (only if not timed out)
                await message.author.send({ embeds: [userDmEmbed] }).catch(console.error);
            }

            // Check for 5 timeouts in the last month
            const recentTimeouts = modData.timeouts.filter(t => warningTimestamp - t.timestamp < 2592000000); // 1 month
            console.log(`[AUTOMOD DEBUG] ${message.author.tag} timeouts count: ${modData.timeouts.length}`); // DEBUG
            console.log(`[AUTOMOD DEBUG] ${message.author.tag} recent timeouts count (last month): ${recentTimeouts.length}`); // DEBUG

            if (recentTimeouts.length >= 5) {
                console.log(`[AUTOMOD] ${message.author.tag} reached 5 timeouts. Applying 7-day severe timeout.`); // Added for debugging
                // Time out for 7 days and alert mods
                const severeTimeoutDuration = 7 * 24 * 3600000; // 7 days
                try {
                    await member.timeout(severeTimeoutDuration, `Automoderation: 5 timeouts in 1 month.`).catch(err => {
                        console.error(`[AUTOMOD ERROR] Failed to apply severe timeout to member ${member.user.tag}:`, err);
                        message.channel.send(`Failed to apply severe timeout to <@${member.user.id}>. Please check bot permissions.`).catch(console.error);
                    });
                    // Clear timeouts after 7-day penalty to reset the 5-timeout count for the next cycle
                    modData.timeouts = []; 
                    await karmaSystem.updateUserKarmaData(message.guild.id, message.author.id, { timeouts: modData.timeouts }, client.db, client.appId);

                    // Update DM embed for severe timeout
                    userDmEmbed.setTitle('Automoderation Severe Timeout!')
                               .setDescription(`You have been timed out in **${message.guild.name}** for 7 days due to severe repeated rule violations.`)
                               .setColor('#FF0000'); // Red for severe timeouts
                    await message.author.send({ embeds: [userDmEmbed] }).catch(console.error);
                    // Log the severe timeout action
                    logModerationAction('Timeout', message.guild, message.author, client.user, `Timed out for 7 days for 5 timeouts in 1 month.`, reason, client); 
                    
                    // Send alert to mod channel
                    if (guildConfig.modAlertChannelId) {
                        const modAlertChannel = message.guild.channels.cache.get(guildConfig.modAlertChannelId);
                        if (modAlertChannel) {
                               const alertEmbed = new EmbedBuilder()
                                .setColor('#FF0000')
                                .setTitle('Severe Moderation Alert')
                                .setDescription(`User ${message.author.tag} (<@${message.author.id}>) has been timed out for 7 days after receiving 5 timeouts in one month.`)
                                .setTimestamp();
                            modAlertChannel.send({ embeds: [alertEmbed] }).catch(console.error);
                        }
                    }
                } catch (severeTimeoutError) {
                    console.error(`[AUTOMOD ERROR] Error during severe member timeout for ${member.user.tag}:`, severeTimeoutError);
                }
            }

        } catch (error) {
            console.error(`[AUTOMOD ERROR] Failed to process automoderation for message from ${message.author.tag}:`, error);
        }
    }
};

module.exports = {
    checkMessageForModeration
};
