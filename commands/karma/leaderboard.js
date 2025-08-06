const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { collection, query, orderBy, getDocs } = require('firebase/firestore');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Displays the top Karma earners in the guild.'),
    async execute(interaction, { db, appId, getGuildConfig }) { // Removed MessageFlags from destructuring here, as it's passed globally if needed.
        // Defer reply immediately. This command is intended to be public.
        await interaction.deferReply({ ephemeral: false }); 

        const guild = interaction.guild;
        const guildId = guild.id;

        try {
            // FIX: Query the 'users' collection where karma data is now stored
            const karmaUsersRef = collection(db, `artifacts/${appId}/public/data/guilds/${guildId}/users`);
            // FIX: Order by 'karma' field, which is the karmaSystem's field
            const q = query(karmaUsersRef, orderBy('karma', 'desc')); 
            const querySnapshot = await getDocs(q);

            if (querySnapshot.empty) {
                return interaction.editReply('No Karma data found for this guild yet. Start interacting!');
            }

            const leaderboard = [];
            let rank = 1;
            querySnapshot.forEach(doc => {
                const data = doc.data();
                // Ensure 'karma' field exists and is used
                if (data.karma !== undefined) {
                    // Format the user ID as a Discord mention
                    leaderboard.push(`${rank}. <@${doc.id}> - ${data.karma} Karma`);
                    rank++;
                }
            });

            const embed = new EmbedBuilder()
                .setTitle('Karma Leaderboard')
                .setDescription(leaderboard.join('\n'))
                .setColor(0xFFD700) // Gold color for leaderboard
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error fetching Karma leaderboard:', error);
            await interaction.editReply('Failed to retrieve the Karma leaderboard. An error occurred.', { flags: [MessageFlags.Ephemeral] }); // Ensure ephemeral for error replies
        }
    },
};
