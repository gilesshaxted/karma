// automoderation/autoModeration.js
const { EmbedBuilder } = require('discord.js');

/**
 * LLM-powered check for offensive content.
 * @param {string} text - The text to check.
 * @param {string} googleApiKey - The Google API key for Gemini.
 * @returns {Promise<string>} - 'yes' if offensive, 'no' otherwise.
 */
const isContentOffensive = async (text, googleApiKey) => {
    try {
        const chatHistory = [{ role: "user", parts: [{ text: `Is the following text hate speech, a racial slur, homophobic, or otherwise severely offensive? Respond with "yes" or "no".\n\nText: "${text}"` }] }];
        const payload = { contents: chatHistory };
        const apiKey = googleApiKey || "";
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Gemini API offensive content check error: ${response.status} - ${errorText}`);
            return 'no';
        }

        const result = await response.json();
        if (result.candidates && result.candidates.length > 0 &&
            result.candidates[0].content && result.candidates[0].content.parts &&
            result.candidates[0].content.parts.length > 0) {
            const decision = result.candidates[0].content.parts[0].text.toLowerCase().trim();
            return decision === 'yes' ? 'yes' : 'no';
        }
        console.warn('Gemini API offensive content check response structure unexpected or content missing. Falling back to no.');
        return 'no';
    } catch (error) {
        console.error('Error calling Gemini API for offensive content check:', error);
        return 'no';
    }
};

// Regex patterns for specific hate speech/slurs (EMPTY - relying on LLM and keywords)
const hateSpeechRegexes = [];

// Specific keywords for hate speech/slurs
const hateSpeechKeywords = [
    'fag', 'faggot', 'gypsy', 'homo', 'kike', 'nigg', 'nigger', 'retard', 'spic', 'spick', 'yn', 'yns'
];

/**
 * Helper function to send a moderation alert to the designated channel.
 * @param {Guild} guild - The Discord guild.
 * @param {Message} message - The message that was flagged.
 * @param {string} reason - The reason for flagging.
 * @param {User|ClientUser} flaggedBy - The user or bot who flagged the message.
 * @param {string} messageLink - Link to the original message.
 * @param {string} pingRoleId - The ID of the role to ping for alerts.
 * @param {function} getGuildConfig - Function to retrieve guild config.
 */
const sendModAlert = async (guild, message, reason, flaggedBy, messageLink, pingRoleId, getGuildConfig) => {
    const guildConfig = await getGuildConfig(guild.id);
    const alertChannelId = guildConfig.modAlertChannelId;

    if (!alertChannelId) {
        console.log(`Mod alert channel not set for guild ${guild.name}. Cannot send alert.`);
        return;
    }

    const alertChannel = guild.channels.cache.get(alertChannelId);
    if (!alertChannel) {
        console.error(`Mod alert channel with ID ${alertChannelId} not found in guild ${guild.name}. Cannot send alert.`);
        return;
    }

    // Safely get author ID and tag
    let resolvedAuthor = message.author;
    if (resolvedAuthor && resolvedAuthor.partial) {
        try {
            resolvedAuthor = await resolvedAuthor.fetch();
        } catch (err) {
            console.warn(`Could not fetch partial author for message ${message.id} in sendModAlert:`, err);
            resolvedAuthor = null;
        }
    }
    const authorId = resolvedAuthor?.id || 'Unknown ID';
    const authorTag = resolvedAuthor?.tag || 'Unknown User';

    // Safely get channel ID and name
    let resolvedChannel = message.channel;
    if (resolvedChannel && resolvedChannel.partial) {
        try {
            resolvedChannel = await resolvedChannel.fetch();
        } catch (err) {
            console.warn(`Could not fetch partial channel for message ${message.id} in sendModAlert:`, err);
            resolvedChannel = null;
        }
    }
    const channelId = resolvedChannel?.id || 'Unknown Channel ID';
    const channelName = resolvedChannel?.name || 'Unknown Channel';


    const embed = new EmbedBuilder()
        .setTitle('Message Flagged')
        .setDescription(
            `**Channel:** <#${channelId}> (${channelName})\n` +
            `**Author:** <@${authorId}>\n` +
            `**Flag Reason:** ${reason}\n\n[Jump to Message](${messageLink})\n\n**Message Content:**\n\`\`\`\n${message.content || 'No content'}\n\`\`\``
        )
        .setColor(0xFFFF00) // Yellow for alert
        .setTimestamp();

    // Set footer based on who flagged
    const flaggedById = flaggedBy?.id || 'Unknown ID';
    const flaggedByName = flaggedBy?.tag || flaggedBy?.username || 'Unknown User';
    embed.setFooter({ text: `Who Flagged ID: ${flaggedByName} (${flaggedById})` });

    let pingMessage = '';
    if (pingRoleId) {
        const pingRole = guild.roles.cache.get(pingRoleId);
        if (pingRole) {
            pingMessage = `<@&${pingRoleId}>`;
        } else {
            console.warn(`Mod ping role with ID ${pingRoleId} not found in guild ${guild.name}.`);
        }
    } else {
        console.log(`Mod ping role not set for guild ${guild.name}.`);
    }

    await alertChannel.send({ content: pingMessage, embeds: [embed] });
};

