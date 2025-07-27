// logging/joinLeaveLogHandler.js
const { EmbedBuilder, Collection, PermissionsBitField } = require('discord.js');

/**
 * Handles guild member join events, including invite tracking.
 * @param {GuildMember} member - The member who joined.
 * @param {function} getGuildConfig - Function to retrieve guild configuration.
 * @param {Collection<string, Invite>} clientInvites - The client's cached invites for the guild (full Invite objects).
 */
const handleGuildMemberAdd = async (member, getGuildConfig, clientInvites) => {
    const guildConfig = await getGuildConfig(member.guild.id);
    const logChannelId = guildConfig.joinLeaveLogChannelId;

    if (!logChannelId) return;
    const logChannel = member.guild.channels.cache.get(logChannelId);
    if (!logChannel) return;

    let inviteUsed = null;
    let inviter = 'Unknown';
    let inviteCode = 'N/A';

    // Attempt to track invite if bot has Manage Guild permission and invites are cached
    if (member.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageGuild) && clientInvites.has(member.guild.id)) {
        try {
            const newInvites = await member.guild.invites.fetch(); // Fetch current invites
            const oldInvites = clientInvites.get(member.guild.id); // Get previously cached invites (full Invite objects)

            // Find which invite code increased in use
            for (const [code, invite] of newInvites) {
                const oldInvite = oldInvites.get(code); // Get the old Invite object
                const oldUses = oldInvite ? oldInvite.uses : 0; // Get uses from old Invite object or 0 if new

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
