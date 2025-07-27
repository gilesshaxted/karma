// logging/joinLeaveLogHandler.js
const { EmbedBuilder, Collection, PermissionsBitField } = require('discord.js'); // Added PermissionsBitField

/**
 * Handles guild member join events, including invite tracking.
 * @param {GuildMember} member - The member who joined.
 * @param {function} getGuildConfig - Function to retrieve guild configuration.
 * @param {Collection<string, number>} cachedInvites - The client's cached invites for the guild.
 */
const handleGuildMemberAdd = async (member, getGuildConfig, cachedInvites) => {
    const guildConfig = await getGuildConfig(member.guild.id);
    const logChannelId = guildConfig.joinLeaveLogChannelId;

    if (!logChannelId) return;
    const logChannel = member.guild.channels.cache.get(logChannelId);
    if (!logChannel) return;

    let inviteUsed = null;
    let inviter = 'Unknown';
    let inviteCode = 'N/A';

    // Attempt to track invite if bot has Manage Guild permission and invites are cached
    if (member.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageGuild) && cachedInvites) {
        try {
            const newInvites = await member.guild.invites.fetch(); // Fetch current invites
            const oldInvites = cachedInvites; // Get previously cached invites from client.invites

            // Find which invite code increased in use
            for (const [code, invite] of newInvites) { // newInvites is a Collection of Invite objects
                const oldUses = oldInvites.get(code) || 0;
                if (invite.uses > oldUses) {
                    inviteUsed = invite;
                    break;
                }
            }

            if (inviteUsed) {
                inviter = inviteUsed.inviter ? `<@${inviteUsed.inviter.id}> (${inviteUsed.inviter.tag})` : 'Unknown';
                inviteCode = inviteUsed.code;
            }
        } catch (error) {
            console.warn(`Error tracking invite for ${member.user.tag} in ${member.guild.name}:`, error);
        }
    }

    const embed = new EmbedBuilder()
        .setTitle('Member Joined')
        .setDescription(
            `**User:** <@${member.user.id}> (${member.user.tag})\n` +
            `**Account Created:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>\n` +
            `**Invited By:** ${inviter}\n` +
            `**Invite Code:** \`${inviteCode}\``
        )
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setColor(0x00FF00) // Green
        .setTimestamp()
        .setFooter({ text: `User ID: ${member.user.id}` }); // Footer as requested

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
            `**Joined Guild:** ${member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown'}` // Safely access joinedTimestamp
        )
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setColor(0xFF0000) // Red
        .setTimestamp()
        .setFooter({ text: `User ID: ${member.user.id}` }); // Footer as requested

    await logChannel.send({ embeds: [embed] }).catch(console.error);
};

module.exports = {
    handleGuildMemberAdd,
    handleGuildMemberRemove
};
