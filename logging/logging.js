// logging/logging.js
const { EmbedBuilder } = require('discord.js');
// No direct Firestore imports needed here as getGuildConfig and saveGuildConfig are accessed via client.

/**
 * Logs a moderation action to the configured moderation log channel.
 * @param {string} actionType - Type of action (e.g., 'Warning', 'Timeout', 'Kick', 'Ban').
 * @param {Guild} guild - The guild where the action occurred.
 * @param {User} targetUser - The user who was targeted by the action.
 * @param {User} moderator - The user who performed the action (bot or human).
 * @param {string} reason - The reason for the action.
 * @param {Client} client - The Discord client instance (contains getGuildConfig and saveGuildConfig).
 * @returns {number|null} The new case number if logging was successful, otherwise null.
 */
const logModerationAction = async (actionType, guild, targetUser, moderator, reason, client) => {
    try {
        // Access getGuildConfig and saveGuildConfig directly from the client object
        const getGuildConfig = client.getGuildConfig;
        const saveGuildConfig = client.saveGuildConfig;

        if (typeof getGuildConfig !== 'function') {
            console.error(`[LOGGING ERROR] getGuildConfig is not a function on client object. It might not be attached yet or is undefined.`);
            return null;
        }
        if (typeof saveGuildConfig !== 'function') {
            console.error(`[LOGGING ERROR] saveGuildConfig is not a function on client object. It might not be attached yet or is undefined.`);
            return null;
        }

        const guildConfig = await getGuildConfig(guild.id);
        
        // Increment case number BEFORE sending the log, so the log reflects the new number
        const newCaseNumber = (guildConfig.caseNumber || 0) + 1;
        await saveGuildConfig(guild.id, { caseNumber: newCaseNumber });

        const logChannelId = guildConfig.moderationLogChannelId;

        if (!logChannelId) {
            console.warn(`[LOGGING WARNING] No moderation log channel configured for guild ${guild.name}. Case #${newCaseNumber} logged internally.`);
            return newCaseNumber; // Still return case number even if no channel
        }

        const logChannel = guild.channels.cache.get(logChannelId);
        if (!logChannel) {
            console.warn(`[LOGGING WARNING] Configured moderation log channel (${logChannelId}) not found in guild ${guild.name}. Case #${newCaseNumber} logged internally.`);
            return newCaseNumber; // Still return case number even if channel not found
        }

        const embed = new EmbedBuilder()
            .setColor('#FFD700') // Gold color for logs
            .setTitle(`${actionType} | Case #${newCaseNumber}`) // Use the new case number
            .addFields(
                { name: 'User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
                { name: 'Moderator', value: `${moderator.tag} (<@${moderator.id}>)`, inline: true },
                { name: 'Reason', value: reason || 'No reason provided.' },
                { name: 'Timestamp', value: new Date().toLocaleString() }
            )
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .setFooter({ text: `User ID: ${targetUser.id}` })
            .setTimestamp();

        await logChannel.send({ embeds: [embed] }).catch(console.error);
        
        return newCaseNumber; // Return the case number

    } catch (error) {
        console.error(`[LOGGING ERROR] Failed to log moderation action to Discord channel:`, error);
        return null; // Return null on error
    }
};

/**
 * Logs a general message to the configured message log channel.
 * @param {Message} message - The message object to log.
 * @param {Client} client - The Discord client instance (contains getGuildConfig). // Changed parameter
 */
const logMessage = async (message, client) => { // Changed parameter
    // Access getGuildConfig directly from the client object
    const getGuildConfig = client.getGuildConfig;

    if (typeof getGuildConfig !== 'function') {
        console.error(`[LOGGING ERROR] getGuildConfig is not a function on client object in logMessage.`);
        return;
    }
    // This function can be expanded to log message updates/deletions to a channel
    // For now, it primarily serves to log to console for debugging or internal tracking.
    // console.log(`[MESSAGE LOG] Message in ${message.guild.name} from ${message.author.tag}: ${message.content}`);
};

module.exports = {
    logModerationAction,
    logMessage
};
