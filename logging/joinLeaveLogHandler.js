// logging/joinLeaveLogHandler.js
const { EmbedBuilder } = require('discord.js');

/**
 * Handles guild member join events.
 * @param {GuildMember} member - The member who joined.
 * @param {function} getGuildConfig - Function to retrieve guild configuration.
 */
const handleGuildMemberAdd = async (member, getGuildConfig) => {
    const guildConfig = await getGuildConfig(member.guild.id);
    const logChannelId = guildConfig.joinLeaveLogChannelId;

    if (!logChannelId) return;
    const logChannel = member.guild.channels.cache.get(logChannelId);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
        .setTitle('Member Joined')
        .setDescription(`**User:** <@${member.user.id}> (${member.user.tag})\n**Account Created:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setColor(0x00FF00) // Green
        .setTimestamp();

    await logChannel.send({ embeds: [embed] }).catch(console.error);
};

/**
 * Handles guild member leave events.
 * @param {GuildMember} member - The member who left.
 * @param {function} getGuildConfig - Function to retrieve guild configuration.
 */
const handleGuildMemberRemove = async (member, getGuildConfig) => {
    if (member.user.bot) return; // Ignore bots leaving

    const guildConfig = await getGuildConfig(member.guild.id);
    const logChannelId = guildConfig.joinLeaveLogChannelId;

    if (!logChannelId) return;
    const logChannel = member.guild.channels.cache.get(logChannelId);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
        .setTitle('Member Left')
        .setDescription(`**User:** ${member.user.tag} (${member.user.id})\n**Joined Guild:** <t:${Math.floor(member.joinedTimestamp / 1000)}:R>`)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setColor(0xFF0000) // Red
        .setTimestamp();

    await logChannel.send({ embeds: [embed] }).catch(console.error);
};

module.exports = {
    handleGuildMemberAdd,
    handleGuildMemberRemove
};
