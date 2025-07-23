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

// Dynamically load command files from the 'moderation' and 'karma' folders
const moderationCommandFiles = [
    'warn.js',
    'timeout.js',
    'kick.js',
    'ban.js',
    'warnings.js', // New command
    'warning.js' // New command
];

const karmaCommandFiles = [
    'karma.js', // New karma command
    'leaderboard.js' // New leaderboard command
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
    const command = require(`./karma/${file}`); // Load from new karma folder
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
    } else {
        console.log(`[WARNING] The karma command in ${file} is missing a required "data" or "execute" property.`);
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

// Helper function to get or create a user's karma document
const getOrCreateUserKarma = async (guildId, userId) => {
    const karmaRef = doc(db, `artifacts/${appId}/public/data/guilds/${guildId}/karma_users`, userId);
    const karmaSnap = await getDoc(karmaRef);

    if (karmaSnap.exists()) {
        const data = karmaSnap.data();
        // Ensure dates are Date objects, converting from Firestore Timestamp if necessary
        if (data.lastActivityDate && typeof data.lastActivityDate.toDate === 'function') {
            data.lastActivityDate = data.lastActivityDate.toDate();
        }
        if (data.lastKarmaCalculationDate && typeof data.lastKarmaCalculationDate.toDate === 'function') {
            data.lastKarmaCalculationDate = data.lastKarmaCalculationDate.toDate();
        }
        return data;
    } else {
        const defaultKarma = {
            userId: userId,
            karmaPoints: 0,
            messagesToday: 0,
            repliesReceivedToday: 0,
            reactionsReceivedToday: 0,
            lastActivityDate: new Date(),
            lastKarmaCalculationDate: new Date()
        };
        await setDoc(karmaRef, defaultKarma);
        return defaultKarma;
    }
};

// Helper function to update user karma data
const updateUserKarmaData = async (guildId, userId, data) => {
    const karmaRef = doc(db, `artifacts/${appId}/public/data/guilds/${guildId}/karma_users`, userId);
    await updateDoc(karmaRef, data);
};

// Helper function to check if a user has any moderation actions in the last 24 hours
const hasRecentModeration = async (guildId, userIdToCheck) => {
    const twentyFourHoursAgo = new Date(Date.now() - (24 * 60 * 60 * 1000));
    const moderationRecordsRef = collection(db, `artifacts/${appId}/public/data/guilds/${guildId}/moderation_records`);
    const q = query(
        moderationRecordsRef,
        where("targetUserId", "==", userIdToCheck),
        where("timestamp", ">=", twentyFourHoursAgo),
        limit(1) // Just need to find one to know if they have recent moderation
    );
    const querySnapshot = await getDocs(q);
    return !querySnapshot.empty;
};


// Helper function to calculate and award karma
const calculateAndAwardKarma = async (guild, user, karmaData) => {
    let karmaAwarded = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of day

    // Ensure lastKarmaCalculationDate is a Date object
    const lastCalcDate = karmaData.lastKarmaCalculationDate instanceof Date ? karmaData.lastKarmaCalculationDate : new Date(karmaData.lastKarmaCalculationDate);
    lastCalcDate.setHours(0, 0, 0, 0);

    // Check for recent moderation actions for this user
    const hasModerationRecently = await hasRecentModeration(guild.id, user.id);
    if (hasModerationRecently) {
        console.log(`${user.tag} has recent moderation, skipping karma gain.`);
        // Reset daily counters even if no karma is awarded due to moderation
        if (today.getTime() > lastCalcDate.getTime()) {
            await updateUserKarmaData(guild.id, user.id, {
                messagesToday: 0,
                repliesReceivedToday: 0,
                reactionsReceivedToday: 0,
                lastKarmaCalculationDate: new Date()
            });
        }
        return 0; // No karma awarded if recently moderated
    }

    // Only calculate if a new day has passed since last calculation
    if (today.getTime() > lastCalcDate.getTime()) {
        // Activity Karma
        if (karmaData.messagesToday >= 100) {
            karmaAwarded += 2; // Hyper active
            console.log(`Awarded 2 karma to ${user.tag} for hyper activity.`);
        } else if (karmaData.messagesToday >= 20) {
            karmaAwarded += 1; // Active
            console.log(`Awarded 1 karma to ${user.tag} for activity.`);
        }

        // Interaction Karma
        if (karmaData.repliesReceivedToday >= 10) {
            karmaAwarded += Math.floor(karmaData.repliesReceivedToday / 10);
            console.log(`Awarded ${Math.floor(karmaData.repliesReceivedToday / 10)} karma to ${user.tag} for replies.`);
        }
        if (karmaData.reactionsReceivedToday >= 10) {
            karmaAwarded += Math.floor(karmaData.reactionsReceivedToday / 10);
            console.log(`Awarded ${Math.floor(karmaData.reactionsReceivedToday / 10)} karma to ${user.tag} for reactions.`);
        }

        // Reset daily counters and update karma points
        await updateUserKarmaData(guild.id, user.id, {
            karmaPoints: karmaData.karmaPoints + karmaAwarded,
            messagesToday: 0,
            repliesReceivedToday: 0,
            reactionsReceivedToday: 0,
            lastKarmaCalculationDate: new Date() // Update last calculation date to today
        });
        console.log(`Karma for ${user.tag} updated. Total: ${karmaData.karmaPoints + karmaAwarded}`);
    } else {
        console.log(`No new karma calculation for ${user.tag} today.`);
    }
    return karmaAwarded;
};

// Placeholder for AI sentiment analysis
const analyzeSentiment = async (text) => {
    // This is a placeholder. In a real scenario, you would make an API call to an LLM
    // like Google's Gemini API here to get a sentiment score.
    // For example:
    /*
    let chatHistory = [];
    chatHistory.push({ role: "user", parts: [{ text: `Analyze the sentiment of the following text and return "positive", "neutral", or "negative":\n\n${text}` }] });
    const payload = { contents: chatHistory };
    const apiKey = ""; // If you want to use models other than gemini-2.0-flash, provide an API key here.
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const response = await fetch(apiUrl, {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify(payload)
           });
    const result = await response.json();
    if (result.candidates && result.candidates.length > 0 && result.candidates[0].content && result.candidates[0].content.parts && result.candidates[0].content.parts.length > 0) {
      const sentiment = result.candidates[0].content.parts[0].text.toLowerCase();
      return sentiment;
    }
    */
    // For now, a very simple heuristic:
    const negativeKeywords = ['bad', 'hate', 'stupid', 'idiot', 'negative', 'terrible', 'awful', 'no', 'not', 'fuck', 'shit', 'crap'];
    const lowerText = text.toLowerCase();
    for (const keyword of negativeKeywords) {
        if (lowerText.includes(keyword)) {
            return 'negative';
        }
    }
    return 'positive'; // Default to positive if no negative keywords
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

    // Determine moderator tag correctly
    const moderatorTag = moderator.user ? moderator.user.tag : moderator.tag;

    // Log to Discord channel
    if (logChannelId) {
        const logChannel = guild.channels.cache.get(logChannelId);
        if (logChannel) {
            const embed = new EmbedBuilder()
                .setTitle(`${targetUser.username} - Case #${caseNumber}`)
                .setDescription(`**Action:** ${actionType}\n**Reason:** ${reason || 'No reason provided.'}`)
                .addFields(
                    { name: 'User', value: `${targetUser.tag} (${targetUser.id})`, inline: true },
                    { name: 'Moderator', value: `${moderatorTag} (${moderator.id})`, inline: true } // Corrected moderator tag access
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
            moderatorTag: moderatorTag, // Corrected moderator tag storage
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

    // Determine moderator tag correctly
    const moderatorTag = moderator.user ? moderator.user.tag : moderator.tag;

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
            { name: 'Moderated By', value: `${moderatorTag}`, inline: true } // Corrected moderator tag access
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

// Event: Message Creation (for Karma system)
client.on('messageCreate', async message => {
    // Ignore bot messages and DMs
    if (message.author.bot || !message.guild) return;

    const guild = message.guild;
    const author = message.author;

    try {
        // Update author's message count and last activity
        const authorKarmaData = await getOrCreateUserKarma(guild.id, author.id);
        await updateUserKarmaData(guild.id, author.id, {
            messagesToday: (authorKarmaData.messagesToday || 0) + 1,
            lastActivityDate: new Date()
        });
        await calculateAndAwardKarma(guild, author, { ...authorKarmaData, messagesToday: (authorKarmaData.messagesToday || 0) + 1 }); // Pass updated messagesToday for immediate calc

        // If it's a reply, track replies received by the original author
        if (message.reference && message.reference.messageId) {
            const repliedToMessage = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
            if (repliedToMessage && !repliedToMessage.author.bot && repliedToMessage.author.id !== author.id) {
                const repliedToAuthor = repliedToMessage.author;
                const repliedToKarmaData = await getOrCreateUserKarma(guild.id, repliedToAuthor.id);

                // Sentiment analysis for replies
                const sentiment = await analyzeSentiment(message.content);
                if (sentiment === 'negative') {
                    console.log(`Negative reply sentiment detected for message from ${author.tag} to ${repliedToAuthor.tag}. Skipping karma gain for reply.`);
                } else {
                    await updateUserKarmaData(guild.id, repliedToAuthor.id, {
                        repliesReceivedToday: (repliedToKarmaData.repliesReceivedToday || 0) + 1,
                        lastActivityDate: new Date()
                    });
                    await calculateAndAwardKarma(guild, repliedToAuthor, { ...repliedToKarmaData, repliesReceivedToday: (repliedToKarmaData.repliesReceivedToday || 0) + 1 });
                }
            }
        }
    } catch (error) {
        console.error(`Error in messageCreate karma tracking for ${author.tag}:`, error);
    }
});


// Event: Interaction created (for slash commands and buttons)
client.on('interactionCreate', async interaction => {
    // Wrap the entire interaction processing in a try-catch to prevent unhandled rejections
    // and ensure deferReply is attempted even if subsequent logic fails.
    try {
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

            await command.execute(interaction, {
                getGuildConfig,
                saveGuildConfig, // Pass the updated save function
                hasPermission,
                isExempt,
                logModerationAction,
                logMessage,
                MessageFlags, // Pass MessageFlags to commands
                db, // Pass db instance for new commands
                appId, // Pass appId for new commands
                getOrCreateUserKarma, // Pass karma helpers
                updateUserKarmaData,
                calculateAndAwardKarma,
                analyzeSentiment
            });
        } else if (interaction.isButton()) {
            const { customId } = interaction;
            const guildConfig = await getGuildConfig(interaction.guildId); // Await config fetch

            // Defer reply for buttons as well, if they might take time
            await interaction.deferUpdate(); // Use deferUpdate for buttons that don't need a new message

            // Handle pagination buttons for /warnings command
            if (customId.startsWith('warnings_page_')) {
                const [_, action, targetUserId, currentPageStr] = customId.split('_');
                const currentPage = parseInt(currentPageStr);
                const targetUser = await client.users.fetch(targetUserId);

                const warningsCommand = client.commands.get('warnings');
                if (warningsCommand) {
                    await warningsCommand.handlePagination(interaction, targetUser, action, currentPage, { db, appId, MessageFlags });
                }
                return;
            }


            if (customId === 'setup_roles') {
                await interaction.followUp({ content: 'Please mention the Moderator role and then the Administrator role (e.g., `@Moderator @Administrator`). Type `none` if you don\'t have one of them.', flags: [MessageFlags.Ephemeral] });

                const filter = m => m.author.id === interaction.user.id;
                const collector = interaction.channel.createMessageCollector({ filter, time: 60000 }); // 60 seconds to respond

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
                    await saveGuildConfig(interaction.guildId, guildConfig); // Await save

                    await interaction.followUp({ content: `Moderator role set to: ${modRole ? modRole.name : 'None'}\nAdministrator role set to: ${adminRole ? adminRole.name : 'None'}`, flags: [MessageFlags.Ephemeral] });
                    collector.stop();
                    m.delete().catch(console.error); // Delete the user's message
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
                    await saveGuildConfig(interaction.guildId, guildConfig); // Await save

                    await interaction.followUp({ content: `Moderation Log Channel set to: ${modLogChannel ? modLogChannel.name : 'None'}\nMessage Log Channel set to: ${msgLogChannel ? msgLogChannel.name : 'None'}`, flags: [MessageFlags.Ephemeral] });
                    collector.stop();
                    m.delete().catch(console.error); // Delete the user's message
                });

                collector.on('end', collected => {
                    if (collected.size === 0) {
                        interaction.followUp({ content: 'You did not respond in time. Channel setup cancelled.', flags: [MessageFlags.Ephemeral] }).catch(console.error);
                    }
                });
            }
        }
    } catch (error) {
        console.error('Error during interaction processing:', error);
        // Attempt to edit reply if it was deferred, otherwise reply ephemerally
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: 'An unexpected error occurred while processing your command.' }).catch(e => console.error('Failed to edit reply after error:', e));
        } else {
            await interaction.reply({ content: 'An unexpected error occurred while processing your command.', flags: [MessageFlags.Ephemeral] }).catch(e => console.error('Failed to reply after error:', e));
        }
    }
});

