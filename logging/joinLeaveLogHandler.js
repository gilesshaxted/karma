// logging/joinLeaveLogHandler.js
const { EmbedBuilder, Collection, PermissionsBitField } = require('discord.js');

/**
 * Handles guild member join events, including invite tracking.
 * @param {GuildMember} member - The member who joined.
 * @param {function} getGuildConfig - Function to retrieve guild configuration.
 * @param {Map<string, number>} oldInvitesMap - A Map of invite codes to their uses count *before* this member joined.
 * @param {Map<string, number>} newInvitesMap - A Map of invite codes to their uses count *after* this member joined.
 * @param {function} sendKarmaAnnouncement - Function to send karma announcements.
 * @param {function} addKarmaPoints - Function to add karma points.
 * @param {object} db - Firestore database instance.
 * @param {string} appId - The application ID for Firestore paths.
 * @param {Client} client - The Discord client instance.
 */
const handleGuildMemberAdd = async (member, getGuildConfig, oldInvitesMap, newInvitesMap, sendKarmaAnnouncement, addKarmaPoints, db, appId, client) => {
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
        for (const [code, newUses] of newInvitesMap) {
            const oldUses = oldInvitesMap.get(code) || 0; // Get uses from old map, or 0 if new invite

            if (newUses > oldUses) {
                potentialInvites.push({ code, newUses, oldUses });
            }
        }

        // Try to find the exact invite that increased by 1
        let exactMatch = null;
        if (potentialInvites.length > 0) {
            for (const inviteData of potentialInvites) {
                if (inviteData.newUses === inviteData.oldUses + 1) {
                    try {
                        // Fetch the full invite object to get inviter details
                        const fetchedInvite = await member.guild.invites.fetch(inviteData.code);
                        inviteUsed = fetchedInvite;
                        exactMatch = inviteData; // Store inviteData for its code
                        break; // Found the exact match, no need to check further
                    } catch (fetchError) {
                        console.warn(`Could not fetch specific invite ${inviteData.code} for exact match:`, fetchError);
                        // Continue to check other potential invites or fallbacks
                    }
                }
            }
        }

        if (exactMatch && inviteUsed) { // If an exact match was found and fetched
            inviterInfo = inviteUsed.inviter ? `<@${inviteUsed.inviter.id}> (${inviteUsed.inviter.tag})` : 'Unknown (No Inviter Info)';
            inviteCode = inviteUsed.code;
        } else if (potentialInvites.length > 0) {
            // If no exact +1 match, but some invites increased, it's ambiguous
            console.warn(`Ambiguous invite tracking for ${member.user.tag} in ${member.guild.name}. Multiple or non-single-increment invites increased in uses.`);
            inviterInfo = 'Ambiguous/Multiple Invites';
            inviteCode = 'Multiple/Unknown';
        } else {
            // No invite found by increased uses. Could be vanity URL or other untracked join.
            inviterInfo = 'Unknown (No specific invite found)';
            inviteCode = 'N/A';
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

    // --- New Member Greeting and +1 Karma ---
    // This logic is now part of the handler
    if (guildConfig.karmaChannelId) {
        try {
            // Give +1 Karma to the new member
            const newKarma = await addKarmaPoints(member.guild.id, member.user, 1, db, appId);
            // Send a joyful greeting message to the Karma Channel
            await sendKarmaAnnouncement(member.guild, member.user.id, 1, newKarma, client, true); // true for isNewMember
        } catch (error) {
            console.error(`Error greeting new member ${member.user.tag} or giving initial karma:`, error);
        }
    }
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
