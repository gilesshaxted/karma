// karma/karmaMinus.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('karma_minus')
        .setDescription('Subtracts 1 Karma point from a user.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user to remove Karma from')
                .setRequired(true)),
    async execute(interaction, { db, appId, getGuildConfig, subtractKarmaPoints, sendKarmaAnnouncement, client }) {
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
            const newKarma = await subtractKarmaPoints(guild.id, targetUser, 1, db, appId);

            // Send announcement to Karma Channel
            // The function now needs getGuildConfig and client passed to it
            await sendKarmaAnnouncement(guild, targetUser.id, -1, newKarma, getGuildConfig, client);

            await interaction.editReply(`Successfully subtracted 1 Karma point from ${targetUser.tag}. Their new Karma total is ${newKarma}.`);

        } catch (error) {
            console.error(`Error subtracting Karma from ${targetUser.tag}:`, error);
            await interaction.editReply('Failed to subtract Karma. An error occurred.');
        }
    },
};
