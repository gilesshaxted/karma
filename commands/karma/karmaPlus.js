const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('karma_plus')
        .setDescription('Adds 1 Karma point to a user.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user to give Karma to')
                .setRequired(true)),
    async execute(interaction, { client, db, appId, getGuildConfig, addKarmaPoints, karmaSystem }) { // Removed sendKarmaAnnouncement from direct destructuring
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }); // Defer reply ephemerally

        const targetUser = interaction.options.getUser('target');
        const moderator = interaction.user;
        const guild = interaction.guild;

        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

        if (!targetMember) {
            return interaction.editReply({ content: 'Could not find that user in this server.', flags: [MessageFlags.Ephemeral] });
        }

        try {
            const newKarma = await addKarmaPoints(guild.id, targetUser, 1, db, appId);

            // Send announcement to Karma Channel
            // Now correctly accessing sendKarmaAnnouncement from karmaSystem
            await karmaSystem.sendKarmaAnnouncement(guild, targetUser.id, 1, newKarma, client.getGuildConfig, client);

            await interaction.editReply({ content: `Successfully added 1 Karma point to ${targetUser.tag}. Their new Karma total is ${newKarma}.` });

        } catch (error) {
            console.error(`Error adding Karma to ${targetUser.tag}:`, error);
            await interaction.editReply({ content: 'Failed to add Karma. An error occurred.', flags: [MessageFlags.Ephemeral] });
        }
    },
};
