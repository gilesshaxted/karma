// logging/joinLeaveLogHandler.js
const { EmbedBuilder, Collection, PermissionsBitField } = require('discord.js');

/**
 * Handles guild member join events, including invite tracking.
 * @param {GuildMember} member - The member who joined.
 * @param {function} getGuildConfig - Function to retrieve guild configuration.
 * @param {InvitesTracker} invitesTracker - The instance of discord-invites-tracker.
 * @param {Invite} invite - The invite object provided by the tracker.
 * @param {User} inviter - The inviter user object provided by the tracker.
 */
const handleGuildMemberAdd = async (member, getGuildConfig, invite, inviter) => {
    const guildConfig = await getGuildConfig(member.guild.id);
    const logChannelId = guildConfig.joinLeaveLogChannelId;

    if (!logChannelId) return;
    const logChannel = member.guild.channels.cache.get(logChannelId);
    if (!logChannel) return;

    let inviterInfo = 'Unknown';
    let inviteCode = 'N/A';

    if (invite) { // If the tracker successfully found an invite
        inviterInfo = inviter ? `<@${inviter.id}> (${inviter.tag})` : 'Unknown (No Inviter Info)';
        inviteCode = invite.code;
    } else {
        // Fallback for cases where tracker couldn't find a specific invite
        // This might happen for vanity URLs or other untracked joins
        inviterInfo = 'Unknown (No specific invite found)';
        inviteCode = 'N/A';
    }

    const embed = new EmbedBuilder()
        .setTitle('Member Joined')
        .setDescription(
            `**User:** <@${member.user.id}> (${member.user.tag})\n` +
            `**Account Created:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>\n` +
            `**Invited By:** ${inviterInfo}\n` +
            `**Invite Code:** \`${inviteCode}\``
        )
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setColor(0x00FF00) // Green
        .setTimestamp()
        .setFooter({ text: `User ID: ${member.user.id}` });

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
        .setDescription(
            `**User:** ${member.user.tag} (${member.user.id})\n` +
            `**Joined Guild:** ${member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown'}`
        )
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setColor(0xFF0000) // Red
        .setTimestamp()
        .setFooter({ text: `User ID: ${member.user.id}` });

    await logChannel.send({ embeds: [embed] }).catch(console.console.error);
};

module.exports = {
    handleGuildMemberAdd,
    handleGuildMemberRemove
};
