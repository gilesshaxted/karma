// index.js
require('dotenv').config();
const { Client, Collection, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, MessageFlags } = require('discord.js'); // Added MessageFlags
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const { initializeApp } = require('firebase/app');
const { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } = require('firebase/auth');
const { getFirestore, doc, getDoc, setDoc, updateDoc, collection, addDoc, query, where, orderBy, limit, startAfter, getDocs } = require('firebase/firestore'); // Added Firestore collection, addDoc, query, where, orderBy, limit, startAfter, getDocs
const express = require('express'); // Import express

// --- Web Server for Hosting Platforms (e.g., Render) ---
const app = express();
const PORT = process.env.PORT || 3000; // Define PORT here, before it's used

app.get('/', (req, res) => {
    res.send('Karma bot is running and listening for commands!'); // Basic health check endpoint
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
        GatewayIntentBits.MessageContent, // Required to read message content
        GatewayIntentBits.GuildMessageReactions // Required to read message reactions
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction] // Required for reaction events on uncached messages
});

// Firebase variables (will be initialized on ready)
let db;
let auth;
let appId;
let userId; // To store the authenticated authenticated user ID for Firestore rules

// Create a collection to store commands
client.commands = new Collection();

// Dynamically load command files from the 'moderation' folder
const commandFiles = [
    'warn.js',
    'timeout.js',
    'kick.js',
    'ban.js',
    'warnings.js', // New command
    'warning.js' // New command
];

for (const file of commandFiles) {
    const command = require(`./moderation/${file}`);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
    } else {
        console.log(`[WARNING] The command in ${file} is missing a required "data" or "execute" property.`);
    }
}

// Helper function to get guild-specific config from Firestore
const getGuildConfig = async (guildId) => {
    // Path: artifacts/{appId}/public/data/{guildId}/configs/settings
    const configRef = doc(db, `artifacts/${appId}/public/data/guilds/${guildId}/configs`, 'settings');
    const configSnap = await getDoc(configRef);

    if (configSnap.exists()) {
        return configSnap.data();
    } else {
        // Create a default config if it doesn't exist
        const defaultConfig = {
            modRoleId: null,
            adminRoleId: null,
            moderationLogChannelId: null,
            messageLogChannelId: null,
            caseNumber: 0
        };
        await setDoc(configRef, defaultConfig);
        return defaultConfig;
    }
};

// Helper function to save guild-specific config to Firestore
const saveGuildConfig = async (guildId, newConfig) => {
    // Path: artifacts/{appId}/public/data/{guildId}/configs/settings
    const configRef = doc(db, `artifacts/${appId}/public/data/guilds/${guildId}/configs`, 'settings');
    await setDoc(configRef, newConfig, { merge: true }); // Use merge to update existing fields
};

// Helper function to check if a member has a moderator or admin role
const hasPermission = (member, guildConfig) => {
    if (!guildConfig.adminRoleId && !guildConfig.modRoleId) {
        // If no roles are set, only server administrators can use commands
        return member.permissions.has(PermissionsBitField.Flags.Administrator);
    }

    const isAdmin = guildConfig.adminRoleId && member.roles.cache.has(guildConfig.adminRoleId);
    const isMod = guildConfig.modRoleId && member.roles.cache.has(guildConfig.modRoleId);
    const isServerAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);

    return isAdmin || isMod || isServerAdmin;
};

// Helper function to check if a target user is exempt from moderation
const isExempt = (targetMember, guildConfig) => {
    const isAdmin = guildConfig.adminRoleId && targetMember.roles.cache.has(guildConfig.adminRoleId);
    const isMod = guildConfig.modRoleId && targetMember.roles.cache.has(guildConfig.modRoleId);
    const isBot = targetMember.user.bot; // Bots are generally exempt

    return isAdmin || isMod || isBot;
};

