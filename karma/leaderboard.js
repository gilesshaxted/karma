// karma/leaderboard.js
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { collection, query, orderBy, limit, getDocs } = require('firebase/firestore');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Shows the top users by karma points.'),

    async execute(interaction, { db, appId, MessageFlags }) {
        const guildId = interaction.guild.id;

        try {
            const karmaUsersRef = collection(db, `artifacts/${appId}/public/data/guilds/${guildId}/karma_users`);
            const q = query(
                karmaUsersRef,
                orderBy('karmaPoints', 'desc'),
                limit(10) // Top 10 users
            );

            const querySnapshot = await getDocs(q);
            const leaderboard = querySnapshot.docs.map(doc => doc.data());

            const embed = new EmbedBuilder()
                .setTitle(`Karma Leaderboard for ${interaction.guild.name}`)
                .setColor(0xFFD700) // Gold color
                .setTimestamp();

            if (leaderboard.length === 0) {
                embed.setDescription('No karma data available yet. Be active to earn some!');
            } else {
                let description = '';
                for (let i = 0; i < leaderboard.length; i++) {
                    const user = leaderboard[i];
                    description += `**${i + 1}.** ${user.targetUserTag || user.userId} - **${user.karmaPoints}** Karma\n`;
                }
                embed.setDescription(description);
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error(`Error fetching leaderboard for guild ${guildId}:`, error);
            await interaction.editReply({ content: 'There was an error fetching the karma leaderboard.' });
        }
    }
};
