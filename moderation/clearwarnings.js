// moderation/clearwarnings.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { collection, query, where, getDocs, deleteDoc, doc, writeBatch } = require('firebase/firestore');

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
    async execute(interaction, { db, appId, getGuildConfig, saveGuildConfig, hasPermission, isExempt, logModerationAction, MessageFlags }) {
        const targetUser = interaction.options.getUser('target');
        const moderator = interaction.user;
        const guild = interaction.guild;
        const guildConfig = await getGuildConfig(guild.id);

        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

        if (!targetMember) {
            return interaction.editReply({ content: 'Could not find that user in this server.' });
        }

        // Check if the target is exempt (moderators/admins should not have their warnings cleared by others)
        if (isExempt(targetMember, guildConfig) && targetUser.id !== moderator.id) {
            return interaction.editReply({ content: 'You cannot clear warnings for this user as they are exempt from moderation (unless you are clearing your own warnings).'});
        }

        try {
            const moderationRecordsRef = collection(db, `artifacts/${appId}/public/data/guilds/${guild.id}/moderation_records`);
            const q = query(moderationRecordsRef,
                where("targetUserId", "==", targetUser.id),
                where("actionType", "==", "Warning")
            );

            const querySnapshot = await getDocs(q);
            if (querySnapshot.empty) {
                return interaction.editReply({ content: `${targetUser.tag} has no warnings to clear.` });
            }

            const batch = writeBatch(db);
            querySnapshot.forEach((docSnapshot) => {
                batch.delete(docSnapshot.ref);
            });
            await batch.commit();

            // Log the action
            guildConfig.caseNumber++;
            await saveGuildConfig(guild.id, guildConfig);
            const caseNumber = guildConfig.caseNumber;

            const reason = `Cleared all ${querySnapshot.size} warnings for ${targetUser.tag}.`;
            await logModerationAction(guild, 'Warnings Cleared', targetUser, reason, moderator, caseNumber);

            await interaction.editReply({ content: `Successfully cleared all ${querySnapshot.size} warnings for ${targetUser.tag}. (Case #${caseNumber})` });

            // DM the target user
            const dmEmbed = new EmbedBuilder()
                .setTitle('Your Warnings Have Been Cleared!')
                .setDescription(`All of your warnings on **${guild.name}** have been cleared by ${moderator.tag}.`)
                .setColor(0x00FF00) // Green color for positive action
                .setTimestamp();
            await targetUser.send({ embeds: [dmEmbed] }).catch(console.error);

        } catch (error) {
            console.error(`Error clearing warnings for ${targetUser.tag}:`, error);
            await interaction.editReply({ content: `Failed to clear warnings for ${targetUser.tag}. An error occurred.` });
        }
    }
};
