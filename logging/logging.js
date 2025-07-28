// logging/logging.js
const { EmbedBuilder } = require('discord.js');
const { collection, addDoc } = require('firebase/firestore');

/**
 * Logs a moderation action to the designated moderation log channel and Firestore.
 * @param {Guild} guild - The Discord guild where the action occurred.
 * @param {string} actionType - The type of moderation action (e.g., 'Warning', 'Timeout').
 * @param {User} targetUser - The user who was moderated.
 * @param {string} reason - The reason for the moderation.
 * @param {User|ClientUser} moderator - The user or bot who performed the moderation.
 * @param {number} caseNumber - The case number for this action.
 * @param {string} [duration=null] - Optional duration for timeouts/bans.
 * @param {string} [messageLink=null] - Optional link to the original message.
 * @param {function} getGuildConfig - Function to retrieve guild config.
 * @param {object} db - Firestore database instance.
 * @param {string} appId - The application ID for Firestore paths.
 */
const logModerationAction = async (guild, actionType, targetUser, reason, moderator, caseNumber, duration = null, messageLink = null, getGuildConfig, db, appId) => {
    const guildConfig = await getGuildConfig(guild.id);
    const logChannelId = guildConfig.moderationLogChannelId;

    // Safely get targetUser and moderator details
    const targetUserId = targetUser?.id || 'Unknown ID';
    const targetUserTag = targetUser?.tag || 'Unknown User';
    const moderatorId = moderator?.id || 'Unknown ID';
    const moderatorTag = moderator?.tag || moderator?.username || 'Unknown User';

    // Log to Discord channel
    if (logChannelId) {
        const logChannel = guild.channels.cache.get(logChannelId);
        if (logChannel) {
            const embed = new EmbedBuilder()
                .setTitle(`${targetUserTag} - Case #${caseNumber}`)
                .setDescription(`**Action:** ${actionType}\n**Reason:** ${reason || 'No reason provided.'}`)
                .addFields(
                    { name: 'User', value: `${targetUserTag} (${targetUserId})`, inline: true },
                    { name: 'Moderator', value: `${moderatorTag} (${moderatorId})`, inline: true }
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
        const moderationRecordsRef = collection(db, `artifacts/${appId}/public/data/guilds/${guild.id}/moderation_records`);
        await addDoc(moderationRecordsRef, {
            caseNumber: caseNumber,
            actionType: actionType.replace(' (Emoji)', '').replace(' (Auto)', ''),
            targetUserId: targetUserId,
            targetUserTag: targetUserTag,
            moderatorId: moderatorId,
            moderatorTag: moderatorTag,
            reason: reason,
            duration: duration,
            timestamp: new Date(),
            messageLink: messageLink
        });
        console.log(`Moderation record for Case #${caseNumber} stored in Firestore.`);
    } catch (error) {
        console.error(`Error storing moderation record for Case #${caseNumber} in Firestore:`, error);
    }
};

/**
 * Logs a deleted message to the designated message log channel.
 * @param {Guild} guild - The Discord guild where the message was deleted.
 * @param {Message} message - The deleted message object.
 * @param {User|ClientUser} flaggedBy - The user or bot who initiated the deletion/flagging.
 * @param {string} actionType - The type of action that led to the message deletion (e.g., 'Auto-Deleted', 'Deleted (Emoji Mod)').
 * @param {function} getGuildConfig - Function to retrieve guild config.
 */
const logMessage = async (guild, message, flaggedBy, actionType, getGuildConfig) => {
    const guildConfig = await getGuildConfig(guild.id);
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

    // Safely get author ID and tag using optional chaining and fallbacks
    let resolvedAuthor = message.author;
    if (resolvedAuthor && resolvedAuthor.partial) {
        try {
            resolvedAuthor = await resolvedAuthor.fetch();
        } catch (err) {
            console.warn(`Could not fetch partial author for message ${message.id}:`, err);
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
            console.warn(`Could not fetch partial channel for message ${message.id}:`, err);
            resolvedChannel = null;
        }
    }
    const channelId = resolvedChannel?.id || 'Unknown Channel ID';
    const channelName = resolvedChannel?.name || 'Unknown Channel';

    const embed = new EmbedBuilder()
        .setTitle('Message Moderated')
        .setDescription(
            `**Author:** <@${authorId}>\n` +
            `**Channel:** <#${channelId}> (${channelName})\n` +
            `**Message:**\n\`\`\`\n${message.content || 'No content'}\n\`\`\``
        )
        .setFooter({ text: `Author ID: ${authorId}` })
        .setTimestamp(message.createdTimestamp || Date.now())
        .setColor(0xADD8E6); // Light blue for message logs

    await logChannel.send({ embeds: [embed] }).catch(console.error);
};

module.exports = {
    logModerationAction,
    logMessage
};
