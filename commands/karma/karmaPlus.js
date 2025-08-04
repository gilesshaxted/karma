// karma/karmaPlus.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('karma_plus')
        .setDescription('Adds 1 Karma point to a user.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user to give Karma to')
                .setRequired(true)),
    async execute(interaction, { db, appId, getGuildConfig, addKarmaPoints, sendKarmaAnnouncement, client }) {
        // interaction.deferReply() is handled by index.js for all slash commands.

        const targetUser = interaction.options.getUser('target');
        const moderator = interaction.user;
        const guild = interaction.guild;
        // getGuildConfig is passed here, so no need to call client.getGuildConfig directly

        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

        if (!targetMember) {
            return interaction.editReply('Could not find that user in this server.');
        }

        try {
            const newKarma = await addKarmaPoints(guild.id, targetUser, 1, db, appId);

            // Send announcement to Karma Channel
            // The function now needs getGuildConfig and client passed to it
            await sendKarmaAnnouncement(guild, targetUser.id, 1, newKarma, getGuildConfig, client);

            await interaction.editReply(`Successfully added 1 Karma point to ${targetUser.tag}. Their new Karma total is ${newKarma}.`);

        } catch (error) {
            console.error(`Error adding Karma to ${targetUser.tag}:`, error);
            await interaction.editReply('Failed to add Karma. An error occurred.');
        }
    },
};
