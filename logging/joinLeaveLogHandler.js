// logging/joinLeaveLogHandler.js
const { EmbedBuilder, Collection, PermissionsBitField } = require('discord.js');

/**
 * Handles guild member join events, including invite tracking.
 * @param {GuildMember} member - The member who joined.
 * @param {function} getGuildConfig - Function to retrieve guild configuration.
 * @param {Map<string, number>} oldInvitesMap - A Map of invite codes to their uses count *before* this member joined.
 * @param {Map<string, number>} newInvitesMap - A Map of invite codes to their uses count *after* this member joined.
 */
const handleGuildMemberAdd = async (member, getGuildConfig, oldInvitesMap, newInvitesMap) => {
    const guildConfig = await getGuildConfig(member.guild.id);
    const logChannelId = guildConfig.joinLeaveLogChannelId;

    if (!logChannelId) return;
    const logChannel = member.guild.channels.cache.get(logChannelId);
    if (!logChannel) return;

    let inviteUsed = null;
    let inviter = 'Unknown';
    let inviteCode = 'N/A';

    // Only attempt invite tracking if the bot has 'Manage Guild' permission
    if (member.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        let possibleInvites = [];

        // Find which invite code(s) increased in use
        for (const [code, newUses] of newInvitesMap) {
            const oldUses = oldInvitesMap.get(code) || 0; // Get uses from old map, or 0 if new invite
            if (newUses > oldUses) {
                // This invite's uses increased
                possibleInvites.push({ code, newUses, oldUses });
            }
        }

        if (possibleInvites.length === 1) {
            // Exactly one invite's uses increased, this is likely the one
            const inviteData = possibleInvites[0];
            try {
                // Fetch the full invite object to get inviter details
                const fetchedInvite = await member.guild.invites.fetch(inviteData.code);
                inviteUsed = fetchedInvite;
            } catch (fetchError) {
                console.warn(`Could not fetch specific invite ${inviteData.code}:`, fetchError);
                // Fallback to just code and uses if fetch fails
                inviteCode = inviteData.code;
                inviter = `Unknown (Code: ${inviteData.code}, Uses: ${inviteData.oldUses} -> ${inviteData.newUses})`;
            }
        } else if (possibleInvites.length > 1) {
            // Multiple invites increased, or no clear single invite.
            // This can happen if multiple users join simultaneously, or if an invite was used
            // but its oldUses wasn't accurately cached.
            console.warn(`Ambiguous invite tracking for ${member.user.tag} in ${member.guild.name}. Multiple invites increased in uses.`);
            inviter = 'Ambiguous/Multiple Invites';
            inviteCode = 'Multiple/Unknown';
        } else {
            // No invite found by increased uses. Could be vanity URL or other untracked join.
            // Discord API doesn't provide direct inviter for vanity URL joins.
            inviter = 'Unknown (No specific invite found)';
            inviteCode = 'N/A';
        }

        if (inviteUsed) {
            inviter = inviteUsed.inviter ? `<@${inviteUsed.inviter.id}> (${inviteUsed.inviter.tag})` : 'Unknown (No Inviter)';
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
            `**Invited By:** ${inviter}\n` +
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

    await logChannel.send({ embeds: [embed] }).catch(console.error);
};

module.exports = {
    handleGuildMemberAdd,
    handleGuildMemberRemove
};
