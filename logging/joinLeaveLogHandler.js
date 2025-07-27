// logging/joinLeaveLogHandler.js
const { EmbedBuilder, Collection, PermissionsBitField, AuditLogEvent } = require('discord.js'); // Added AuditLogEvent for potential future use, though not directly used in this fix for human joins.

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

    // Attempt to track invite if bot has Manage Guild permission
    if (member.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        try {
            const newInvites = await member.guild.invites.fetch(); // Fetch current invites from Discord API

            // Get the old invites from our cache
            const oldInvites = clientInvites.get(member.guild.id) || new Collection();

            let possibleInvites = [];

            // Find which invite code(s) increased in use
            for (const [code, newInvite] of newInvites) {
                const oldInvite = oldInvites.get(code);
                const oldUses = oldInvite ? oldInvite.uses : 0;

                if (newInvite.uses > oldUses) {
                    // This invite's uses increased
                    possibleInvites.push(newInvite);
                }
            }

            if (possibleInvites.length === 1) {
                // Exactly one invite's uses increased, this is likely the one
                inviteUsed = possibleInvites[0];
            } else if (possibleInvites.length > 1) {
                // Multiple invites increased, or no clear single invite.
                // This can happen if multiple users join simultaneously, or if an invite was used
                // but its oldUses wasn't accurately cached.
                // For now, we'll log as ambiguous.
                console.warn(`Ambiguous invite tracking for ${member.user.tag} in ${member.guild.name}. Multiple invites increased in uses.`);
                inviter = 'Ambiguous/Multiple Invites';
                inviteCode = 'Multiple/Unknown';
            } else {
                // No invite found by increased uses. Could be vanity URL, or bot add.
                // Check for vanity URL if guild has one (requires GUILD_VANITY_URL feature)
                if (member.guild.features.includes('VANITY_URL')) {
                    try {
                        const vanityInvite = await member.guild.fetchVanityData();
                        if (vanityInvite && vanityInvite.uses > (oldInvites.get(vanityInvite.code)?.uses || 0)) {
                            inviteUsed = vanityInvite;
                            inviter = 'Vanity URL';
                            inviteCode = vanityInvite.code;
                        }
                    } catch (vanityError) {
                        console.warn(`Could not fetch vanity URL for guild ${member.guild.name}:`, vanityError);
                    }
                }
            }

            if (inviteUsed) {
                inviter = inviteUsed.inviter ? `<@${inviteUsed.inviter.id}> (${inviteUsed.inviter.tag})` : 'Unknown (No Inviter)';
                inviteCode = inviteUsed.code;
            }

            // After processing, update the client's invite cache for this guild
            clientInvites.set(member.guild.id, newInvites);

        } catch (error) {
            console.error(`Error fetching invites for ${member.user.tag} in ${member.guild.name}:`, error);
            // Fallback if invite fetching fails entirely
            inviter = 'Unknown (Fetch Error)';
            inviteCode = 'Error';
        }
    } else {
        console.warn(`Bot does not have 'Manage Guild' permission or invites not cached for ${member.guild.name}. Cannot track invites for ${member.user.tag}.`);
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
