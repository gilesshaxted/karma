// moderation/clearwarning.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { collection, query, where, getDocs, deleteDoc, doc } = require('firebase/firestore');

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
    async execute(interaction, { db, appId, getGuildConfig, saveGuildConfig, hasPermission, isExempt, logModerationAction, MessageFlags }) {
        const caseNumberToClear = interaction.options.getInteger('casenumber');
        const targetUserOption = interaction.options.getUser('target'); // Optional target user
        const moderator = interaction.user;
        const guild = interaction.guild;
        const guildConfig = await getGuildConfig(guild.id);

        try {
            const moderationRecordsRef = collection(db, `artifacts/${appId}/public/data/guilds/${guild.id}/moderation_records`);
            let q = query(moderationRecordsRef,
                where("caseNumber", "==", caseNumberToClear),
                where("actionType", "==", "Warning")
            );

            // If a target user is provided, add it to the query for more precision
            if (targetUserOption) {
                q = query(q, where("targetUserId", "==", targetUserOption.id));
            }

            const querySnapshot = await getDocs(q);

            if (querySnapshot.empty) {
                return interaction.editReply({ content: `No warning found with case number #${caseNumberToClear}${targetUserOption ? ` for ${targetUserOption.tag}` : ''}.` });
            }

            // We expect only one document for a unique case number. If multiple, take the first.
            const warningDoc = querySnapshot.docs[0];
            const warningData = warningDoc.data();
            const targetUser = await client.users.fetch(warningData.targetUserId).catch(() => null);

            if (!targetUser) {
                // This case should ideally not happen if the user exists in the record
                console.error(`Target user with ID ${warningData.targetUserId} not found for case #${caseNumberToClear}.`);
                return interaction.editReply({ content: `Found warning #${caseNumberToClear}, but could not fetch the target user.` });
            }

            const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
            if (isExempt(targetMember, guildConfig) && targetUser.id !== moderator.id) {
                return interaction.editReply({ content: 'You cannot clear warnings for this user as they are exempt from moderation (unless you are clearing your own warnings).'});
            }

            await deleteDoc(warningDoc.ref);

            // Log the action
            guildConfig.caseNumber++; // Increment for the clear action itself
            await saveGuildConfig(guild.id, guildConfig);
            const newCaseNumber = guildConfig.caseNumber;

            const reason = `Cleared warning #${caseNumberToClear} for ${targetUser.tag}. Original reason: "${warningData.reason}"`;
            await logModerationAction(guild, 'Warning Cleared (Specific)', targetUser, reason, moderator, newCaseNumber);

            await interaction.editReply({ content: `Successfully cleared warning #${caseNumberToClear} for ${targetUser.tag}. (Action Logged as Case #${newCaseNumber})` });

            // DM the target user
            const dmEmbed = new EmbedBuilder()
                .setTitle('A Warning Has Been Cleared!')
                .setDescription(`Warning #${caseNumberToClear} on **${guild.name}** has been cleared by ${moderator.tag}.`)
                .addFields(
                    { name: 'Original Reason', value: warningData.reason || 'No reason provided.' }
                )
                .setColor(0x00FF00) // Green color for positive action
                .setTimestamp();
            await targetUser.send({ embeds: [dmEmbed] }).catch(console.error);

        } catch (error) {
            console.error(`Error clearing specific warning #${caseNumberToClear}:`, error);
            await interaction.editReply({ content: `Failed to clear warning #${caseNumberToClear}. An error occurred.` });
        }
    }
};
