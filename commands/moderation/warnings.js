const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
// Removed specific Firestore imports like collection, query, where, orderBy, limit, startAfter, getDocs, documentId
// as karmaSystem.getUserModerationData will handle the Firestore interaction.

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warnings')
        .setDescription('Displays a user\'s moderation history (warnings and timeouts).')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user to view warnings for')
                .setRequired(true)),

    async execute(interaction, { db, appId, karmaSystem }) { // Added karmaSystem to destructuring
        // Defer reply immediately and ephemerally to prevent "InteractionAlreadyReplied" errors
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }); 

        const targetUser = interaction.options.getUser('target');
        const guildId = interaction.guild.id;

        if (!targetUser) {
            // Use editReply since it's already deferred
            return interaction.editReply({ content: 'Could not find that user.', flags: [MessageFlags.Ephemeral] });
        }

        try {
            // Fetch moderation data directly from the user's karmaSystem document
            const modData = await karmaSystem.getModerationHistory(guildId, targetUser.id, db, appId);
            const warnings = modData.warnings || [];
            const timeouts = modData.timeouts || [];
            const kicks = modData.kicks || [];
            const bans = modData.bans || [];

            // Sort warnings and timeouts by timestamp (most recent first)
            warnings.sort((a, b) => b.timestamp - a.timestamp);
            timeouts.sort((a, b) => b.timestamp - a.timestamp);
            kicks.sort((a, b) => b.timestamp - a.timestamp);
            bans.sort((a, b) => b.timestamp - a.timestamp);


            const warningsDescription = warnings.length > 0
                ? warnings.map((w, index) =>
                    `**${index + 1}.** __${w.rule || 'Warning'}__: "${w.reason}" on <t:${Math.floor(w.timestamp / 1000)}:F>${w.caseNumber ? ` (Case #${w.caseNumber})` : ''}`
                  ).join('\n')
                : 'No warnings on record.';

            const timeoutsDescription = timeouts.length > 0
                ? timeouts.map((t, index) =>
                    `**${index + 1}.** ${t.duration} timeout on <t:${Math.floor(t.timestamp / 1000)}:F>${t.caseNumber ? ` (Case #${t.caseNumber})` : ''}`
                  ).join('\n')
                : 'No timeouts on record.';

            const kicksDescription = kicks.length > 0
                ? kicks.map((k, index) =>
                    `**${index + 1}.** Kicked for: "${k.reason}" on <t:${Math.floor(k.timestamp / 1000)}:F>${k.caseNumber ? ` (Case #${k.caseNumber})` : ''}`
                  ).join('\n')
                : 'No kicks on record.';

            const bansDescription = bans.length > 0
                ? bans.map((b, index) =>
                    `**${index + 1}.** Banned for: "${b.reason}" (${b.duration || 'forever'}) on <t:${Math.floor(b.timestamp / 1000)}:F>${b.caseNumber ? ` (Case #${b.caseNumber})` : ''}`
                  ).join('\n')
                : 'No bans on record.';


            const warningsEmbed = new EmbedBuilder()
                .setColor('#FFC107') // Gold from your theme
                .setTitle(`Moderation History for ${targetUser.tag}`)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true })) // Use dynamic: true for animated avatars
                .addFields(
                    { name: 'Warnings', value: warningsDescription, inline: false },
                    { name: 'Timeouts', value: timeoutsDescription, inline: false },
                    { name: 'Kicks', value: kicksDescription, inline: false }, // New field
                    { name: 'Bans', value: bansDescription, inline: false }   // New field
                )
                .setFooter({ text: `User ID: ${targetUser.id}` })
                .setTimestamp();

            // Use editReply since it's already deferred
            await interaction.editReply({ embeds: [warningsEmbed], flags: [MessageFlags.Ephemeral] });

        } catch (error) {
            console.error(`Error fetching moderation data for ${targetUser.tag}:`, error);
            // Use editReply since it's already deferred
            await interaction.editReply('An error occurred while fetching moderation history. Please try again later.', flags: [MessageFlags.Ephemeral]);
        }
    },

    // Removed createWarningsEmbed, createPaginationButtons, and handlePagination
    // as their logic is now integrated directly into the execute function or no longer needed.
};