// Helper function to log moderation actions AND store in Firestore
const logModerationAction = async (guild, actionType, targetUser, reason, moderator, caseNumber, duration = null, messageLink = null) => {
    const guildConfig = await getGuildConfig(guild.id); // Fetch latest config
    const logChannelId = guildConfig.moderationLogChannelId;

    // Log to Discord channel
    if (logChannelId) {
        const logChannel = guild.channels.cache.get(logChannelId);
        if (logChannel) {
            const embed = new EmbedBuilder()
                .setTitle(`${targetUser.username} - Case #${caseNumber}`)
                .setDescription(`**Action:** ${actionType}\n**Reason:** ${reason || 'No reason provided.'}`)
                .addFields(
                    { name: 'User', value: `${targetUser.tag} (${targetUser.id})`, inline: true },
                    { name: 'Moderator', value: `${moderator.user.tag} (${moderator.id})`, inline: true }
                )
                .setTimestamp()
                .setColor(0xFFA500); // Orange color for moderation logs

            if (duration) {
                embed.addFields({ name: 'Duration', value: duration, inline: true });
            }
            if (messageLink) {
                embed.addFields({ name: 'Original Message', value: `[Link](${messageLink})`, inline: true });
            }

            await logChannel.send({ embeds: [embed] });
        } else {
            console.error(`Moderation log channel with ID ${logChannelId} not found in guild ${guild.name}.`);
        }
    } else {
        console.log(`Moderation log channel not set for guild ${guild.name}.`);
    }

    // Store in Firestore
    try {
        // Path: artifacts/{appId}/public/data/{guildId}/moderation_records/{recordId}
        const moderationRecordsRef = collection(db, `artifacts/${appId}/public/data/guilds/${guild.id}/moderation_records`);
        await addDoc(moderationRecordsRef, {
            caseNumber: caseNumber,
            actionType: actionType.replace(' (Emoji)', ''), // Remove (Emoji) from actionType for database storage
            targetUserId: targetUser.id,
            targetUserTag: targetUser.tag,
            moderatorId: moderator.id,
            moderatorTag: moderator.user.tag,
            reason: reason,
            duration: duration,
            timestamp: new Date(), // Store as Firestore Timestamp
            messageLink: messageLink
        });
        console.log(`Moderation record for Case #${caseNumber} stored in Firestore.`);
    } catch (error) {
        console.error(`Error storing moderation record for Case #${caseNumber} in Firestore:`, error);
    }
};

