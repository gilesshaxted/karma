// automoderation/automoderation.js - Rule-based moderation system
const { PermissionsBitField, EmbedBuilder } = require('discord.js');

const wordLists = {
    high: [
        // A comprehensive list of curse words, slurs, and hate speech
        'fuck', 'shit', 'cunt', 'bitch', 'asshole', 'nigger', 'faggot', 'retard',
        'chink', 'gook', 'pussy', 'dick', 'cock', 'whore', 'slut', 'tranny', 'spic',
        'wetback', 'kike', 'dyke', 'hate speech', 'kill yourself', 'kys'
    ],
    medium: [
        // A more targeted list focused on severe hate speech
        'nigger', 'faggot', 'retard', 'chink', 'gook', 'kike', 'dyke',
        'kill yourself', 'kys', 'hate speech', 'tranny'
    ],
    low: [
        // A very minimal list of only the most severe slurs
        'nigger', 'faggot', 'kike'
    ]
};

// Map to store user warnings and timeouts
const userWarnings = new Map();
const userTimeouts = new Map();

/**
 * Checks a message against the configured auto-moderation rules.
 * @param {Message} message - The message to check.
 * @param {Client} client - The Discord client.
 * @param {Function} getGuildConfig - Function to get guild config.
 * @param {Function} saveGuildConfig - Function to save guild config.
 * @param {Function} isExempt - Function to check if a member/channel is immune.
 * @param {Function} logModerationAction - Function to log moderation actions.
 * @returns {Promise<boolean>} - True if the message was moderated, false otherwise.
 */
const checkMessageForModeration = async (message, client, getGuildConfig, saveGuildConfig, isExempt, logModerationAction) => {
    // Do not moderate if the author is a bot or is exempt
    if (message.author.bot || isExempt(message.member, await getGuildConfig(message.guild.id), message.channel.id)) {
        return false;
    }

    const guildConfig = await getGuildConfig(message.guild.id);
    const infraction = await getInfraction(message, guildConfig);

    if (infraction) {
        try {
            // Delete the message
            await message.delete();

            // Send a warning to the user
            const warningMessage = `Your message was flagged for: **${infraction.reason}**. Repeated violations will result in a timeout.`;
            await message.channel.send(`<@${message.author.id}>, ${warningMessage}`);

            // Log the moderation action
            await logModerationAction(message.guild, 'Automoderation', infraction.reason, message.author, message.author, {
                messageContent: message.content
            });
            
            // Check for warnings and timeouts
            await handleInfractions(message.guild, message.author, client, getGuildConfig);

            return true;
        } catch (error) {
            console.error(`Failed to apply moderation action for ${message.author.tag}:`, error);
        }
    }
    
    return false;
};

/**
 * Checks a message for any infractions based on the guild's configuration.
 * @param {Message} message - The message to check.
 * @param {Object} guildConfig - The guild's configuration.
 * @returns {Promise<{reason: string}|null>} - The infraction reason or null if no infraction.
 */
