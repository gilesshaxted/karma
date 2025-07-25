// bot.js - Contains all Discord bot logic and exports a single initialization function
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

// Firebase and Google API variables - will be initialized in initializeAndGetClient
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
// This function will be attached to the client instance
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
// This function will be attached to the client instance
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
    'leaderboard.js',
    'karmaPlus.js',
    'karmaMinus.js',
    'karmaSet.js'
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

/**
 * Initializes the Discord bot, Firebase, and registers event listeners.
 * Returns the fully ready Discord client instance.
 * This is the primary export of bot.js.
 * @returns {Promise<Client>} The fully initialized Discord client.
 */
const initializeAndGetClient = async () => {
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
                return reject(firebaseError);
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

            // Attach getGuildConfig and saveGuildConfig directly to the client instance
            client.getGuildConfig = getGuildConfig;
            client.saveGuildConfig = saveGuildConfig;

            resolve(client);
        });

        // Log in to Discord with the client's token
        client.login(process.env.DISCORD_BOT_TOKEN).catch(err => {
            console.error("Discord login failed:", err);
            reject(err);
        });
    });
};


// --- Event Listeners for the Discord Bot ---

// Message-related events
client.on('messageCreate', async message => {
    if (!message.author.bot && message.guild) { // Ignore bot messages and DMs
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
            client.getGuildConfig, // Use client's attached function
            client.saveGuildConfig, // Use client's attached function
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
    }
});

client.on('messageDelete', async message => {
    if (!message.guild) return;
    await messageLogHandler.handleMessageDelete(message, client.getGuildConfig, logging.logMessage);
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (!newMessage.guild) return;
    await messageLogHandler.handleMessageUpdate(oldMessage, newMessage, client.getGuildConfig, logging.logMessage);
});

// Member-related events
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    // Pass client.getGuildConfig directly
    await memberLogHandler.handleGuildMemberUpdate(oldMember, newMember, client.getGuildConfig);
    await boostLogHandler.handleBoostUpdate(oldMember, newMember, client.getGuildConfig); // Boosts are part of member update
});

client.on('userUpdate', async (oldUser, newUser) => {
    await memberLogHandler.handleUserUpdate(oldUser, newUser, client.getGuildConfig, client);
});

client.on('guildMemberAdd', async member => {
    await joinLeaveLogHandler.handleGuildMemberAdd(member, client.getGuildConfig);
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
    // This event can be noisy, only log if truly needed for pins
    // console.log(`Pins updated in channel ${channel.name} at ${time}`);
});
client.on('guildMemberRoleUpdate', async (member, oldRoles, newRoles) => {
    // This is handled by memberLogHandler.handleGuildMemberUpdate
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
        client.getGuildConfig, // Pass client's attached function
        client.saveGuildConfig, // Pass client's attached function
        hasPermission,
        isExempt,
        logging.logModerationAction,
        logging.logMessage,
        karmaSystem // Pass the entire karmaSystem module
    );
});


// Export the initialization function as the default export
module.exports = initializeAndGetClient;
