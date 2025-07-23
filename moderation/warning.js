// moderation/warning.js
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { collection, query, where, getDocs } = require('firebase/firestore');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warning')
        .setDescription('Shows details of a specific warning by its case number.')
        .addIntegerOption(option =>
            option.setName('case_number')
                .setDescription('The case number of the warning')
                .setRequired(true)),

    async execute(interaction, { db, appId, MessageFlags }) {
        const caseNumber = interaction.options.getInteger('case_number');
        const guildId = interaction.guild.id;

        // Path: artifacts/{appId}/public/data/{guildId}/moderation_records
        const moderationRecordsRef = collection(db, `artifacts/${appId}/public/data/guilds/${guildId}/moderation_records`);
        const q = query(
            moderationRecordsRef,
            where("caseNumber", "==", caseNumber),
            where("actionType", "==", "Warning") // Ensure it's a warning record
        );

        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            return interaction.editReply({ content: `No warning found with Case #${caseNumber} in this guild.` });
        }

        const warningData = querySnapshot.docs[0].data();

        const embed = new EmbedBuilder()
            .setTitle(`Warning Details - Case #${warningData.caseNumber}`)
            .setColor(0xFFA500) // Orange
            .addFields(
                { name: 'User', value: `${warningData.targetUserTag} (${warningData.targetUserId})`, inline: true },
                { name: 'Moderator', value: `${warningData.moderatorTag} (${warningData.moderatorId})`, inline: true },
                { name: 'Reason', value: warningData.reason },
                { name: 'Action Type', value: warningData.actionType, inline: true },
                { name: 'Timestamp', value: `<t:${Math.floor(warningData.timestamp.toDate().getTime() / 1000)}:F>`, inline: true }
            )
            .setTimestamp();

        if (warningData.messageLink) {
            embed.addFields({ name: 'Original Message', value: `[Link](${warningData.messageLink})`, inline: true });
        }

        await interaction.editReply({ embeds: [embed] });
    }
};
