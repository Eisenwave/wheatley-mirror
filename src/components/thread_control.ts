import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { denullify, M } from "../utils";
import { is_authorized_admin, rules_channel_id, wheatley_id } from "../common";
import { BotComponent } from "../bot_component";
import { Wheatley } from "../wheatley";
import { Command, CommandBuilder } from "../command";

/*
 * Thread control for threads in thread-based (non-forum) channels
 * Really just:
 * - !rename
 * - !archive
 */

export class ThreadControl extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new CommandBuilder("archive")
                .set_description("Archives the thread")
                .set_handler(this.archive.bind(this))
        );

        this.add_command(
            new CommandBuilder("rename")
                .set_description("Rename the thread")
                .add_string_option({
                    title: "name",
                    description: "Name",
                    required: true
                })
                .set_handler(this.rename.bind(this))
        );
    }

    async get_owner(thread: Discord.ThreadChannel) {
        if(denullify(thread.parent) instanceof Discord.ForumChannel) {
            return thread.ownerId!;/*TODO*/
        } else {
            return thread.type == Discord.ChannelType.PrivateThread ? thread.ownerId!/*TODO*/
                : (await thread.fetchStarterMessage())!/*TODO*/.author.id;
        }
    }

    // returns whether the thread can be controlled
    // or sends an error message
    async try_to_control_thread(request: Command, action: string) {
        const channel = await request.get_channel();
        if(channel.isThread()) {
            const thread = channel;
            const owner_id = await this.get_owner(thread);
            if(owner_id == request.user.id || is_authorized_admin(request.user.id)) {
                return true;
            } else {
                await request.reply({
                    content: `You can only ${action} threads you own`
                });
                return false;
            }
        } else {
            await request.reply({
                content: `You can only ${action} threads`
            });
            return false;
        }
    }

    async archive(command: Command) {
        M.debug("Received archive command", command.user.username, command.get_or_forge_url());
        if(await this.try_to_control_thread(command, "archive")) {
            const channel = await command.get_channel();
            assert(channel.isThread());
            if(channel.parentId == rules_channel_id
            && channel.type == Discord.ChannelType.PrivateThread) {
                await channel.setArchived();
            } else {
                command.reply({
                    content: "You can't use that here",
                    ephemeral_if_possible: true
                });
            }
        }
    }

    async rename(command: Command, name: string) {
        M.log("Received rename command", command.user.username, command.get_or_forge_url());
        if(await this.try_to_control_thread(command, "rename")) {
            const channel = await command.get_channel();
            assert(channel.isThread());
            const thread = channel;
            name = name.trim();
            M.log(`Thread ${thread.id} being renamed to "${name}"`);
            if(name.length > 100) { // TODO
                await command.reply({
                    content: "Thread names must be 100 characters or shorter",
                    ephemeral_if_possible: true
                });
                return;
            }
            await thread.setName(name);
            await command.delete_invocation_if_possible();
            if(command.is_slash()) {
                command.reply("✅", true);
            }
            // fetch first message
            const messages = await thread.messages.fetch({
                after: thread.id,
                limit: 2 // thread starter message, then wheatley's message
            });
            for(const [ _, message ] of messages) {
                if(message.type == Discord.MessageType.Default && message.author.id == wheatley_id) {
                    message.delete();
                }
            }
        }
    }
}
