// index.js
require('dotenv').config();
const { Client, Collection, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, MessageFlags } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const { initializeApp } = require('firebase/app');
const { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } = require('firebase/auth');
const { getFirestore, doc, getDoc, setDoc, updateDoc, collection, addDoc, query, where, orderBy, limit, startAfter, getDocs } = require('firebase/firestore');
const express = require('express');

// Import helper functions
const { hasPermission, isExempt } = require('./helpers/permissions');
const { logModerationAction, logMessage } = require('./logging/logging');
const karmaSystem = require('./karma/karmaSystem'); // Import the entire karmaSystem module
const autoModeration = require('./automoderation/autoModeration'); // Import the entire autoModeration module
const handleMessageReactionAdd = require('./events/messageReactionAdd'); // Import the event handler

// --- Web Server for Hosting Platforms (e.g., Render) ---
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Karma bot is running and listening for commands!');
});

app.listen(PORT, () => {
    console.log(`Web server listening on port ${PORT}`);
});

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

// Firebase and Google API variables (will be initialized on ready)
let db;
let auth;
let appId;
let userId;
let googleApiKey; // Store Google API Key here

// Attach db, appId, and googleApiKey to client for easy access in modules
client.db = db;
client.appId = appId;
client.googleApiKey = googleApiKey;


// Create a collection to store commands
client.commands = new Collection();

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


// Helper function to get guild-specific config from Firestore
const getGuildConfig = async (guildId) => {
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
            caseNumber: 0
        };
        await setDoc(configRef, defaultConfig);
        return defaultConfig;
    }
};

// Helper function to save guild-specific config to Firestore
const saveGuildConfig = async (guildId, newConfig) => {
    const configRef = doc(client.db, `artifacts/${client.appId}/public/data/guilds/${guildId}/configs`, 'settings');
    await setDoc(configRef, newConfig, { merge: true });
};


// Event: Bot is ready
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    // Initialize Firebase and Google API Key
    try {
        appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        googleApiKey = process.env.GOOGLE_API_KEY || ""; // Get Google API Key

        // Attach to client object
        client.appId = appId;
        client.googleApiKey = googleApiKey;

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
        db = getFirestore(firebaseApp);
        auth = getAuth(firebaseApp);

        // Attach db and auth to client object
        client.db = db;
        client.auth = auth;

        if (typeof __initial_auth_token !== 'undefined') {
            await signInWithCustomToken(auth, __initial_auth_token);
        } else {
            await signInAnonymously(auth);
        }
        userId = auth.currentUser?.uid || crypto.randomUUID();
        console.log(`Firebase initialized. User ID: ${userId}. App ID for Firestore: ${appId}`);

    } catch (firebaseError) {
        console.error('Failed to initialize Firebase:', firebaseError);
        process.exit(1);
    }

    // Register slash commands
    const commands = [];
    client.commands.forEach(command => {
        commands.push(command.data.toJSON());
    });

    // Add the /setup command
    commands.push({
        name: 'setup',
        description: 'Set up Karma bot roles and logging channels.',
        default_member_permissions: PermissionsBitField.Flags.Administrator.toString(),
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

    const guild = message.guild;
    const author = message.author;

    // --- Auto-Moderation Check ---
    // Pass necessary dependencies to autoModeration functions
    await autoModeration.checkMessageForModeration(
        message,
        client,
        getGuildConfig,
        saveGuildConfig,
        isExempt,
        logging.logModerationAction, // Use logging module
        logging.logMessage, // Use logging module
        client.googleApiKey
    );

    // --- Karma System Update ---
    try {
        // Pass necessary dependencies to karmaSystem functions
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
    try {
        if (interaction.isCommand()) {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

            const { commandName } = interaction;

            if (commandName === 'setup') {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return interaction.editReply({ content: 'You must have Administrator permissions to use the `/setup` command.' });
                }

                const embed = new EmbedBuilder()
                    .setTitle('Karma Bot Setup')
                    .setDescription('Welcome to Karma Bot setup! Use the buttons below to configure your server\'s moderation settings.')
                    .addFields(
                        { name: '1. Set Moderator & Admin Roles', value: 'Define which roles can use moderation commands and are exempt from moderation.' },
                        { name: '2. Set Moderation Channels', value: 'Specify channels for moderation logs and deleted message logs.' },
                        { name: '3. Set Auto-Moderation Channels & Role', value: 'Designate a channel for auto-moderation alerts and a role to ping.' }
                    )
                    .setColor(0x0099FF);

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('setup_roles')
                            .setLabel('Set Roles')
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId('setup_channels')
                            .setLabel('Set Log Channels')
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId('setup_auto_mod_channels')
                            .setLabel('Set Auto-Mod Channels')
                            .setStyle(ButtonStyle.Primary),
                    );

                await interaction.editReply({ embeds: [embed], components: [row] });
                return;
            }

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
                logModerationAction: logging.logModerationAction, // Use logging module
                logMessage: logging.logMessage, // Use logging module
                MessageFlags,
                db: client.db, // Pass client's db
                appId: client.appId, // Pass client's appId
                getOrCreateUserKarma: karmaSystem.getOrCreateUserKarma, // Pass karmaSystem functions
                updateUserKarmaData: karmaSystem.updateUserKarmaData,
                calculateAndAwardKarma: karmaSystem.calculateAndAwardKarma,
                analyzeSentiment: karmaSystem.analyzeSentiment,
                client // Pass client for commands that need it (e.g., clearwarning)
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
                    } else if (channels.size === 0 && roles.size === 0) {
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
    // Delegate to the external event handler
    await handleMessageReactionAdd(
        reaction,
        user,
        client, // Pass client directly
        getGuildConfig,
        saveGuildConfig,
        hasPermission,
        isExempt,
        logging.logModerationAction, // Use logging module
        logging.logMessage, // Use logging module
        karmaSystem // Pass the entire karmaSystem module
    );
});


// Log in to Discord with your client's token
client.login(process.env.DISCORD_BOT_TOKEN);
