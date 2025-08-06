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
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }); // Use flags for ephemeral reply

        const targetUser = interaction.options.getUser('target');
        const guildId = interaction.guild.id;

        if (!targetUser) {
            return interaction.editReply('Could not find that user.');
        }

        try {
            // Fetch moderation data directly from the user's karmaSystem document
            const modData = await karmaSystem.getUserModerationData(guildId, targetUser.id, db, appId);
            const warnings = modData.warnings || [];
            const timeouts = modData.timeouts || [];

            const warningsDescription = warnings.length > 0
                ? warnings.map((w, index) =>
                    `**${index + 1}.** __${w.rule}__: "${w.reason}" on <t:${Math.floor(w.timestamp / 1000)}:F>`
                  ).join('\n')
                : 'No warnings on record.';

            const timeoutsDescription = timeouts.length > 0
                ? timeouts.map((t, index) =>
                    `**${index + 1}.** ${t.duration} timeout on <t:${Math.floor(t.timestamp / 1000)}:F>`
                  ).join('\n')
                : 'No timeouts on record.';

            const warningsEmbed = new EmbedBuilder()
                .setColor('#FFC107') // Gold from your theme
                .setTitle(`Moderation History for ${targetUser.tag}`)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true })) // Use dynamic: true for animated avatars
                .addFields(
                    { name: 'Warnings', value: warningsDescription, inline: false },
                    { name: 'Timeouts', value: timeoutsDescription, inline: false }
                )
                .setFooter({ text: `User ID: ${targetUser.id}` })
                .setTimestamp();

            // No pagination buttons needed as all data is fetched at once from the user document
            await interaction.editReply({ embeds: [warningsEmbed], flags: [MessageFlags.Ephemeral] });

        } catch (error) {
            console.error(`Error fetching moderation data for ${targetUser.tag}:`, error);
            await interaction.editReply('An error occurred while fetching moderation history. Please try again later.');
        }
    },

    // Removed createWarningsEmbed, createPaginationButtons, and handlePagination
    // as their logic is now integrated directly into the execute function or no longer needed.
};
