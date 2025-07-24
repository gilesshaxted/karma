// moderation/kick.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    // Slash command data
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kicks a user from the server.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user to kick')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('The reason for the kick')
                .setRequired(false)),

    // Execute function for slash command
    async execute(interaction, { getGuildConfig, saveGuildConfig, hasPermission, isExempt, logModerationAction, logMessage }) {
        const targetUser = interaction.options.getUser('target');
        const reason = interaction.options.getString('reason') || 'No reason provided.';
        const moderator = interaction.user;
        const guild = interaction.guild;
        const guildConfig = await getGuildConfig(guild.id);

        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

        if (!targetMember) {
            return interaction.editReply({ content: 'Could not find that user in this server.' });
        }

        // Check if the target is exempt
        if (isExempt(targetMember, guildConfig)) {
            return interaction.editReply({ content: 'You cannot kick this user as they are exempt from moderation.' });
        }

        guildConfig.caseNumber++;
        await saveGuildConfig(guild.id, guildConfig);
        const caseNumber = guildConfig.caseNumber;

        try {
            // Delete messages from the last 24 hours
            const messagesToDelete = await interaction.channel.messages.fetch({ limit: 100 }); // Fetch recent messages
            const messagesFromTarget = messagesToDelete.filter(msg =>
                msg.author.id === targetUser.id &&
                (Date.now() - msg.createdTimestamp) < (24 * 60 * 60 * 1000) // Last 24 hours
            );

            if (messagesFromTarget.size > 0) {
                for (const msg of messagesFromTarget.values()) {
                    if (msg.deletable) {
                        await msg.delete().catch(console.error);
                        // Pass getGuildConfig to logMessage
                        await logMessage(guild, msg, moderator, 'Deleted (Kick)', getGuildConfig);
                    }
                }
                console.log(`Deleted ${messagesFromTarget.size} messages from ${targetUser.tag} for kick.`);
            }

            // Attempt to send a DM to the kicked user
            const dmEmbed = new EmbedBuilder()
                .setTitle('You have been kicked!')
                .setDescription(`**Server:** ${guild.name}\n**Reason:** ${reason}\n**Moderator:** ${moderator.tag}`)
                .setColor(0xFFA500)
                .setTimestamp();
            await targetUser.send({ embeds: [dmEmbed] }).catch(console.error);

            await targetMember.kick(reason);

            // Log the moderation action (passing getGuildConfig, db, appId from index.js via interaction.client context)
            await logModerationAction(guild, 'Kick', targetUser, reason, moderator, caseNumber, null, null, getGuildConfig, interaction.client.db, interaction.client.appId);

            await interaction.editReply({ content: `Successfully kicked ${targetUser.tag} for: ${reason} (Case #${caseNumber})` });
        } catch (error) {
            console.error(`Error kicking user ${targetUser.tag}:`, error);
            await interaction.editReply({ content: `Failed to kick ${targetUser.tag}. Make sure the bot has permissions and its role is above the target's highest role, and that the user's DMs are open.` });
        }
    },

    // Execute function for emoji-based moderation
    async executeEmoji(message, targetMember, reason, moderator, caseNumber, { logModerationAction, logMessage }) {
        const guild = message.guild;
        const targetUser = targetMember.user;

        try {
            // Delete messages from the last 24 hours (from the channel where the emoji was reacted)
            const messagesToDelete = await message.channel.messages.fetch({ limit: 100 }); // Fetch recent messages
            const messagesFromTarget = messagesToDelete.filter(msg =>
                msg.author.id === targetUser.id &&
                (Date.now() - msg.createdTimestamp) < (24 * 60 * 60 * 1000) // Last 24 hours
            );

            if (messagesFromTarget.size > 0) {
                for (const msg of messagesFromTarget.values()) {
                    if (msg.deletable) {
                        await msg.delete().catch(console.error);
                        // Pass getGuildConfig to logMessage
                        await logMessage(guild, msg, moderator, 'Deleted (Emoji Kick)', message.client.getGuildConfig);
                    }
                }
                console.log(`Deleted ${messagesFromTarget.size} messages from ${targetUser.tag} for emoji kick.`);
            }

            // Attempt to send a DM to the kicked user
            const dmEmbed = new EmbedBuilder()
                .setTitle('You have been kicked!')
                .setDescription(`**Server:** ${guild.name}\n**Reason:** ${reason}\n**Moderator:** ${moderator.tag}`)
                .setColor(0xFFA500)
                .setTimestamp();
            await targetUser.send({ embeds: [dmEmbed] }).catch(console.error);

            // Log the moderation action (passing getGuildConfig, db, appId from index.js via message.client context)
            await logModerationAction(guild, 'Kick (Emoji)', targetUser, reason, moderator, caseNumber, null, message.url, message.client.getGuildConfig, message.client.db, message.client.appId);

            console.log(`Successfully kicked ${targetUser.tag} via emoji for: ${reason} (Case #${caseNumber})`);
        } catch (error) {
            console.error(`Error kicking user ${targetUser.tag} via emoji:`, error);
        }
    }
};
