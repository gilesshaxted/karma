// logging/joinLeaveLogHandler.js
const { EmbedBuilder, Collection, PermissionsBitField } = require('discord.js');

/**
 * Handles guild member join events, including invite tracking.
 * @param {GuildMember} member - The member who joined.
 * @param {function} getGuildConfig - Function to retrieve guild configuration.
 * @param {Collection<string, number>} oldInvitesMap - A Map of invite codes to their uses count *before* this member joined.
 * @param {Collection<string, Invite>} newInvitesCollection - A Collection of full Invite objects *after* this member joined.
 */
const handleGuildMemberAdd = async (member, getGuildConfig, oldInvitesMap, newInvitesCollection) => {
    const guildConfig = await getGuildConfig(member.guild.id);
    const logChannelId = guildConfig.joinLeaveLogChannelId;

    if (!logChannelId) return;
    const logChannel = member.guild.channels.cache.get(logChannelId);
    if (!logChannel) return;

    let inviteUsed = null;
    let inviterInfo = 'Unknown';
    let inviteCode = 'N/A';

    // Only attempt invite tracking if the bot has 'Manage Guild' permission
    if (member.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        let potentialInvites = [];

        // Find which invite code(s) increased in use
        for (const [code, newInvite] of newInvitesCollection) {
            const oldUses = oldInvitesMap.get(code) || 0; // Get uses from old map, or 0 if new invite

            if (newInvite.uses > oldUses) {
                potentialInvites.push(newInvite); // Store the full new Invite object
            }
        }

        if (potentialInvites.length === 1) {
            // Exactly one invite's uses increased, this is likely the one
            inviteUsed = potentialInvites[0];
        } else if (potentialInvites.length > 1) {
            // Multiple invites increased. Try to find one with exact +1, otherwise ambiguous.
            let exactMatch = null;
            for (const invite of potentialInvites) {
                const oldUses = oldInvitesMap.get(invite.code) || 0;
                if (invite.uses === oldUses + 1) {
                    exactMatch = invite;
                    break;
                }
            }
            if (exactMatch) {
                inviteUsed = exactMatch;
            } else {
                console.warn(`Ambiguous invite tracking for ${member.user.tag} in ${member.guild.name}. Multiple invites increased in uses, no single +1 match.`);
                inviterInfo = 'Ambiguous/Multiple Invites';
                inviteCode = 'Multiple/Unknown';
            }
        } else {
            // No invite found by increased uses. Could be vanity URL or other untracked join.
            // Discord API doesn't provide direct inviter for vanity URL joins.
            inviterInfo = 'Unknown (No specific invite found)';
            inviteCode = 'N/A';
        }

        if (inviteUsed) {
            inviterInfo = inviteUsed.inviter ? `<@${inviteUsed.inviter.id}> (${inviteUsed.inviter.tag})` : 'Unknown (No Inviter Info)';
            inviteCode = inviteUsed.code;
        }

    } else {
        console.warn(`Bot does not have 'Manage Guild' permission in ${member.guild.name}. Cannot track invites for ${member.user.tag}.`);
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
    const guildConfig = await getGuildConfig(member.guild.id);
    const logChannelId = guildConfig.joinLeaveLogChannelId;

    if (!logChannelId) return;
    const logChannel = member.guild.channels.cache.get(logChannelId);
    if (!logChannel) return;

    // Safely access member.user.bot
    if (member.user && member.user.bot) return; // Ignore bots leaving

    const embed = new EmbedBuilder()
        .setTitle('Member Left')
        .setDescription(
            `**User:** ${member.user?.tag || 'Unknown User'} (${member.user?.id || 'Unknown ID'})\n` +
            `**Joined Guild:** ${member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown'}`
        )
        .setThumbnail(member.user?.displayAvatarURL({ dynamic: true }) || null)
        .setColor(0xFF0000) // Red
        .setTimestamp()
        .setFooter({ text: `User ID: ${member.user?.id || 'Unknown ID'}` });

    await logChannel.send({ embeds: [embed] }).catch(err => {
        console.error(`Error sending leave log for ${member.user?.tag || 'Unknown User'}:`, err?.message || err);
    });
};

module.exports = {
    handleGuildMemberAdd,
    handleGuildMemberRemove
};
