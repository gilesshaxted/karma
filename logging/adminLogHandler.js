// logging/adminLogHandler.js
const { EmbedBuilder, AuditLogEvent } = require('discord.js');

/**
 * Helper to get audit log entry for an action.
 * @param {Guild} guild - The guild.
 * @param {AuditLogEvent} type - The audit log event type.
 * @param {string} targetId - The ID of the target of the audit log entry.
 * @returns {Promise<AuditLogEntry|null>}
 */
const getAuditLogEntry = async (guild, type, targetId) => {
    try {
        const auditLogs = await guild.fetchAuditLogs({
            type: type,
            limit: 1
        });
        const entry = auditLogs.entries.first();
        if (entry && entry.target.id === targetId) {
            return entry;
        }
    } catch (error) {
        console.error(`Error fetching audit log for ${type} in guild ${guild.name}:`, error);
    }
    return null;
};


/**
 * Sends a log message to the admin log channel.
 * @param {Guild} guild - The guild.
 * @param {EmbedBuilder} embed - The embed to send.
 * @param {function} getGuildConfig - Function to retrieve guild configuration.
 */
const sendAdminLog = async (guild, embed, getGuildConfig) => {
    const guildConfig = await getGuildConfig(guild.id);
    const logChannelId = guildConfig.adminLogChannelId;

    if (!logChannelId) return;
    const logChannel = guild.channels.cache.get(logChannelId);
    if (!logChannel) return;

    await logChannel.send({ embeds: [embed] }).catch(console.error);
};


// --- Channel Events ---
const handleChannelCreate = async (channel, getGuildConfig) => {
    if (!channel.guild) return;
    const embed = new EmbedBuilder()
        .setTitle('Channel Created')
        .setDescription(`**Name:** ${channel.name}\n**Type:** ${channel.type}\n**ID:** ${channel.id}`)
        .setColor(0x00FF00) // Green
        .setTimestamp();
    await sendAdminLog(channel.guild, embed, getGuildConfig);
};

const handleChannelDelete = async (channel, getGuildConfig) => {
    if (!channel.guild) return;
    const embed = new EmbedBuilder()
        .setTitle('Channel Deleted')
        .setDescription(`**Name:** ${channel.name}\n**Type:** ${channel.type}\n**ID:** ${channel.id}`)
        .setColor(0xFF0000) // Red
        .setTimestamp();
    await sendAdminLog(channel.guild, embed, getGuildConfig);
};

const handleChannelUpdate = async (oldChannel, newChannel, getGuildConfig) => {
    if (!newChannel.guild) return;
    let description = `**Channel:** ${newChannel.name} (<#${newChannel.id}>)\n**ID:** ${newChannel.id}\n`;
    let changed = false;

    const embed = new EmbedBuilder()
        .setTitle('Channel Updated')
        .setColor(0xFFA500) // Orange
        .setTimestamp();

    if (oldChannel.name !== newChannel.name) {
        description += `**Name:** \`${oldChannel.name}\` -> \`${newChannel.name}\`\n`;
        changed = true;
    }
    if (oldChannel.topic !== newChannel.topic) {
        description += `**Topic:** \`${oldChannel.topic || 'None'}\` -> \`${newChannel.topic || 'None'}\`\n`;
        changed = true;
    }
    if (oldChannel.nsfw !== newChannel.nsfw) {
        description += `**NSFW:** \`${oldChannel.nsfw}\` -> \`${newChannel.nsfw}\`\n`;
        changed = true;
    }
    if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
        description += `**Slowmode:** \`${oldChannel.rateLimitPerUser}s\` -> \`${newChannel.rateLimitPerUser}s\`\n`;
        changed = true;
    }
    // Add more checks for other channel properties as needed

    if (changed) {
        embed.setDescription(description);
        await sendAdminLog(newChannel.guild, embed, getGuildConfig);
    }
};

const handleChannelPermissionsUpdate = async (channel, getGuildConfig) => {
    if (!channel.guild) return;
    const embed = new EmbedBuilder()
        .setTitle('Channel Permissions Updated')
        .setDescription(`Permissions for channel ${channel.name} (<#${channel.id}>) were updated.`)
        .setColor(0xFFA500) // Orange
        .setTimestamp();
    await sendAdminLog(channel.guild, embed, getGuildConfig);
};


// --- Role Events ---
const handleRoleCreate = async (role, getGuildConfig) => {
    if (!role.guild) return;
    const embed = new EmbedBuilder()
        .setTitle('Role Created')
        .setDescription(`**Name:** ${role.name}\n**ID:** ${role.id}\n**Color:** \`${role.hexColor}\``)
        .setColor(0x00FF00) // Green
        .setTimestamp();
    await sendAdminLog(role.guild, embed, getGuildConfig);
};

const handleRoleDelete = async (role, getGuildConfig) => {
    if (!role.guild) return;
    const embed = new EmbedBuilder()
        .setTitle('Role Deleted')
        .setDescription(`**Name:** ${role.name}\n**ID:** ${role.id}`)
        .setColor(0xFF0000) // Red
        .setTimestamp();
    await sendAdminLog(role.guild, embed, getGuildConfig);
};

