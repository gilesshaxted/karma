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
    async execute(interaction, { db, appId, getGuildConfig, addKarmaPoints }) { // Removed hasPermission, isExempt, logModerationAction
        // interaction.deferReply() is handled by bot.js for all slash commands.
        // So, we use editReply here.

        const targetUser = interaction.options.getUser('target');
        const moderator = interaction.user;
        const guild = interaction.guild;
        // const guildConfig = await getGuildConfig(guild.id); // Not needed for this command's logic directly

        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

        if (!targetMember) {
            return interaction.editReply('Could not find that user in this server.');
        }

        // Permission check for the invoker is handled by bot.js
        // No isExempt check for the target, as all users can receive karma

        try {
            const newKarma = await addKarmaPoints(guild.id, targetUser, 1, db, appId);

            // No logging to mod-logs for karma commands
            // No case number increment for karma commands

            await interaction.editReply(`Successfully added 1 Karma point to ${targetUser.tag}. Their new Karma total is ${newKarma}.`);

        } catch (error) {
            console.error(`Error adding Karma to ${targetUser.tag}:`, error);
            await interaction.editReply('Failed to add Karma. An error occurred.');
        }
    },
};