// Helper function to log deleted messages
const logMessage = async (guild, message, moderator, actionType) => {
    const guildConfig = await getGuildConfig(guild.id); // Fetch latest config
    const logChannelId = guildConfig.messageLogChannelId;

    if (!logChannelId) {
        console.log(`Message log channel not set for guild ${guild.name}.`);
        return;
    }

    const logChannel = guild.channels.cache.get(logChannelId);
    if (!logChannel) {
        console.error(`Message log channel with ID ${logChannelId} not found in guild ${guild.name}.`);
        return;
    }

    const embed = new EmbedBuilder()
        .setTitle(`Message ${actionType}`)
        .setDescription(`**Content:**\n\`\`\`\n${message.content || 'No content (e.g., embed, attachment only)'}\n\`\`\``)
        .addFields(
            { name: 'Author', value: `${message.author ? message.author.tag : 'Unknown User'} (${message.author ? message.author.id : 'Unknown ID'})`, inline: true },
            { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
            { name: 'Sent At', value: `<t:${Math.floor(message.createdTimestamp / 1000)}:F>`, inline: true },
            { name: 'Moderated By', value: `${moderator ? moderator.user.tag : 'System'}`, inline: true } // Corrected to moderator.user.tag
        )
        .setTimestamp()
        .setColor(0xADD8E6); // Light blue for message logs

    await logChannel.send({ embeds: [embed] });
};


// Event: Bot is ready
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    // Initialize Firebase
    try {
        appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

        // Construct firebaseConfig from individual environment variables
        const firebaseConfig = {
            apiKey: process.env.FIREBASE_API_KEY,
            authDomain: process.env.FIREBASE_AUTH_DOMAIN,
            projectId: process.env.FIREBASE_PROJECT_ID,
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
            messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
            appId: process.env.FIREBASE_APP_ID
        };

        // Check if essential Firebase config values are present
        if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.appId || !firebaseConfig.authDomain) {
            console.error('Missing essential Firebase environment variables. Please check your .env or hosting configuration.');
            process.exit(1); // Exit if Firebase cannot be properly configured
        }

        const firebaseApp = initializeApp(firebaseConfig);
        db = getFirestore(firebaseApp);
        auth = getAuth(firebaseApp);

        // Authenticate with Firebase
        if (typeof __initial_auth_token !== 'undefined') {
            await signInWithCustomToken(auth, __initial_auth_token);
        } else {
            await signInAnonymously(auth);
        }
        userId = auth.currentUser?.uid || crypto.randomUUID();
        console.log(`Firebase initialized. User ID: ${userId}. App ID for Firestore: ${appId}`); // Log appId here

    } catch (firebaseError) {
        console.error('Failed to initialize Firebase:', firebaseError);
        // Exit if Firebase fails to initialize, as it's critical for config
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
        default_member_permissions: PermissionsBitField.Flags.Administrator.toString(), // Only administrators can use this
    });

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

    try {
        console.log('Started refreshing application (/) commands.');

        // Get Discord Application ID from environment variables
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

// Event: Interaction created (for slash commands and buttons)
client.on('interactionCreate', async interaction => {
    if (interaction.isCommand()) {
        const { commandName } = interaction;

        // Defer reply immediately for all slash commands to prevent "Unknown interaction"
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }); // Using flags for ephemeral

        // Handle /setup command
        if (commandName === 'setup') {
            // Check if the user has Administrator permissions
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.editReply({ content: 'You must have Administrator permissions to use the `/setup` command.' });
            }

            const embed = new EmbedBuilder()
                .setTitle('Karma Bot Setup')
                .setDescription('Welcome to Karma Bot setup! Use the buttons below to configure your server\'s moderation settings.')
                .addFields(
                    { name: '1. Set Moderator & Admin Roles', value: 'Define which roles can use moderation commands and are exempt from moderation.' },
                    { name: '2. Set Moderation Channels', value: 'Specify channels for moderation logs and deleted message logs.' }
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
                        .setLabel('Set Channels')
                        .setStyle(ButtonStyle.Primary),
                );

            await interaction.editReply({ embeds: [embed], components: [row] });
            return;
        }

        // Handle other slash commands
        const command = client.commands.get(commandName);

        if (!command) {
            return interaction.editReply({ content: 'No command matching that name was found.' });
        }

        const guildConfig = await getGuildConfig(interaction.guildId); // Await config fetch

        // Check if the command user has permission
        if (!hasPermission(interaction.member, guildConfig)) {
            return interaction.editReply({ content: 'You do not have permission to use this command.' });
        }

        try {
            await command.execute(interaction, {
                getGuildConfig,
                saveGuildConfig, // Pass the updated save function
                hasPermission,
                isExempt,
                logModerationAction,
                logMessage,
                MessageFlags, // Pass MessageFlags to commands
                db, // Pass db instance for new commands
                appId // Pass appId for new commands
            });
        } catch (error) {
            console.error(error);
            // Check if interaction was already replied/deferred to avoid "Unknown interaction" on error reply
            if (interaction.replied || interaction.deferred) {
                await interaction.editReply({ content: 'There was an error while executing this command!' });
            } else {
                // Fallback, though deferReply should prevent this path for slash commands
                await interaction.reply({ content: 'There was an error while executing this command!', flags: [MessageFlags.Ephemeral] });
            }
        }
    } else if (interaction.isButton()) {
        const { customId } = interaction;
        const guildConfig = await getGuildConfig(interaction.guildId); // Await config fetch

        // Defer reply for buttons as well, if they might take time
        await interaction.deferUpdate(); // Use deferUpdate for buttons that don't need a new message

        // Handle pagination buttons for /warnings command
        if (customId.startsWith('warnings_page_')) {
            const [_, action, targetUserId, currentPageStr] = customId.split('_');
            const currentPage = parseInt(currentPage
