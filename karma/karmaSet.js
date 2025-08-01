// karma/karmaSet.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('karma_set')
        .setDescription('Sets a user\'s Karma points to a specific total.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user to set Karma for')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('total')
                .setDescription('The new total Karma points')
                .setRequired(true)),
    async execute(interaction, { db, appId, getGuildConfig, setKarmaPoints, sendKarmaAnnouncement, getOrCreateUserKarma, client }) { // Added getOrCreateUserKarma, client
        // interaction.deferReply() is handled by index.js for all slash commands.
        // So, we use editReply here.

        const targetUser = interaction.options.getUser('target');
        const newTotal = interaction.options.getInteger('total');
        const moderator = interaction.user;
        const guild = interaction.guild;
        // const guildConfig = await getGuildConfig(guild.id); // Not needed for this command's logic directly

        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

        if (!targetMember) {
            return interaction.editReply('Could not find that user in this server.');
        }

        // Permission check for the invoker is handled by index.js
        // No isExempt check for the target, as all users can receive karma

        try {
            // Using the getOrCreateUserKarma passed in arguments for consistency
            const oldKarmaData = await getOrCreateUserKarma(guild.id, targetUser.id, db, appId);
            const oldKarma = oldKarmaData.karmaPoints;

            await setKarmaPoints(guild.id, targetUser, newTotal, db, appId);

            // Calculate karmaChange for the announcement message (newTotal - oldKarma)
            const karmaChange = newTotal - oldKarma;

            // Send announcement to Karma Channel
            // Pass getGuildConfig as the 5th argument
            await sendKarmaAnnouncement(guild, targetUser.id, karmaChange, newTotal, getGuildConfig, client);

            await interaction.editReply(`Successfully set ${targetUser.tag}'s Karma to ${newTotal}. (Previously ${oldKarma})`);

        } catch (error) {
            console.error(`Error setting Karma for ${targetUser.tag}:`, error);
            await interaction.editReply('Failed to set Karma. An error occurred.');
        }
    },
};
