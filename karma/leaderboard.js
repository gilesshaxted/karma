// karma/leaderboard.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { collection, query, orderBy, getDocs } = require('firebase/firestore');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Displays the top Karma earners in the guild.'),
    async execute(interaction, { db, appId, getGuildConfig }) {
        // interaction.deferReply() is now handled by bot.js for all slash commands.
        // REMOVED: await interaction.deferReply({ ephemeral: false });

        const guild = interaction.guild;
        const guildId = guild.id;

        try {
            const karmaUsersRef = collection(db, `artifacts/${appId}/public/data/guilds/${guildId}/karma_users`);
            const q = query(karmaUsersRef, orderBy('karmaPoints', 'desc'));
            const querySnapshot = await getDocs(q);

            if (querySnapshot.empty) {
                return interaction.editReply('No Karma data found for this guild yet. Start interacting!');
            }

            const leaderboard = [];
            let rank = 1;
            querySnapshot.forEach(doc => {
                const data = doc.data();
                // Format the user ID as a Discord mention
                leaderboard.push(`${rank}. <@${data.userId}> - ${data.karmaPoints} Karma`);
                rank++;
            });

            const embed = new EmbedBuilder()
                .setTitle('Karma Leaderboard')
                .setDescription(leaderboard.join('\n'))
                .setColor(0xFFD700) // Gold color for leaderboard
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error fetching Karma leaderboard:', error);
            await interaction.editReply('Failed to retrieve the Karma leaderboard. An error occurred.');
        }
    },
};
