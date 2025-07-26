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
    async execute(interaction, { db, appId, getGuildConfig, hasPermission, subtractKarmaPoints }) { // Removed isExempt, logModerationAction
        // interaction.deferReply() is handled by bot.js for all slash commands.
        // So, we use editReply here.

        const targetUser = interaction.options.getUser('target');
        const moderator = interaction.user;
        const guild = interaction.guild;
        const guildConfig = await getGuildConfig(guild.id);

        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

        if (!targetMember) {
            return interaction.editReply('Could not find that user in this server.');
        }

        // Permission check for the invoker is handled by bot.js
        // No isExempt check for the target, as all users can receive karma

        try {
            const newKarma = await subtractKarmaPoints(guild.id, targetUser, 1, db, appId);

            // No logging to mod-logs for karma commands
            // No case number increment for karma commands

            await interaction.editReply(`Successfully subtracted 1 Karma point from ${targetUser.tag}. Their new Karma total is ${newKarma}.`);

        } catch (error) {
            console.error(`Error subtracting Karma from ${targetUser.tag}:`, error);
            await interaction.editReply('Failed to subtract Karma. An error occurred.');
        }
    },
};
