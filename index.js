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
        // Directly check and use client.getGuildConfig and client.saveGuildConfig
        if (typeof client.getGuildConfig !== 'function') {
            console.error(`[LOGGING ERROR] client.getGuildConfig is not a function in logModerationAction. It might not be attached yet or is undefined.`);
            return null;
        }
        if (typeof client.saveGuildConfig !== 'function') {
            console.error(`[LOGGING ERROR] client.saveGuildConfig is not a function in logModerationAction. It might not be attached yet or is undefined.`);
            return null;
        }

        const guildConfig = await client.getGuildConfig(guild.id);
        
        // Increment case number BEFORE sending the log, so the log reflects the new number
        const newCaseNumber = (guildConfig.caseNumber || 0) + 1;
        await client.saveGuildConfig(guild.id, { caseNumber: newCaseNumber }); // Directly use client.saveGuildConfig

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
 * Logs a general message to the appropriate log channel based on guild configuration.
 * @param {Message|GuildMember|AuditLogEntry} eventObject - The object related to the event (e.g., a Message, GuildMember).
 * @param {Client} client - The Discord client instance (contains getGuildConfig).
 * @param {string} content - The message content to log.
 * @param {string} [type='general'] - The type of log (e.g., 'general', 'moderation', 'message', 'member', 'admin', 'joinLeave', 'boost').
 */
const logMessage = async (eventObject, client, content, type = 'general') => {
    // Ensure the client and its properties are available
    if (!client || !client.db || !client.appId || typeof client.getGuildConfig !== 'function') {
        console.error('Logging skipped: Client or its essential properties (db, appId, getGuildConfig) not available in logMessage.');
        return;
    }

    const guildId = eventObject.guild?.id; // Get guild ID from message, member, etc.
    if (!guildId) {
        console.warn(`Logging skipped: No guild ID found for event type ${type}.`);
        return;
    }

    try {
        // Use client.getGuildConfig directly
        const guildConfig = await client.getGuildConfig(guildId); 

        let logChannelId = null;
        switch (type) {
            case 'general':
                // You might have a general log channel or default to moderation
                logChannelId = guildConfig.moderationLogChannelId; 
                break;
            case 'moderation':
                logChannelId = guildConfig.moderationLogChannelId;
                break;
            case 'message':
                logChannelId = guildConfig.messageLogChannelId;
                break;
            case 'member':
                logChannelId = guildConfig.memberLogChannelId;
                break;
            case 'admin':
                logChannelId = guildConfig.adminLogChannelId;
                break;
            case 'joinLeave':
                logChannelId = guildConfig.joinLeaveLogChannelId;
                break;
            case 'boost':
                logChannelId = guildConfig.boostLogChannelId;
                break;
            default:
                console.warn(`Unknown log type: ${type}. Defaulting to general log channel.`);
                logChannelId = guildConfig.moderationLogChannelId;
        }

        if (logChannelId) {
            const logChannel = client.channels.cache.get(logChannelId);
            if (logChannel && logChannel.isTextBased()) {
                const embed = new EmbedBuilder()
                    .setDescription(content)
                    .setColor('#1C315E') // Primary blue from your theme
                    .setTimestamp();
                
                await logChannel.send({ embeds: [embed] }).catch(err => console.error(`Failed to send log message to channel ${logChannelId}:`, err));
            } else {
                console.warn(`Log channel ${logChannelId} not found or is not a text channel.`);
            }
        } else {
            console.log(`No log channel configured for type '${type}' in guild ${guildId}.`);
        }
    } catch (error) {
        console.error(`Error logging message for guild ${guildId}, type ${type}:`, error);
    }
};

module.exports = {
    logModerationAction,
    logMessage
};
