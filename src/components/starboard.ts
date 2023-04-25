import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { KeyedMutexSet, M, SelfClearingSet, departialize, unwrap } from "../utils.js";
import { MINUTE, announcements_channel_id, introductions_channel_id, is_authorized_admin, memes_channel_id,
         resources_channel_id, rules_channel_id, server_suggestions_channel_id, starboard_channel_id,
         the_button_channel_id } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { make_quote_embeds } from "./quote.js";
import { TextBasedCommand, TextBasedCommandBuilder } from "../command.js";

type database_schema = {
    negative_emojis: string[];
    delete_emojis: string[];
    starboard: Record<string, string>;
};

const star_threshold = 5;
const memes_star_threshold = 14;
const other_threshold = 7;
const memes_other_threshold = 14;

const auto_delete_threshold = 10;

const excluded_channels = new Set([
    rules_channel_id,
    announcements_channel_id,
    server_suggestions_channel_id,
    resources_channel_id,
    the_button_channel_id,
    introductions_channel_id,
    starboard_channel_id
]);

// https://stackoverflow.com/questions/64053658/get-emojis-from-message-discord-js-v12
// https://www.reddit.com/r/Discord_Bots/comments/gteo6t/discordjs_is_there_a_way_to_detect_emojis_in_a/
const EMOJIREGEX = /((?<!\\)<a?:[^:]+:(\d+)>)|\p{Emoji_Presentation}|\p{Extended_Pictographic}/gmu;

export class Starboard extends BotComponent {
    data: database_schema;
    mutex = new KeyedMutexSet<string>();
    notified_about_auto_delete_threshold = new SelfClearingSet<string>(24 * 60 * MINUTE);

    constructor(wheatley: Wheatley) {
        super(wheatley);
        if(!this.wheatley.database.has("starboard")) {
            this.data = {
                negative_emojis: [],
                delete_emojis: [],
                starboard: {}
            };
        } else {
            this.data = this.wheatley.database.get<database_schema>("starboard");
        }
        this.update_database();

        this.add_command(
            new TextBasedCommandBuilder("add-negative-emoji")
                .set_description("Register a negative emoji")
                .add_string_option({
                    title: "emojis",
                    description: "emojis",
                    required: true
                })
                .set_permissions(Discord.PermissionFlagsBits.Administrator)
                .set_handler(this.add_negative_emoji.bind(this))
        );

        this.add_command(
            new TextBasedCommandBuilder("add-delete-emoji")
                .set_description("Register a delete emoji")
                .add_string_option({
                    title: "emojis",
                    description: "emojis",
                    required: true
                })
                .set_permissions(Discord.PermissionFlagsBits.Administrator)
                .set_handler(this.add_delete_emoji.bind(this))
        );

        this.add_command(
            new TextBasedCommandBuilder("list-starboard-config")
                .set_description("List starboard config")
                .set_permissions(Discord.PermissionFlagsBits.Administrator)
                .set_handler(this.list_config.bind(this))
        );
    }

    async update_database() {
        this.wheatley.database.set<database_schema>("starboard", this.data);
        await this.wheatley.database.update();
    }

    reactions_string(message: Discord.Message) {
        M.info("reactions string:", message.url, message.reactions.cache.map(reaction => reaction));
        return [
            ...message.reactions.cache
                .map(reaction => reaction)
                .filter(({ emoji }) => emoji instanceof Discord.GuildEmoji || emoji.id === null)
                .sort((a, b) => b.count - a.count)
                .map(({ emoji, count }) => `${emoji.id ? `<:${emoji.name}:${emoji.id}>` : emoji.name} **${count}**`),
            `<#${message.channel.id}>`
        ].join(" | ");
    }

    meets_threshold(reaction: Discord.MessageReaction) {
        assert(reaction.emoji.name);
        if(!(reaction.emoji instanceof Discord.GuildEmoji || reaction.emoji.id === null)) return false;
        if(reaction.emoji.name == "⭐") {
            if(reaction.message.channel.id == memes_channel_id) {
                return reaction.count >= memes_star_threshold;
            } else {
                return reaction.count >= star_threshold;
            }
        } else if(!this.data.negative_emojis.includes(reaction.emoji.name)) {
            if(reaction.message.channel.id == memes_channel_id) {
                return reaction.count >= memes_other_threshold;
            } else {
                return reaction.count >= other_threshold;
            }
        }
        return false;
    }

    async is_valid_channel(channel: Discord.GuildTextBasedChannel | Discord.TextBasedChannel) {
        return !excluded_channels.has(channel.id) && !(channel instanceof Discord.ForumChannel) && !channel.isDMBased();
    }

    async update_starboard(message: Discord.Message) {
        this.mutex.lock(message.id);
        try {
            const make_embeds = () => make_quote_embeds(
                [message],
                undefined,
                this.wheatley,
                true,
                "\n\n**[Jump to message!]($$)**"
            );
            if(message.id in this.data.starboard) {
                // edit
                const starboard_message = await this.wheatley.starboard_channel.messages.fetch(
                    this.data.starboard[message.id]
                );
                await starboard_message.edit({
                    content: this.reactions_string(message),
                    ...await make_embeds()
                });
            } else {
                // send
                const starboard_message = await this.wheatley.starboard_channel.send({
                    content: this.reactions_string(message),
                    ...await make_embeds()
                });
                this.data.starboard[message.id] = starboard_message.id;
            }
        } finally {
            this.mutex.unlock(message.id);
        }
        await this.update_database();
    }

