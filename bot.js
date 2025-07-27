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
        GatewayIntentBits.GuildModeration, // Required for audit log, guildScheduledEvent*
        GatewayIntentBits.GuildMessageTyping, // Often useful for bot interactions, though not strictly for logging
        GatewayIntentBits.GuildInvites // Required to read invites for join tracking
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember, Partials.User] // Added GuildMember, User for member/user updates
});

// Create a collection to store commands
client.commands = new Collection();
// Collection to store guild invites for tracking
client.invites = new Collection();

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
    PermissionsBitField.Flags.ViewAuditLog, // Added for admin logging
    PermissionsBitField.Flags.ManageGuild // Added for invite tracking
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

            // --- Populate invite cache for join tracking ---
            console.log('Populating invite cache...');
            client.guilds.cache.forEach(async guild => {
                if (guild.members.me.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                    try {
                        const invites = await guild.invites.fetch();
                        client.invites.set(guild.id, new Collection(invites.map(invite => [invite.code, invite.uses])));
                        console.log(`Cached invites for guild ${guild.name}`);
                    } catch (error) {
                        console.warn(`Could not fetch invites for guild ${guild.name}. Ensure bot has 'Manage Guild' permission.`, error);
                    }
                } else {
                    console.warn(`Bot does not have 'Manage Guild' permission in ${guild.name}. Cannot track invites.`);
                }
            });


            // --- Register ALL Event Listeners HERE, after client is ready and Firebase is initialized ---

            // Message-related events
            client.on('messageCreate', async message => {
                if (!message.author.bot && message.guild) { // Ignore bot messages and DMs
                    if (!client.db || !client.appId || !client.googleApiKey) {
                        console.warn('Skipping message processing: Firebase or API keys not fully initialized yet.');
                        return;
                    }
                    const guild = message.guild;
                    const author = message.author;

                    await autoModeration.checkMessageForModeration(
                        message, client, client.getGuildConfig, client.saveGuildConfig, isExempt, logging.logModerationAction, logging.logMessage, client.googleApiKey
                    );
                    try {
                        const authorKarmaData = await karmaSystem.getOrCreateUserKarma(guild.id, author.id, client.db, client.appId);
                        await karmaSystem.updateUserKarmaData(guild.id, author.id, { messagesToday: (authorKarmaData.messagesToday || 0) + 1, lastActivityDate: new Date() }, client.db, client.appId);
                        await karmaSystem.calculateAndAwardKarma(guild, author, { ...authorKarmaData, messagesToday: (authorKarmaData.messagesToday || 0) + 1 }, client.db, client.appId, client.googleApiKey);

                        if (message.reference && message.reference.messageId) {
                            const repliedToMessage = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
                            if (repliedToMessage && !repliedToMessage.author.bot && repliedToMessage.author.id !== author.id) {
                                const repliedToAuthor = repliedToMessage.author;
                                const repliedToKarmaData = await karmaSystem.getOrCreateUserKarma(guild.id, repliedToAuthor.id, client.db, client.appId);
                                const sentiment = await karmaSystem.analyzeSentiment(message.content, client.googleApiKey);
                                if (sentiment === 'negative') {
                                    console.log(`Negative reply sentiment detected for message from ${author.tag} to ${repliedToAuthor.tag}. Skipping karma gain for reply.`);
                                } else {
                                    await karmaSystem.updateUserKarmaData(guild.id, repliedToAuthor.id, { repliesReceivedToday: (repliedToKarmaData.repliesReceivedToday || 0) + 1, lastActivityDate: new Date() }, client.db, client.appId);
                                    await karmaSystem.calculateAndAwardKarma(guild, repliedToAuthor, { ...repliedToKarmaData, repliesReceivedToday: (repliedToKarmaData.repliesReceivedToday || 0) + 1 }, client.db, client.appId, client.googleApiKey);
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
                await memberLogHandler.handleGuildMemberUpdate(oldMember, newMember, client.getGuildConfig);
                await boostLogHandler.handleBoostUpdate(oldMember, newMember, client.getGuildConfig);
            });

            client.on('userUpdate', async (oldUser, newUser) => {
                await memberLogHandler.handleUserUpdate(oldUser, newUser, client.getGuildConfig, client);
            });

            client.on('guildMemberAdd', async member => {
                // Pass client.invites for invite tracking
                await joinLeaveLogHandler.handleGuildMemberAdd(member, client.getGuildConfig, client.invites);
                // Update invite cache after a member joins
                if (member.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                    try {
                        const newInvites = await member.guild.invites.fetch();
                        client.invites.set(member.guild.id, new Collection(newInvites.map(invite => [invite.code, invite.uses])));
                    } catch (error) {
                        console.warn(`Failed to update invite cache for guild ${member.guild.name} after member join:`, error);
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
                        client.invites.set(invite.guild.id, new Collection(newInvites.map(i => [i.code, i.uses])));
                    } catch (error) {
                        console.warn(`Failed to update invite cache for guild ${invite.guild.name} after invite create:`, error);
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
                if (!client.db || !client.appId || !client.googleApiKey) {
                    console.warn('Skipping reaction processing: Firebase or API keys not fully initialized yet.');
                    reaction.users.remove(user.id).catch(e => console.error('Failed to remove reaction for uninitialized bot:', e));
                    return;
                }
                // Handle Karma reactions first
                if (['👍', '👎'].includes(reaction.emoji.name)) {
                    const reactorMember = await reaction.message.guild.members.fetch(user.id).catch(() => null);
                    const guildConfig = await client.getGuildConfig(reaction.message.guild.id);

                    // Only process karma reactions from moderators or admins
                    if (reactorMember && hasPermission(reactorMember, guildConfig)) {
                        const targetUser = reaction.message.author;
                        let karmaChange = 0;
                        let actionText = '';

                        if (reaction.emoji.name === '👍') {
                            karmaChange = 1;
                            actionText = '+1 Karma';
                        } else {
                            karmaChange = -1;
                            actionText = '-1 Karma';
                        }

                        try {
                            const newKarma = await karmaSystem.addKarmaPoints(reaction.message.guild.id, targetUser, karmaChange, client.db, client.appId);
                            await reaction.message.channel.send(`${actionText} for <@${targetUser.id}>. New total: ${newKarma} Karma.`).catch(console.error);
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
                    console.warn('Skipping interaction processing: Firebase not fully initialized yet.');
                    if (interaction.deferred || interaction.replied) {
                        await interaction.editReply({ content: 'Bot is still starting up, please try again in a moment.' }).catch(e => console.error('Failed to edit reply for uninitialized bot:', e));
                    } else {
                        await interaction.reply({ content: 'Bot is still starting up, please try again in a moment.', ephemeral: true }).catch(e => console.error('Failed to reply for uninitialized bot:', e));
                    }
                    return;
                }

                try {
                    // Determine if the reply should be ephemeral based on command
                    let ephemeral = true; // Default to ephemeral
                    if (interaction.isCommand() && interaction.commandName === 'leaderboard') {
                        ephemeral = false; // Make leaderboard public
                    }
                    
                    // Defer reply immediately, but handle potential failure
                    let deferred = false;
                    try {
                        await interaction.deferReply({ ephemeral: ephemeral }); // Use the determined ephemeral value
                        deferred = true;
                    } catch (deferError) {
                        if (deferError.code === 10062) { // Unknown interaction
                            console.warn(`Interaction ${interaction.id} already expired or unknown when deferring. Skipping.`);
                            return; // Stop processing this interaction
                        }
                        console.error(`Error deferring reply for interaction ${interaction.id}:`, deferError);
                    }

                    if (interaction.isCommand()) {
                        const { commandName } = interaction;
                        const command = client.commands.get(commandName);

                        if (!command) {
                            if (deferred) {
                                return interaction.editReply({ content: 'No command matching that name was found.' });
                            } else {
                                return interaction.reply({ content: 'No command matching that name was found.', ephemeral: true });
                            }
                        }

                        const guildConfig = await client.getGuildConfig(interaction.guildId);

                        // Check permissions for karma commands
                        if (['karma_plus', 'karma_minus', 'karma_set'].includes(commandName)) {
                            if (!hasPermission(interaction.member, guildConfig)) {
                                if (deferred) {
                                    return interaction.editReply({ content: 'You do not have permission to use this karma command.' });
                                } else {
                                    return interaction.reply({ content: 'You do not have permission to use this karma command.', ephemeral: true });
                                }
                            }
                        } else { // For other moderation commands
                            if (!hasPermission(interaction.member, guildConfig)) {
                                if (deferred) {
                                    return interaction.editReply({ content: 'You do not have permission to use this command.' });
                                } else {
                                    return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
                                }
                            }
                        }

                        await command.execute(interaction, {
                            getGuildConfig: client.getGuildConfig,
                            saveGuildConfig: client.saveGuildConfig,
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
                            analyzeSentiment: karmaSystem.analyzeSentiment,
                            addKarmaPoints: karmaSystem.addKarmaPoints,
                            subtractKarmaPoints: karmaSystem.subtractKarmaPoints,
                            setKarmaPoints: karmaSystem.setKarmaPoints,
                            client
                        });
                    } else if (interaction.isButton()) {
                        // For buttons, deferUpdate is usually sufficient and handled above.
                        // No specific button logic here for now.
                    }
                } catch (error) {
                    console.error('Error during interaction processing:', error);
                    if (interaction.deferred || interaction.replied) {
                        await interaction.editReply({ content: 'An unexpected error occurred while processing your command.' }).catch(e => console.error('Failed to edit reply after error:', e));
                    } else {
                        await interaction.reply({ content: 'An unexpected error occurred while processing your command.', ephemeral: true }).catch(e => console.error('Failed to reply after error:', e));
                    }
                }
            });
            // End of event listener registrations
        });

        // Log in to Discord with the client's token
        client.login(process.env.DISCORD_BOT_TOKEN).catch(err => {
            console.error("Discord login failed:", err);
            reject(err);
        });
    });
};


// Export the initialization function as the default export
module.exports = initializeAndGetClient;