// Event: Message reaction added (for emoji moderation)
client.on('messageReactionAdd', async (reaction, user) => {
    // Ignore bot reactions and DMs
    if (user.bot || !reaction.message.guild) return;

    // When a reaction is received, check if the structure is partial
    if (reaction.partial) {
        // If the message this reaction belongs to was removed from the cache,
        // fetch it now.
        try {
            await reaction.fetch();
        } catch (error) {
            console.error('Something went wrong when fetching the message:', error);
            return;
        }
    }

    const message = reaction.message;
    const guild = message.guild;
    const reactorMember = await guild.members.fetch(user.id);
    const guildConfig = await getGuildConfig(guild.id);

    // Check if the reactor has permission
    if (!hasPermission(reactorMember, guildConfig)) {
        // If user doesn't have permission, remove their reaction
        return reaction.users.remove(user.id).catch(console.error);
    }

    const targetMember = await guild.members.fetch(message.author.id).catch(() => null);
    if (!targetMember) {
        console.log(`Could not fetch target member ${message.author.id}.`);
        // Still remove the reaction even if target member can't be fetched
        return reaction.users.remove(user.id).catch(console.error);
    }

    // Check if the target user is exempt
    if (isExempt(targetMember, guildConfig)) {
        // If target is exempt, remove the reaction
        return reaction.users.remove(user.id).catch(console.error);
    }

    // Reason should simply be the message content
    const reason = `"${message.content || 'No message content'}" from channel <#${message.channel.id}>`;
    let actionTypeForDB = ''; // To store the action type without " (Emoji)"
    let actionTaken = false;
    let duration = null; // For timeout/ban records
    const messageLink = `https://discord.com/channels/${guild.id}/${message.channel.id}/${message.id}`;

    // Increment case number and save before action
    guildConfig.caseNumber++;
    await saveGuildConfig(guild.id, guildConfig);
    const caseNumber = guildConfig.caseNumber;

    switch (reaction.emoji.name) {
        case '⚠️': // Warning emoji
            try {
                const warnCommand = client.commands.get('warn');
                if (warnCommand) {
                    actionTypeForDB = 'Warning';
                    await warnCommand.executeEmoji(message, targetMember, reason, reactorMember, caseNumber, { logModerationAction, logMessage, duration, messageLink }); // Pass duration and messageLink
                    actionTaken = true;
                }
            } catch (error) {
                console.error('Error during emoji warn:', error);
            }
            break;
        case '⏰': // Alarm clock emoji (default timeout 1 hour)
            try {
                const timeoutCommand = client.commands.get('timeout');
                if (timeoutCommand) {
                    actionTypeForDB = 'Timeout';
                    duration = '1h'; // Default timeout duration
                    // Pass 60 minutes for default timeout
                    await timeoutCommand.executeEmoji(message, targetMember, 60, reason, reactorMember, caseNumber, { logModerationAction, logMessage, duration, messageLink }); // Pass duration and messageLink
                    actionTaken = true;
                }
            } catch (error) {
                console.error('Error during emoji timeout:', error);
            }
            break;
        case '👢': // Boot emoji (kick)
            try {
                const kickCommand = client.commands.get('kick');
                if (kickCommand) {
                    actionTypeForDB = 'Kick';
                    await kickCommand.executeEmoji(message, targetMember, reason, reactorMember, caseNumber, { logModerationAction, logMessage, duration, messageLink }); // Pass duration and messageLink
                    actionTaken = true;
                }
            } catch (error) {
                console.error('Error during emoji kick:', error);
            }
            break;
    }

    // If an action was taken, delete the original message AND the reaction
    if (actionTaken) {
        try {
            // Ensure the message is not already deleted
            if (message.deletable) {
                await message.delete();
                console.log(`Message deleted after emoji moderation: ${message.id}`);
            }
            // Remove the user's reaction after successful moderation
            await reaction.users.remove(user.id).catch(console.error);
        } catch (error) {
            console.error(`Failed to delete message ${message.id} or reaction:`, error);
        }
    }
});

// Event: Message Reaction Added (for Karma system)
client.on('messageReactionAdd', async (reaction, user) => {
    // Ignore bot reactions, DMs, or reactions from the message author themselves
    if (user.bot || !reaction.message.guild || reaction.message.author.id === user.id) return;

    // Fetch full reaction if partial
    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            console.error('Something went wrong when fetching the reaction:', error);
            return;
        }
    }

    const message = reaction.message;
    const guild = message.guild;
    const originalAuthor = message.author;

    try {
        const originalAuthorKarmaData = await getOrCreateUserKarma(guild.id, originalAuthor.id);
        await updateUserKarmaData(guild.id, originalAuthor.id, {
            reactionsReceivedToday: (originalAuthorKarmaData.reactionsReceivedToday || 0) + 1,
            lastActivityDate: new Date()
        });
        await calculateAndAwardKarma(guild, originalAuthor, { ...originalAuthorKarmaData, reactionsReceivedToday: (originalAuthorKarmaData.reactionsReceivedToday || 0) + 1 });
    } catch (error) {
        console.error(`Error in messageReactionAdd karma tracking for ${originalAuthor.tag}:`, error);
    }
});


// Log in to Discord with your client's token
client.login(process.env.DISCORD_BOT_TOKEN);