const handleRoleUpdate = async (oldRole, newRole, getGuildConfig) => {
    if (!newRole.guild) return;
    let description = `**Role:** ${newRole.name} (<@&${newRole.id}>)\n**ID:** ${newRole.id}\n`;
    let changed = false;

    const embed = new EmbedBuilder()
        .setTitle('Role Updated')
        .setColor(0xFFA500) // Orange
        .setTimestamp();

    if (oldRole.name !== newRole.name) {
        description += `**Name:** \`${oldRole.name}\` -> \`${newRole.name}\`\n`;
        changed = true;
    }
    if (oldRole.hexColor !== newRole.hexColor) {
        description += `**Color:** \`${oldRole.hexColor}\` -> \`${newRole.hexColor}\`\n`;
        changed = true;
    }
    if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
        description += `**Permissions Changed**\n`;
        // You could add more detailed permission diffing here if needed
        changed = true;
    }
    // Add more checks for other role properties as needed

    if (changed) {
        embed.setDescription(description);
        await sendAdminLog(newRole.guild, embed, getGuildConfig);
    }
};


// --- Emoji Events ---
const handleEmojiCreate = async (emoji, getGuildConfig) => {
    if (!emoji.guild) return;
    const embed = new EmbedBuilder()
        .setTitle('Emoji Created')
        .setDescription(`**Name:** ${emoji.name}\n**ID:** ${emoji.id}\n**Emoji:** ${emoji.toString()}`)
        .setThumbnail(emoji.url)
        .setColor(0x00FF00) // Green
        .setTimestamp();
    await sendAdminLog(emoji.guild, embed, getGuildConfig);
};

const handleEmojiDelete = async (emoji, getGuildConfig) => {
    if (!emoji.guild) return;
    const embed = new EmbedBuilder()
        .setTitle('Emoji Deleted')
        .setDescription(`**Name:** ${emoji.name}\n**ID:** ${emoji.id}\n**Emoji:** ${emoji.toString()}`)
        .setColor(0xFF0000) // Red
        .setTimestamp();
    await sendAdminLog(emoji.guild, embed, getGuildConfig);
};

const handleEmojiUpdate = async (oldEmoji, newEmoji, getGuildConfig) => {
    if (!newEmoji.guild) return;
    let description = `**Emoji:** ${newEmoji.toString()} (\`${newEmoji.name}\`)\n**ID:** ${newEmoji.id}\n`;
    let changed = false;

    const embed = new EmbedBuilder()
        .setTitle('Emoji Updated')
        .setColor(0xFFA500) // Orange
        .setTimestamp();

    if (oldEmoji.name !== newEmoji.name) {
        description += `**Name:** \`${oldEmoji.name}\` -> \`${newEmoji.name}\`\n`;
        changed = true;
    }
    // Add more checks for other emoji properties as needed

    if (changed) {
        embed.setDescription(description);
        await sendAdminLog(newEmoji.guild, embed, getGuildConfig);
    }
};

// --- Guild Scheduled Event Events ---
const handleGuildScheduledEventCreate = async (guildScheduledEvent, getGuildConfig) => {
    if (!guildScheduledEvent.guild) return;
    const embed = new EmbedBuilder()
        .setTitle('Scheduled Event Created')
        .setDescription(`**Name:** ${guildScheduledEvent.name}\n**ID:** ${guildScheduledEvent.id}\n**Creator:** <@${guildScheduledEvent.creatorId || 'Unknown'}>\n**Start Time:** <t:${Math.floor(guildScheduledEvent.scheduledStartTimestamp / 1000)}:F>`)
        .setColor(0x00FF00) // Green
        .setTimestamp();
    await sendAdminLog(guildScheduledEvent.guild, embed, getGuildConfig);
};

const handleGuildScheduledEventDelete = async (guildScheduledEvent, getGuildConfig) => {
    if (!guildScheduledEvent.guild) return;
    const embed = new EmbedBuilder()
        .setTitle('Scheduled Event Deleted')
        .setDescription(`**Name:** ${guildScheduledEvent.name}\n**ID:** ${guildScheduledEvent.id}\n**Creator:** <@${guildScheduledEvent.creatorId || 'Unknown'}>`)
        .setColor(0xFF0000) // Red
        .setTimestamp();
    await sendAdminLog(guildScheduledEvent.guild, embed, getGuildConfig);
};

const handleGuildScheduledEventUpdate = async (oldGuildScheduledEvent, newGuildScheduledEvent, getGuildConfig) => {
    if (!newGuildScheduledEvent.guild) return;
    let description = `**Event:** ${newGuildScheduledEvent.name}\n**ID:** ${newGuildScheduledEvent.id}\n`;
    let changed = false;

    const embed = new EmbedBuilder()
        .setTitle('Scheduled Event Updated')
        .setColor(0xFFA500) // Orange
        .setTimestamp();

    if (oldGuildScheduledEvent.name !== newGuildScheduledEvent.name) {
        description += `**Name:** \`${oldGuildScheduledEvent.name}\` -> \`${newGuildScheduledEvent.name}\`\n`;
        changed = true;
    }
    if (oldGuildScheduledEvent.status !== newGuildScheduledEvent.status) {
        description += `**Status:** \`${oldGuildScheduledEvent.status}\` -> \`${newGuildScheduledEvent.status}\`\n`;
        changed = true;
    }
    // Add more checks for other event properties as needed (e.g., description, start/end time)

    if (changed) {
        embed.setDescription(description);
        await sendAdminLog(newGuildScheduledEvent.guild, embed, getGuildConfig);
    }
};


module.exports = {
    handleChannelCreate,
    handleChannelDelete,
    handleChannelUpdate,
    handleChannelPermissionsUpdate,
    handleRoleCreate,
    handleRoleDelete,
    handleRoleUpdate,
    handleEmojiCreate,
    handleEmojiDelete,
    handleEmojiUpdate,
    handleGuildScheduledEventCreate,
    handleGuildScheduledEventDelete,
    handleGuildScheduledEventUpdate
};