const getInfraction = async (message, guildConfig) => {
    const content = message.content;
    const authorId = message.author.id;
    const guildId = message.guild.id;

    // --- Check Word-based Filters (Blacklist, Whitelist, Tiers) ---
    const tierWords = guildConfig.moderationTier ? wordLists[guildConfig.moderationTier] : [];
    const blacklistedWords = guildConfig.blacklistedWords ? guildConfig.blacklistedWords.split(',').map(w => w.trim().toLowerCase()) : [];
    const whitelistedWords = guildConfig.whitelistedWords ? guildConfig.whitelistedWords.split(',').map(w => w.trim().toLowerCase()) : [];

    // Check against whitelisted words first (they override all other rules)
    if (whitelistedWords.some(word => content.toLowerCase().includes(word))) {
        return null; // Whitelisted, no infraction
    }

    // Check against blacklisted words
    if (blacklistedWords.some(word => content.toLowerCase().includes(word))) {
        return { reason: 'Blacklisted word detected.' };
    }

    // Check against moderation tier words
    if (tierWords.some(word => content.toLowerCase().includes(word))) {
        return { reason: `Content flagged by moderation tier: ${guildConfig.moderationTier}.` };
    }
    
    // --- Check other message filters ---
    // Repeated Text
    if (guildConfig.repeatedTextToggle) {
        const lastMessage = await message.channel.messages.fetch({ limit: 2 }).then(messages => messages.last());
        if (lastMessage && lastMessage.author.id === authorId && lastMessage.content.trim() === content.trim()) {
            return { reason: 'Repeated text detected.' };
        }
    }

    // Spam Detection
    if (guildConfig.spamDetectionToggle && guildConfig.spamMessageCount && guildConfig.spamTimeframe) {
        const messages = await message.channel.messages.fetch({ limit: parseInt(guildConfig.spamMessageCount, 10) });
        const recentMessages = messages.filter(m => 
            m.author.id === authorId && (message.createdTimestamp - m.createdTimestamp) < (parseInt(guildConfig.spamTimeframe, 10) * 1000)
        );
        if (recentMessages.size >= parseInt(guildConfig.spamMessageCount, 10)) {
            return { reason: 'Spam detected (sending too many messages in a short period).' };
        }
    }

    // External Links
    if (guildConfig.externalLinksToggle) {
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        if (urlRegex.test(content)) {
            return { reason: 'External links are not allowed.' };
        }
    }

    // Discord Invites
    if (guildConfig.discordInvitesToggle) {
        const inviteRegex = /(discord\.gg\/[a-zA-Z0-9]+|discord\.com\/invite\/[a-zA-Z0-9]+)/g;
        if (inviteRegex.test(content)) {
            return { reason: 'Discord invite links are not allowed.' };
        }
    }

    // Excessive Emojis
    if (guildConfig.excessiveEmojiToggle && guildConfig.excessiveEmojiCount) {
        const emojiRegex = /<a?:.+?:\d+>|[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
        const emojiCount = (content.match(emojiRegex) || []).length;
        if (emojiCount > parseInt(guildConfig.excessiveEmojiCount, 10)) {
            return { reason: 'Excessive use of emojis detected.' };
        }
    }

    // Excessive Mentions
    if (guildConfig.excessiveMentionsToggle && guildConfig.excessiveMentionsCount) {
        if (message.mentions.users.size > parseInt(guildConfig.excessiveMentionsCount, 10) || message.mentions.roles.size > parseInt(guildConfig.excessiveMentionsCount, 10)) {
            return { reason: 'Excessive mentions detected.' };
        }
    }

    // Excessive Caps
    if (guildConfig.excessiveCapsToggle && guildConfig.excessiveCapsPercentage) {
        const textWithoutSpaces = content.replace(/\s/g, '');
        if (textWithoutSpaces.length > 20) { // Only check longer messages
            const uppercaseCount = (textWithoutSpaces.match(/[A-Z]/g) || []).length;
            const uppercasePercentage = (uppercaseCount / textWithoutSpaces.length) * 100;
            if (uppercasePercentage > parseInt(guildConfig.excessiveCapsPercentage, 10)) {
                return { reason: 'Excessive use of capital letters detected.' };
            }
        }
    }
    
    return null;
};

/**
 * Handles user infractions by applying warnings and timeouts.
 * @param {Guild} guild - The guild object.
 * @param {User} user - The user who committed the infraction.
 * @param {Client} client - The Discord client.
 * @param {Function} getGuildConfig - Function to get guild config.
 */
const handleInfractions = async (guild, user, client, getGuildConfig) => {
    const guildId = guild.id;
    const userId = user.id;

    // Initialize userWarnings for the user if it doesn't exist
    if (!userWarnings.has(userId)) {
        userWarnings.set(userId, []);
    }
    const warnings = userWarnings.get(userId);

    // Add a new warning with a timestamp
    warnings.push(Date.now());

    // Filter out old warnings (older than 1 hour)
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    const recentWarnings = warnings.filter(timestamp => timestamp > oneHourAgo);
    userWarnings.set(userId, recentWarnings);

    // Check if the user has 3 or more warnings in the last hour
    if (recentWarnings.length >= 3) {
        const member = await guild.members.fetch(userId);
        if (member) {
            try {
                // Timeout for 6 hours
                await member.timeout(6 * 60 * 60 * 1000, 'Repeated warnings from automoderation');
                
                // Log the timeout
                await logModerationAction(guild, 'Timeout', 'Repeated warnings from automoderation', user, client.user, { duration: '6 hours' });

                // Update the user's timeout history
                if (!userTimeouts.has(userId)) {
                    userTimeouts.set(userId, []);
                }
                const timeouts = userTimeouts.get(userId);
                timeouts.push(Date.now());
                
                // Clear recent warnings after a timeout is issued
                userWarnings.set(userId, []);
                
                // Check if the user has 5 timeouts in the last month
                const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
                const recentTimeouts = timeouts.filter(timestamp => timestamp > oneMonthAgo);
                userTimeouts.set(userId, recentTimeouts);

                if (recentTimeouts.length >= 5) {
                    await member.timeout(7 * 24 * 60 * 60 * 1000, 'Repeated timeouts from automoderation');
                    await logModerationAction(guild, 'Timeout', 'Repeated timeouts from automoderation', user, client.user, { duration: '7 days' });

                    const guildConfig = await getGuildConfig(guild.id);
                    if (guildConfig.modAlertChannelId) {
                        const alertChannel = guild.channels.cache.get(guildConfig.modAlertChannelId);
                        if (alertChannel) {
                            const embed = new EmbedBuilder()
                                .setColor('#FFD700')
                                .setTitle('Automoderation Alert')
                                .setDescription(`User ${user.tag} has been timed out for 7 days due to excessive moderation warnings and timeouts.`)
                                .addFields(
                                    { name: 'User', value: `<@${user.id}>`, inline: true },
                                    { name: 'Reason', value: 'Repeated violations' },
                                    { name: 'Action', value: '7-day timeout' }
                                )
                                .setTimestamp();
                            alertChannel.send({ embeds: [embed] });
                        }
                    }
                }
                
            } catch (error) {
                console.error(`Failed to timeout user ${user.tag}:`, error);
            }
        }
    }
};

module.exports = {
    checkMessageForModeration,
    getInfraction
};