    async handle_auto_delete(message: Discord.Message, delete_reaction: Discord.MessageReaction) {
        const reactions = message.reactions.cache.map(r => [ r.emoji, r.count ] as [Discord.Emoji, number]);
        const non_negative_reactions = reactions.filter(
            ([ emoji, _ ]) => !this.data.negative_emojis.includes(unwrap(emoji.name))
                && !this.data.delete_emojis.includes(unwrap(emoji.name))
        );
        const max_non_negative = Math.max(...non_negative_reactions.map(([ emoji, count ]) => count)); // -inf if |a|=0
        let do_delete = true;
        if(message.channel.id != memes_channel_id) {
            do_delete = false;
        }
        if(delete_reaction.count <= max_non_negative) {
            do_delete = false;
        }
        if(is_authorized_admin(message.author.id) || message.author.bot) {
            do_delete = false;
        }
        const action = do_delete ? "Auto-deleting" : "Auto-delete threshold reached";
        M.log(`${action} ${message.url} for ${delete_reaction.count} ${delete_reaction.emoji.name} reactions`);
        if(do_delete || !this.notified_about_auto_delete_threshold.has(message.id)) {
            await this.wheatley.staff_action_log_channel.send({
                content: `${action} message from <@${message.author.id}> for `
                    + `${delete_reaction.count} ${delete_reaction.emoji.name} reactions`
                    + `\n${await this.reactions_string(message)}`,
                ...await make_quote_embeds(
                    [message],
                    undefined,
                    this.wheatley,
                    true
                )
            });
            this.notified_about_auto_delete_threshold.insert(message.id);
        }
        if(do_delete) {
            await message.delete();
            await message.channel.send(
                `<@${message.author.id}> A message of yours was automatically deleted because a threshold for`
                + " <:delet_this:669598943117836312> reactions (or similar) was reached.\n\n"
                + "FAQ: How can I avoid this in the future?\n"
                + "Answer: Post less cringe"
            );
        }
    }

    override async on_reaction_add(
        reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
        user: Discord.User                | Discord.PartialUser
    ) {
        if(!await this.is_valid_channel(reaction.message.channel)) {
            return;
        }
        if(reaction.partial) {
            reaction = await reaction.fetch();
        }
        // Check delete emojis
        if(
            reaction.emoji.name && this.data.delete_emojis.includes(reaction.emoji.name)
            && reaction.count >= auto_delete_threshold
            //&& !is_authorized_admin((await departialize(reaction.message)).author.id)
        ) {
            await this.handle_auto_delete(await departialize(reaction.message), reaction);
            return;
        }
        if(reaction.message.id in this.data.starboard) {
            // Update counts
            await this.update_starboard(await departialize(reaction.message));
        } else if(this.meets_threshold(await departialize(reaction))) {
            // Send
            await this.update_starboard(await departialize(reaction.message));
        }
    }

    override async on_reaction_remove(
        reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
        user: Discord.User                | Discord.PartialUser
    ) {
        if(!await this.is_valid_channel(reaction.message.channel)) {
            return;
        }
        if(reaction.message.id in this.data.starboard) {
            // Update counts
            await this.update_starboard(await departialize(reaction.message));
        }
    }

    override async on_message_update(
        old_message: Discord.Message<boolean> | Discord.PartialMessage,
        new_message: Discord.Message<boolean> | Discord.PartialMessage
    ) {
        if(!await this.is_valid_channel(new_message.channel)) {
            return;
        }
        assert(old_message.id == new_message.id);
        if(old_message.id in this.data.starboard) {
            // Update content
            await this.update_starboard(await departialize(new_message));
        }
    }

    override async on_message_delete(message: Discord.Message<boolean> | Discord.PartialMessage) {
        if(message.id in this.data.starboard) {
            this.mutex.lock(message.id);
            try {
                await this.wheatley.starboard_channel.messages.delete(this.data.starboard[message.id]);
                delete this.data.starboard[message.id];
            } finally {
                this.mutex.unlock(message.id);
            }
            await this.update_database();
        }
    }

    async add_negative_emoji(command: TextBasedCommand, arg: string) {
        const emojis = arg.match(EMOJIREGEX);
        if(emojis) {
            const names = emojis.map(emoji => emoji.startsWith("<") ? emoji.split(":")[1] : emoji);
            this.data.negative_emojis.push(...names);
            await command.reply(`Added ${names.join(", ")} to the negative emojis`);
            await this.update_database();
        }
    }

    async add_delete_emoji(command: TextBasedCommand, arg: string) {
        const emojis = arg.match(EMOJIREGEX);
        if(emojis) {
            const names = emojis.map(emoji => emoji.startsWith("<") ? emoji.split(":")[1] : emoji);
            this.data.delete_emojis.push(...names);
            await command.reply(`Added ${names.join(", ")} to the delete emojis`);
            await this.update_database();
        }
    }

    async list_config(command: TextBasedCommand) {
        await command.reply([
            `Negative emojis: ${this.data.negative_emojis.join(", ")}`,
            `Delete emojis: ${this.data.delete_emojis.join(", ")}`
        ].join("\n"));
    }
}
