// karma/karma.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { doc, getDoc } = require('firebase/firestore');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('karma')
        .setDescription('Checks a user\'s Karma points.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user to check Karma for (defaults to yourself)')
                .setRequired(false)),
    async execute(interaction, { db, appId, getGuildConfig }) {
        await interaction.deferReply({ ephemeral: true }); // Always ephemeral for personal karma checks

        const targetUser = interaction.options.getUser('target') || interaction.user;
        const guild = interaction.guild;
        const guildId = guild.id;

        try {
            const karmaData = await interaction.client.karmaSystem.getOrCreateUserKarma(guildId, targetUser.id, db, appId); // Use client's karmaSystem
            const karmaPoints = karmaData.karmaPoints;

            const embed = new EmbedBuilder()
                .setTitle('Karma Points')
                .setDescription(`<@${targetUser.id}> has **${karmaPoints}** Karma points.`)
                .setColor(0x00AE86) // Greenish color
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error(`Error fetching Karma for ${targetUser.tag}:`, error);
            await interaction.editReply('Failed to retrieve Karma. An error occurred.');
        }
    },
};
