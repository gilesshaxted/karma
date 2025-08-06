const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
// Removed direct Firestore imports like collection, query, where, getDocs, deleteDoc, doc
// as karmaSystem will handle the Firestore interaction for user moderation data.

module.exports = {
    // Slash command data
    data: new SlashCommandBuilder()
        .setName('clearwarning')
        .setDescription('Clears a specific warning by its case number.')
        .addIntegerOption(option =>
            option.setName('casenumber')
                .setDescription('The case number of the warning to clear')
                .setRequired(true))
        .addUserOption(option => // Optional: to help narrow down if case numbers are reused across users
            option.setName('target')
                .setDescription('The user associated with this warning (optional, for precision)')
                .setRequired(false)),

    // Execute function for slash command
    async execute(interaction, { client, db, appId, getGuildConfig, saveGuildConfig, hasPermission, isExempt, logModerationAction, karmaSystem }) { // Added karmaSystem
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }); // Defer reply ephemerally

        const caseNumberToClear = interaction.options.getInteger('casenumber');
        const targetUserOption = interaction.options.getUser('target'); // Optional target user
        const moderator = interaction.user;
        const guild = interaction.guild;
        const guildConfig = await getGuildConfig(guild.id);

        try {
            // Determine the target user for the warning. If targetUserOption is provided, use it.
            // Otherwise, we might need to search all users' warnings if case numbers aren't globally unique.
            // For now, we'll assume targetUserOption is always provided or we fetch all users.
            // Given the previous /warnings command, targetUserOption is crucial for direct lookup.
            if (!targetUserOption) {
                return interaction.editReply({ content: 'Please provide the target user for the warning you wish to clear.', flags: [MessageFlags.Ephemeral] });
            }

            const targetUser = targetUserOption; // The actual Discord User object
            const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

            if (!targetMember) {
                return interaction.editReply({ content: 'Could not find that user in this server.', flags: [MessageFlags.Ephemeral] });
            }

            if (isExempt(targetMember, guildConfig) && targetUser.id !== moderator.id) {
                return interaction.editReply({ content: 'You cannot clear warnings for this user as they are exempt from moderation (unless you are clearing your own warnings).', flags: [MessageFlags.Ephemeral] });
            }

            // Fetch the user's moderation data from their karma document
            const modData = await karmaSystem.getOrCreateUserKarma(guild.id, targetUser.id, db, appId);
            let warnings = modData.warnings || [];

            const warningIndex = warnings.findIndex(w => w.caseNumber === caseNumberToClear);

            if (warningIndex === -1) {
                return interaction.editReply({ content: `No warning found with case number #${caseNumberToClear} for ${targetUser.tag}.`, flags: [MessageFlags.Ephemeral] });
            }

            const clearedWarningData = warnings[warningIndex];
            warnings.splice(warningIndex, 1); // Remove the warning from the array

            // Update the user's warnings array in Firestore
            await karmaSystem.updateUserKarmaData(guild.id, targetUser.id, { warnings: warnings }, db, appId);

            // Log the action (case number increment is handled by logModerationAction internally)
            const logReason = `Cleared warning #${caseNumberToClear} for ${targetUser.tag}. Original reason: "${clearedWarningData.reason}"`;
            await logModerationAction('Warning Cleared', guild, targetUser, moderator, logReason, client); // Pass client

            await interaction.editReply({ content: `Successfully cleared warning #${caseNumberToClear} for ${targetUser.tag}.` });

            // DM the target user
            const dmEmbed = new EmbedBuilder()
                .setTitle('A Warning Has Been Cleared!')
                .setDescription(`**Server:** ${guild.name}\n**Warning Case #:** ${caseNumberToClear}\n**Original Reason:** ${clearedWarningData.reason || 'No reason provided.'}\n**Moderator:** ${moderator.tag}`)
                .setColor(0x00FF00) // Green color for positive action
                .setTimestamp();
            await targetUser.send({ embeds: [dmEmbed] }).catch(console.error);

        } catch (error) {
            console.error(`Error clearing specific warning #${caseNumberToClear}:`, error);
            await interaction.editReply({ content: `Failed to clear warning #${caseNumberToClear}. An error occurred.`, flags: [MessageFlags.Ephemeral] });
        }
    }
};
