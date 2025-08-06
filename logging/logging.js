// logging/logging.js
const { EmbedBuilder } = require('discord.js');
// No direct Firestore imports needed here as getGuildConfig and saveGuildConfig are passed directly.

/**
 * Logs a moderation action to the configured moderation log channel.
 * @param {string} actionType - Type of action (e.g., 'Warning', 'Timeout', 'Kick', 'Ban').
 * @param {Guild} guild - The guild where the action occurred.
 * @param {User} targetUser - The user who was targeted by the action.
 * @param {User} moderator - The user who performed the action (bot or human).
 * @param {string} reason - The reason for the action.
 * @param {Client} client - The Discord client instance (can be used for other client-specific properties if needed). // Kept for flexibility
 * @param {Function} getGuildConfig - Function to get the guild's config.
 * @param {Function} saveGuildConfig - Function to save the guild's config.
 */
const logModerationAction = async (actionType, guild, targetUser, moderator, reason, client, getGuildConfig, saveGuildConfig) => {
    try {
        // Now getGuildConfig and saveGuildConfig are directly available from parameters
        if (typeof getGuildConfig !== 'function') {
            console.error(`[LOGGING ERROR] getGuildConfig is not a function.`);
            return;
        }
        if (typeof saveGuildConfig !== 'function') {
            console.error(`[LOGGING ERROR] saveGuildConfig is not a function.`);
            return;
        }

        const guildConfig = await getGuildConfig(guild.id);
        const logChannelId = guildConfig.moderationLogChannelId;

        if (!logChannelId) {
            console.warn(`[LOGGING WARNING] No moderation log channel configured for guild ${guild.name}.`);
            return;
        }

        const logChannel = guild.channels.cache.get(logChannelId);
        if (!logChannel) {
            console.warn(`[LOGGING WARNING] Configured moderation log channel (${logChannelId}) not found in guild ${guild.name}.`);
            return;
        }

        const embed = new EmbedBuilder()
            .setColor('#FFD700') // Gold color for logs
            .setTitle(`${actionType} | Case #${guildConfig.caseNumber + 1 || 1}`)
            .addFields(
                { name: 'User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
                { name: 'Moderator', value: `${moderator.tag} (<@${moderator.id}>)`, inline: true },
                { name: 'Reason', value: reason || 'No reason provided.' },
                { name: 'Timestamp', value: new Date().toLocaleString() }
            )
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .setFooter({ text: `User ID: ${targetUser.id}` })
            .setTimestamp();

        await logChannel.send({ embeds: [embed] });

        // Increment case number in Firestore
        await saveGuildConfig(guild.id, { caseNumber: (guildConfig.caseNumber || 0) + 1 });

    } catch (error) {
        console.error(`[LOGGING ERROR] Failed to log moderation action to Discord channel:`, error);
    }
};

/**
 * Logs a general message to the configured message log channel.
 * This function is currently not fully implemented to send to Discord,
 * but serves as a placeholder for future expansion.
 * @param {Message} message - The message object to log.
 * @param {Function} getGuildConfig - Function to get the guild's config.
 */
const logMessage = async (message, getGuildConfig) => {
    // This function can be expanded to log message updates/deletions to a channel
    // For now, it primarily serves to log to console for debugging or internal tracking.
    // console.log(`[MESSAGE LOG] Message in ${message.guild.name} from ${message.author.tag}: ${message.content}`);
};

module.exports = {
    logModerationAction,
    logMessage
};