/**
 * Main auto-moderation logic function to check messages for offensive content.
 * @param {Message} message - The Discord message to check.
 * @param {Client} client - The Discord client instance (for bot user).
 * @param {function} getGuildConfig - Function to retrieve guild config.
 * @param {function} saveGuildConfig - Function to save guild config.
 * @param {function} isExempt - Function to check if a user is exempt.
 * @param {function} logModerationAction - Function to log moderation actions.
 * @param {function} logMessage - Function to log deleted messages.
 * @param {string} googleApiKey - The Google API key for Gemini.
 */
const checkMessageForModeration = async (message, client, getGuildConfig, saveGuildConfig, isExempt, logModerationAction, logMessage, googleApiKey) => {
    const guild = message.guild;
    const guildConfig = await getGuildConfig(guild.id);
    const author = message.author;

    // Don't moderate bots or exempt users
    const authorMember = await guild.members.fetch(author.id).catch(() => null);
    if (!authorMember || isExempt(authorMember, guildConfig)) {
        return;
    }

    const content = message.content;
    let flaggedReason = null;
    let autoPunish = false; // Flag for immediate punishment

    // 1. Keyword Checks (for definite offenses)
    for (const keyword of hateSpeechKeywords) {
        const keywordRegex = new RegExp(`\\b${keyword}\\b`, 'i');
        if (keywordRegex.test(content)) {
            flaggedReason = `Matched keyword: \`${keyword}\``;
            autoPunish = true;
            break;
        }
    }

    // 2. LLM Check (for general bad language / unsure cases)
    if (!autoPunish) { // Only run LLM if not already flagged by keywords for auto-punishment
        const llmOffensive = await isContentOffensive(content, googleApiKey);
        if (llmOffensive === 'yes') {
            flaggedReason = flaggedReason ? `${flaggedReason} & LLM deemed offensive` : 'LLM deemed offensive';
            autoPunish = true;
        }
    }

    if (flaggedReason) {
        const messageLink = `https://discord.com/channels/${guild.id}/${message.channel?.id || 'Unknown Channel ID'}/${message.id}`;

        if (autoPunish) {
            const timeoutDurationMinutes = 10;
            const timeoutReason = `Auto-moderation: ${flaggedReason}`;

            try {
                guildConfig.caseNumber++;
                await saveGuildConfig(guild.id, guildConfig);
                const caseNumber = guildConfig.caseNumber;

                await authorMember.timeout(timeoutDurationMinutes * 60 * 1000, timeoutReason);
                await message.delete().catch(console.error);
                await logMessage(guild, message, client.user, 'Auto-Deleted', getGuildConfig); // Pass getGuildConfig

                const dmEmbed = new EmbedBuilder()
                    .setTitle('You have been automatically timed out!')
                    .setDescription(`Your message in **${guild.name}** was flagged by auto-moderation for violating server rules.`)
                    .addFields(
                        { name: 'Reason', value: timeoutReason },
                        { name: 'Duration', value: `${timeoutDurationMinutes} minutes` }
                    )
                    .setColor(0xFF0000)
                    .setTimestamp();
                await author.send({ embeds: [dmEmbed] }).catch(console.error);

                await logModerationAction(guild, `Auto-Timeout (${timeoutDurationMinutes}m)`, author, timeoutReason, client.user, caseNumber, `${timeoutDurationMinutes}m`, messageLink, getGuildConfig, client.db, client.appId); // Pass db, appId
                console.log(`Auto-timed out ${author.tag} for: ${timeoutReason}`);
            } catch (error) {
                console.error(`Error during auto-timeout for ${author.tag}:`, error);
                await sendModAlert(guild, message, `Failed auto-punishment: ${flaggedReason}`, client.user, messageLink, guildConfig.modPingRoleId, getGuildConfig); // Pass getGuildConfig
            }
        } else {
            await sendModAlert(guild, message, flaggedReason, client.user, messageLink, guildConfig.modPingRoleId, getGuildConfig); // Pass getGuildConfig
        }
    }
};

module.exports = {
    isContentOffensive,
    hateSpeechRegexes,
    hateSpeechKeywords,
    sendModAlert,
    checkMessageForModeration
};
