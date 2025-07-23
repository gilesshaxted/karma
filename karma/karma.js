// karma/karma.js
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('karma')
        .setDescription('Shows a user\'s current karma points.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user whose karma to view (defaults to yourself)')
                .setRequired(false)),

    async execute(interaction, { db, appId, MessageFlags, getOrCreateUserKarma }) {
        const targetUser = interaction.options.getUser('target') || interaction.user;
        const guildId = interaction.guild.id;

        try {
            const karmaData = await getOrCreateUserKarma(guildId, targetUser.id);

            const embed = new EmbedBuilder()
                .setTitle(`${targetUser.tag}'s Karma`)
                .setDescription(`Current Karma Points: **${karmaData.karmaPoints}**`)
                .addFields(
                    { name: 'Messages Today', value: `${karmaData.messagesToday}`, inline: true },
                    { name: 'Replies Received Today', value: `${karmaData.repliesReceivedToday}`, inline: true },
                    { name: 'Reactions Received Today', value: `${karmaData.reactionsReceivedToday}`, inline: true },
                    { name: 'Last Activity', value: `<t:${Math.floor(karmaData.lastActivityDate.toDate().getTime() / 1000)}:R>`, inline: true }
                )
                .setColor(0x00FF00) // Green color for karma
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error(`Error fetching karma for ${targetUser.tag}:`, error);
            await interaction.editReply({ content: 'There was an error fetching karma data for that user.' });
        }
    }
};
