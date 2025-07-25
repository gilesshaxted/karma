// logging/messageLogHandler.js
const { EmbedBuilder } = require('discord.js');

/**
 * Handles message deletion events and logs them to the message log channel.
 * @param {Message} message - The deleted message.
 * @param {function} getGuildConfig - Function to retrieve guild configuration.
 * @param {function} logMessage - Core logging function.
 */
const handleMessageDelete = async (message, getGuildConfig, logMessage) => {
    // Ignore DMs or bot messages
    if (!message.guild || message.author.bot) return;

    // Ensure message content is available (might be null for uncached messages)
    if (!message.content && message.attachments.size === 0 && message.embeds.length === 0) {
        // If message has no content, attachments, or embeds, it might be a partial or uninteresting deletion.
        // Or it could be a system message.
        return;
    }

    // Pass 'System' as the flaggedBy, as it's an automatic log
    await logMessage(message.guild, message, message.client.user, 'Deleted', getGuildConfig);
};

/**
 * Handles message update events and logs them to the message log channel.
 * @param {Message} oldMessage - The message before the update.
 * @param {Message} newMessage - The message after the update.
 * @param {function} getGuildConfig - Function to retrieve guild configuration.
 * @param {function} logMessage - Core logging function.
 */
const handleMessageUpdate = async (oldMessage, newMessage, getGuildConfig, logMessage) => {
    // Ignore DMs or bot messages
    if (!newMessage.guild || newMessage.author.bot) return;

    // Ignore if content hasn't actually changed (e.g., embed update, pin/unpin)
    if (oldMessage.content === newMessage.content) return;

    const guildConfig = await getGuildConfig(newMessage.guild.id);
    const logChannelId = guildConfig.messageLogChannelId;

    if (!logChannelId) {
        console.log(`Message log channel not set for guild ${newMessage.guild.name}.`);
        return;
    }

    const logChannel = newMessage.guild.channels.cache.get(logChannelId);
    if (!logChannel) {
        console.error(`Message log channel with ID ${logChannelId} not found in guild ${newMessage.guild.name}.`);
        return;
    }

    // Safely get author ID and tag
    let resolvedAuthor = newMessage.author;
    if (resolvedAuthor && resolvedAuthor.partial) {
        try {
            resolvedAuthor = await resolvedAuthor.fetch();
        } catch (err) {
            console.warn(`Could not fetch partial author for message ${newMessage.id}:`, err);
            resolvedAuthor = null;
        }
    }
    const authorId = resolvedAuthor?.id || 'Unknown ID';
    const authorTag = resolvedAuthor?.tag || 'Unknown User';

    // Safely get channel ID and name
    let resolvedChannel = newMessage.channel;
    if (resolvedChannel && resolvedChannel.partial) {
        try {
            resolvedChannel = await resolvedChannel.fetch();
        } catch (err) {
            console.warn(`Could not fetch partial channel for message ${newMessage.id}:`, err);
            resolvedChannel = null;
        }
    }
    const channelId = resolvedChannel?.id || 'Unknown Channel ID';
    const channelName = resolvedChannel?.name || 'Unknown Channel';

    const embed = new EmbedBuilder()
        .setTitle('Message Edited')
        .setDescription(
            `**Author:** <@${authorId}>\n` +
            `**Channel:** <#${channelId}> (${channelName})\n` +
            `[Jump to Message](${newMessage.url})\n\n` +
            `**Old Content:**\n\`\`\`\n${oldMessage.content || 'No content'}\n\`\`\`\n` +
            `**New Content:**\n\`\`\`\n${newMessage.content || 'No content'}\n\`\`\``
        )
        .setFooter({ text: `Author ID: ${authorId}` })
        .setTimestamp(newMessage.editedTimestamp || newMessage.createdTimestamp || Date.now())
        .setColor(0xFFA500); // Orange for edits

    await logChannel.send({ embeds: [embed] });
};

module.exports = {
    handleMessageDelete,
    handleMessageUpdate
};
