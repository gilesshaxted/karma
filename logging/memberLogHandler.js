// logging/memberLogHandler.js
const { EmbedBuilder } = require('discord.js');

/**
 * Handles guild member updates (e.g., nickname, roles, avatar).
 * @param {GuildMember} oldMember - The member before the update.
 * @param {GuildMember} newMember - The member after the update.
 * @param {function} getGuildConfig - Function to retrieve guild configuration.
 */
const handleGuildMemberUpdate = async (oldMember, newMember, getGuildConfig) => {
    if (oldMember.user.bot) return; // Ignore bots

    const guildConfig = await getGuildConfig(newMember.guild.id);
    const logChannelId = guildConfig.memberLogChannelId;

    if (!logChannelId) return;
    const logChannel = newMember.guild.channels.cache.get(logChannelId);
    if (!logChannel) return;

    let description = `**Member:** <@${newMember.user.id}> (${newMember.user.tag})\n`;
    let changed = false;
    const embed = new EmbedBuilder()
        .setTitle('Member Updated')
        .setColor(0x1E90FF) // DodgerBlue
        .setTimestamp()
        .setFooter({ text: `User ID: ${newMember.user.id}` });

    // Nickname change
    if (oldMember.nickname !== newMember.nickname) {
        description += `**Nickname:** \`${oldMember.nickname || 'None'}\` -> \`${newMember.nickname || 'None'}\`\n`;
        changed = true;
    }

    // Roles change
    const oldRoles = oldMember.roles.cache.map(r => r.name).sort();
    const newRoles = newMember.roles.cache.map(r => r.name).sort();

    const removedRoles = oldRoles.filter(role => !newRoles.includes(role));
    const addedRoles = newRoles.filter(role => !oldRoles.includes(role));

    if (addedRoles.length > 0) {
        description += `**Roles Added:** ${addedRoles.map(r => `\`${r}\``).join(', ')}\n`;
        changed = true;
    }
    if (removedRoles.length > 0) {
        description += `**Roles Removed:** ${removedRoles.map(r => `\`${r}\``).join(', ')}\n`;
        changed = true;
    }

    // User properties (username, discriminator, avatar) - handled by handleUserUpdate
    // Only send if something actually changed
    if (changed) {
        embed.setDescription(description);
        await logChannel.send({ embeds: [embed] }).catch(console.error);
    }
};

/**
 * Handles user updates (e.g., username, avatar, global changes).
 * This is for global user changes, not guild-specific.
 * @param {User} oldUser - The user before the update.
 * @param {User} newUser - The user after the update.
 * @param {function} getGuildConfig - Function to retrieve guild configuration.
 * @param {Client} client - The Discord client instance.
 */
const handleUserUpdate = async (oldUser, newUser, getGuildConfig, client) => {
    if (oldUser.bot) return; // Ignore bots

    // Iterate through all guilds the bot is in to find where this user exists
    client.guilds.cache.forEach(async guild => {
        const guildConfig = await getGuildConfig(guild.id);
        const logChannelId = guildConfig.memberLogChannelId;
        if (!logChannelId) return;
        const logChannel = guild.channels.cache.get(logChannelId);
        if (!logChannel) return;

        // Check if the user is actually in this guild
        const member = await guild.members.fetch(newUser.id).catch(() => null);
        if (!member) return; // User is not in this specific guild

        let description = `**Member:** <@${newUser.id}> (${newUser.tag})\n`;
        let changed = false;
        const embed = new EmbedBuilder()
            .setTitle('User Profile Updated')
            .setColor(0x1E90FF) // DodgerBlue
            .setTimestamp()
            .setFooter({ text: `User ID: ${newUser.id}` });

        // Username change
        if (oldUser.username !== newUser.username) {
            description += `**Username:** \`${oldUser.username}\` -> \`${newUser.username}\`\n`;
            changed = true;
        }
        // Discriminator change (if applicable, for old username system)
        if (oldUser.discriminator && oldUser.discriminator !== newUser.discriminator) {
            description += `**Discriminator:** \`#${oldUser.discriminator}\` -> \`#${newUser.discriminator}\`\n`;
            changed = true;
        }
        // Avatar change
        if (oldUser.avatar !== newUser.avatar) {
            description += `**Avatar Changed**\n`;
            embed.setThumbnail(newUser.displayAvatarURL({ dynamic: true }));
            changed = true;
        }

        if (changed) {
            embed.setDescription(description);
            await logChannel.send({ embeds: [embed] }).catch(console.error);
        }
    });
};

module.exports = {
    handleGuildMemberUpdate,
    handleUserUpdate
};
