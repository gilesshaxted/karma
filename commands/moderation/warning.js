const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
// Removed direct Firestore imports like collection, query, where, getDocs
// as karmaSystem.getOrCreateUserKarma will handle the Firestore interaction.

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warning')
        .setDescription('Shows details of a specific warning by its case number.')
        .addIntegerOption(option =>
            option.setName('case_number')
                .setDescription('The case number of the warning')
                .setRequired(true)),

    async execute(interaction, { client, db, appId, karmaSystem }) { // Added 'client', 'karmaSystem'
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }); // Defer reply ephemerally

        const caseNumber = interaction.options.getInteger('case_number');
        const guildId = interaction.guild.id;
        const targetUserOption = interaction.options.getUser('target'); // User might not be explicitly targeted in this command, but needed for data lookup

        // Fetch all users in the guild to find the warning
        // NOTE: This is a less efficient approach if you have many users and case numbers
        // are not unique per user. A better approach would be to require a target user
        // or have a separate collection for all moderation records if case numbers are global.
        // For now, we'll iterate through all users' warnings.

        let foundWarning = null;
        let targetUser = null;

        // Fetch all users' karma data to find the warning
        // This is inefficient for large numbers of users.
        // A better approach for a global case number would be a separate 'moderation_records' collection
        // where each record has a unique caseNumber and targetUserId.
        // For now, we'll search through all user documents.
        const usersCollectionRef = collection(db, `artifacts/${appId}/public/data/guilds/${guildId}/users`);
        const querySnapshot = await getDocs(usersCollectionRef);

        for (const docSnapshot of querySnapshot.docs) {
            const userData = docSnapshot.data();
            const warnings = userData.warnings || [];
            const found = warnings.find(w => w.caseNumber === caseNumber);
            if (found) {
                foundWarning = found;
                targetUser = await client.users.fetch(docSnapshot.id).catch(() => null); // Fetch the actual Discord User object
                break;
            }
        }

        if (!foundWarning || !targetUser) {
            return interaction.editReply({ content: `No warning found with Case #${caseNumber} in this guild.`, flags: [MessageFlags.Ephemeral] });
        }

        const embed = new EmbedBuilder()
            .setTitle(`Warning Details - Case #${foundWarning.caseNumber}`)
            .setColor(0xFFA500) // Orange
            .addFields(
                { name: 'User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
                { name: 'Moderator', value: `${foundWarning.moderatorTag || 'Unknown'} (${foundWarning.moderatorId || 'N/A'})`, inline: true }, // Assuming moderator info is stored in warningData
                { name: 'Rule', value: foundWarning.rule || 'N/A', inline: true },
                { name: 'Reason', value: foundWarning.reason || 'No reason provided.' },
                { name: 'Timestamp', value: `<t:${Math.floor(foundWarning.timestamp / 1000)}:F>`, inline: true }
            )
            .setTimestamp();

        if (foundWarning.messageContent) {
            embed.addFields({ name: 'Original Message Content', value: `\`\`\`${foundWarning.messageContent.substring(0, 1000)}\`\`\``, inline: false });
        }
        // If you had a messageLink stored in the warning object:
        // if (foundWarning.messageLink) {
        //     embed.addFields({ name: 'Original Message Link', value: `[Link](${foundWarning.messageLink})`, inline: false });
        // }

        await interaction.editReply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
    }
};
