// bot.js - Contains all Discord bot logic and exports a promise for its readiness
require('dotenv').config();
const { Client, Collection, GatewayIntentBits, Partials, PermissionsBitField, MessageFlags } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const { initializeApp } = require('firebase/app');
const { getAuth, signInAnonymously, signInWithCustomToken } = require('firebase/auth');
const { getFirestore, doc, getDoc, setDoc, updateDoc, collection, addDoc, query, where, limit, getDocs } = require('firebase/firestore');
const axios = require('axios'); // Use axios for API calls

// Create a new Discord client instance
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildPresences, // Required for userUpdate, guildMemberUpdate (presence changes)
        GatewayIntentBits.GuildModeration // Required for audit log, guildScheduledEvent*
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember, Partials.User] // Added GuildMember, User for member/user updates
});

// Create a collection to store commands
client.commands = new Collection();

// Firebase and Google API variables - will be initialized in client.once('ready')
client.db = null;
client.auth = null;
client.appId = null;
client.googleApiKey = null;
client.userId = null; // Also store userId on client


// Import helper functions (relative to bot.js)
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


// --- Discord OAuth Configuration (Bot's Permissions for Invite) ---
const DISCORD_APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const DISCORD_BOT_PERMISSIONS = new PermissionsBitField([
    PermissionsBitField.Flags.ManageChannels,
    PermissionsBitField.Flags.ManageRoles,
    PermissionsBitField.Flags.KickMembers,
    PermissionsBitField.Flags.BanMembers,
    PermissionsBitField.Flags.ModerateMembers,
    PermissionsBitField.Flags.ReadMessageHistory,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.ManageMessages,
    PermissionsBitField.Flags.ViewAuditLog // Added for admin logging
]).bitfield.toString();

// Helper function to get guild-specific config from Firestore
// This function needs to be exported for index.js to use in API routes
const getGuildConfig = async (guildId) => {
    if (!client.db || !client.appId) {
        console.error('Firestore not initialized yet when getGuildConfig was called.');
        return null;
    }
    const configRef = doc(client.db, `artifacts/${client.appId}/public/data/guilds/${guildId}/configs`, 'settings');
    const configSnap = await getDoc(configRef);

    if (configSnap.exists()) {
        return configSnap.data();
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
            caseNumber: 0
        };
        await setDoc(configRef, defaultConfig);
        return defaultConfig;
    }
};

// Helper function to save guild-specific config to Firestore
// This function needs to be exported for index.js to use in API routes
const saveGuildConfig = async (guildId, newConfig) => {
    if (!client.db || !client.appId) {
        console.error('Firestore not initialized yet when saveGuildConfig was called.');
        return;
    }
    const configRef = doc(client.db, `artifacts/${client.appId}/public/data/guilds/${guildId}/configs`, 'settings');
    await setDoc(configRef, newConfig, { merge: true });
};


// Dynamically load command files
const moderationCommandFiles = [
    'warn.js',
    'timeout.js',
    'kick.js',
    'ban.js',
    'warnings.js',
    'warning.js',
    'clearwarnings.js',
    'clearwarning.js'
];

const karmaCommandFiles = [
    'karma.js',
    'leaderboard.js'
];

for (const file of moderationCommandFiles) {
    const command = require(`./moderation/${file}`);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
    } else {
        console.log(`[WARNING] The moderation command in ${file} is missing a required "data" or "execute" property.`);
    }
}

for (const file of karmaCommandFiles) {
    const command = require(`./karma/${file}`);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
    } else {
        console.log(`[WARNING] The karma command in ${file} is missing a required "data" or "execute" property.`);
    }
}

// Promise to track bot readiness and Firebase initialization
const getReadyClient = async () => {
    return new Promise(async (resolve, reject) => {
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
                return reject(firebaseError); // Reject the promise on Firebase error
            }

            // Register slash commands
            const commands = [];
            client.commands.forEach(command => {
                commands.push(command.data.toJSON());
            });

            const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

            try {
                console.log('Started refreshing application (/) commands.');
                if (!DISCORD_APPLICATION_ID) {
                    console.error('DISCORD_APPLICATION_ID environment variable is not set. Slash commands might not register.');
                    return;
                }

                await rest.put(
                    Routes.applicationCommands(DISCORD_APPLICATION_ID),
                    { body: commands },
                );

                console.log('Successfully reloaded application (/) commands.');
            } catch (error) {
                console.error('Error refreshing application commands:', error);
            }
            resolve(client); // Resolve the promise with the ready client
        });

        // Log in to Discord with the client's token
        client.login(process.env.DISCORD_BOT_TOKEN).catch(err => {
            console.error("Discord login failed:", err);
            reject(err); // Reject the promise if login fails
        });
    });
};


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
        client, // Pass client for its properties
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
            // Defer reply immediately, but handle potential failure
            let deferred = false;
            try {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                deferred = true;
            } catch (deferError) {
                if (deferError.code === 10062) { // Unknown interaction
                    console.warn(`Interaction ${interaction.id} already expired or unknown when deferring. Skipping.`);
                    return; // Stop processing this interaction
                }
                console.error(`Error deferring reply for interaction ${interaction.id}:`, deferError);
                // If defer fails for other reasons, still try to reply normally later
            }

            const { commandName } = interaction;

            const command = client.commands.get(commandName);

            if (!command) {
                if (deferred) {
                    return interaction.editReply({ content: 'No command matching that name was found.' });
                } else {
                    return interaction.reply({ content: 'No command matching that name was found.', ephemeral: true });
                }
            }

            const guildConfig = await getGuildConfig(interaction.guildId);

            if (!hasPermission(interaction.member, guildConfig)) {
                if (deferred) {
                    return interaction.editReply({ content: 'You do not have permission to use this command.' });
                } else {
                    return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
                }
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
            // Defer update immediately, but handle potential failure
            let deferred = false;
            try {
                await interaction.deferUpdate(); // Use deferUpdate for buttons
                deferred = true;
            } catch (deferError) {
                if (deferError.code === 10062) { // Unknown interaction
                    console.warn(`Button interaction ${interaction.id} already expired or unknown when deferring. Skipping.`);
                    return; // Stop processing this interaction
                }
                console.error(`Error deferring button update for interaction ${interaction.id}:`, deferError);
                // If defer fails for other reasons, we can't do much for buttons.
            }

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
        }
    } catch (error) {
        console.error('Error during interaction processing:', error);
        // Fallback if an unexpected error occurs after initial defer/reply attempts
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: 'An unexpected error occurred while processing your command.' }).catch(e => console.error('Failed to edit reply after error:', e));
        } else {
            // This path should ideally not be hit for commands if deferReply is handled correctly
            await interaction.reply({ content: 'An unexpected error occurred while processing your command.', ephemeral: true }).catch(e => console.error('Failed to reply after error:', e));
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


// Log in to Discord with the client's token
client.login(process.env.DISCORD_BOT_TOKEN);

// Export client and helper functions for index.js to use in API routes
module.exports = {
    client,
    getGuildConfig,
    saveGuildConfig,
    getReadyClient // Export the new function
};
