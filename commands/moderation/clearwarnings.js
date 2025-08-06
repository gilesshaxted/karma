const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
// Removed direct Firestore imports like collection, query, where, getDocs, deleteDoc, writeBatch
// as karmaSystem will handle the Firestore interaction for user moderation data.

module.exports = {
    // Slash command data
    data: new SlashCommandBuilder()
        .setName('clearwarnings')
        .setDescription('Clears all warnings for a specific user.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user whose warnings to clear')
                .setRequired(true)),

    // Execute function for slash command
    async execute(interaction, { client, db, appId, getGuildConfig, saveGuildConfig, hasPermission, isExempt, logModerationAction, karmaSystem }) { // Added karmaSystem
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }); // Defer reply ephemerally

        const targetUser = interaction.options.getUser('target');
        const moderator = interaction.user;
        const guild = interaction.guild;
        const guildConfig = await getGuildConfig(guild.id);

        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

        if (!targetMember) {
            return interaction.editReply({ content: 'Could not find that user in this server.', flags: [MessageFlags.Ephemeral] });
        }

        // Check if the target is exempt (moderators/admins should not have their warnings cleared by others)
        if (isExempt(targetMember, guildConfig) && targetUser.id !== moderator.id) {
            return interaction.editReply({ content: 'You cannot clear warnings for this user as they are exempt from moderation (unless you are clearing your own warnings).', flags: [MessageFlags.Ephemeral] });
        }

        try {
            // Fetch the user's moderation data from their karma document
            const modData = await karmaSystem.getOrCreateUserKarma(guild.id, targetUser.id, db, appId);
            const warningsToClearCount = (modData.warnings || []).length;

            if (warningsToClearCount === 0) {
                return interaction.editReply({ content: `${targetUser.tag} has no warnings to clear.`, flags: [MessageFlags.Ephemeral] });
            }

            // Clear the warnings array in the user's karma document
            modData.warnings = [];
            await karmaSystem.updateUserKarmaData(guild.id, targetUser.id, { warnings: modData.warnings }, db, appId);

            // Log the action (case number increment is handled by logModerationAction internally)
            const logReason = `Cleared all ${warningsToClearCount} warnings for ${targetUser.tag}.`;
            await logModerationAction('Warnings Cleared', guild, targetUser, moderator, logReason, client); // Pass client

            await interaction.editReply({ content: `Successfully cleared all ${warningsToClearCount} warnings for ${targetUser.tag}.` });

            // DM the target user
            const dmEmbed = new EmbedBuilder()
                .setTitle('Your Warnings Have Been Cleared!')
                .setDescription(`All of your warnings on **${guild.name}** have been cleared by ${moderator.tag}.`)
                .setColor(0x00FF00) // Green color for positive action
                .setTimestamp();
            await targetUser.send({ embeds: [dmEmbed] }).catch(console.error);

        } catch (error) {
            console.error(`Error clearing warnings for ${targetUser.tag}:`, error);
            await interaction.editReply({ content: `Failed to clear warnings for ${targetUser.tag}. An error occurred.`, flags: [MessageFlags.Ephemeral] });
        }
    }
};
