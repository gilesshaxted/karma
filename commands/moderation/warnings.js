// moderation/warnings.js
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { collection, query, where, orderBy, limit, startAfter, getDocs, documentId } = require('firebase/firestore'); // Added documentId import

const ITEMS_PER_PAGE = 10;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warnings')
        .setDescription('Lists a user\'s warnings, paginated.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user whose warnings to list')
                .setRequired(true)),

    async execute(interaction, { db, appId, MessageFlags }) {
        const targetUser = interaction.options.getUser('target');
        const guildId = interaction.guild.id;

        // Path: artifacts/{appId}/public/data/{guildId}/moderation_records
        const moderationRecordsRef = collection(db, `artifacts/${appId}/public/data/guilds/${guildId}/moderation_records`);
        const q = query(
            moderationRecordsRef,
            where("targetUserId", "==", targetUser.id),
            where("actionType", "==", "Warning"), // Specifically filter for warnings
            orderBy("timestamp", "desc"),
            orderBy(documentId()), // Crucial: Order by document ID for consistent pagination with composite index
            limit(ITEMS_PER_PAGE + 1) // Fetch one more to check for next page
        );

        const querySnapshot = await getDocs(q);
        const warnings = querySnapshot.docs.map(doc => doc.data());

        const hasNextPage = warnings.length > ITEMS_PER_PAGE;
        const currentWarnings = warnings.slice(0, ITEMS_PER_PAGE);

        const embed = await this.createWarningsEmbed(targetUser, currentWarnings, 1, hasNextPage);
        const components = this.createPaginationButtons(targetUser.id, 1, hasNextPage);

        await interaction.editReply({ embeds: [embed], components: [components] });
    },

    // Helper function to create the embed for warnings
    async createWarningsEmbed(targetUser, warnings, page, hasNextPage) {
        const embed = new EmbedBuilder()
            .setTitle(`Warnings for ${targetUser.tag}`)
            .setColor(0xFFA500) // Orange
            .setFooter({ text: `Page ${page} | Total Warnings: ${warnings.length}${hasNextPage ? '+' : ''}` })
            .setTimestamp();

        if (warnings.length === 0) {
            embed.setDescription(`No warnings found for ${targetUser.tag}.`);
            return embed;
        }

        const description = warnings.map(warn => {
            const timestamp = warn.timestamp ? `<t:${Math.floor(warn.timestamp.toDate().getTime() / 1000)}:R>` : 'N/A';
            const moderatorTag = warn.moderatorTag || 'Unknown Moderator';
            return `**Case #${warn.caseNumber}**\nReason: ${warn.reason}\nModerator: ${moderatorTag}\nWhen: ${timestamp}\n`;
        }).join('\n');

        embed.setDescription(description);
        return embed;
    },

    // Helper function to create pagination buttons
    createPaginationButtons(targetUserId, currentPage, hasNextPage) {
        const row = new ActionRowBuilder();

        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`warnings_page_previous_${targetUserId}_${currentPage}`)
                .setLabel('Previous')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === 1),
            new ButtonBuilder()
                .setCustomId(`warnings_page_next_${targetUserId}_${currentPage}`)
                .setLabel('Next')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(!hasNextPage)
        );
        return row;
    },

    // Handle pagination button interactions
    async handlePagination(interaction, targetUser, action, currentPage, { db, appId, MessageFlags }) {
        const guildId = interaction.guild.id;
        const moderationRecordsRef = collection(db, `artifacts/${appId}/public/data/guilds/${guildId}/moderation_records`);

        let newPage = currentPage;
        if (action === 'next') {
            newPage++;
        } else if (action === 'previous') {
            newPage--;
        }

        const ITEMS_PER_PAGE = 10; // Ensure ITEMS_PER_PAGE is defined here too

        let q;
        if (newPage === 1) {
            q = query(
                moderationRecordsRef,
                where("targetUserId", "==", targetUser.id),
                where("actionType", "==", "Warning"),
                orderBy("timestamp", "desc"),
                orderBy(documentId()), // Crucial: Order by document ID for consistent pagination with composite index
                limit(ITEMS_PER_PAGE + 1)
            );
        } else {
            // To get the starting point for the new page, we need to fetch the last document of the *previous* page.
            // This is done by querying for the previous page's data and getting its last document snapshot.
            const qPrevPage = query(
                moderationRecordsRef,
                where("targetUserId", "==", targetUser.id),
                where("actionType", "==", "Warning"),
                orderBy("timestamp", "desc"),
                orderBy(documentId()), // Also order by document ID for consistency
                limit((newPage - 1) * ITEMS_PER_PAGE) // Get all documents up to the start of the current page
            );
            const prevPageSnapshot = await getDocs(qPrevPage);
            const lastDocOfPrevPage = prevPageSnapshot.docs[prevPageSnapshot.docs.length - 1];

            if (!lastDocOfPrevPage && newPage > 1) {
                // If we tried to go back to a page that doesn't exist, or forward beyond available data
                await interaction.followUp({ content: 'No more warnings found in that direction.', flags: [MessageFlags.Ephemeral] });
                return;
            }

            q = query(
                moderationRecordsRef,
                where("targetUserId", "==", targetUser.id),
                where("actionType", "==", "Warning"),
                orderBy("timestamp", "desc"),
                orderBy(documentId()), // Crucial: Order by document ID for consistent pagination with composite index
                startAfter(lastDocOfPrevPage),
                limit(ITEMS_PER_PAGE + 1)
            );
        }

        const querySnapshot = await getDocs(q);
        const warnings = querySnapshot.docs.map(doc => doc.data());

        const hasNextPage = warnings.length > ITEMS_PER_PAGE;
        const currentWarnings = warnings.slice(0, ITEMS_PER_PAGE);

        const embed = await this.createWarningsEmbed(targetUser, currentWarnings, newPage, hasNextPage);
        const components = this.createPaginationButtons(targetUser.id, newPage, hasNextPage);

        await interaction.editReply({ embeds: [embed], components: [components] });
    }
};
