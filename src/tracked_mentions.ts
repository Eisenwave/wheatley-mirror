import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M } from "./utils";
import { action_log_channel_id, color, moderators_role_id, root_role_id, TCCPP_ID } from "./common";

let client: Discord.Client;
let action_log_channel: Discord.TextChannel;

const tracked_mentions = [
	"540314034894012428", // admin role on test server
	root_role_id,
	moderators_role_id,
	"892864085006360626", // red dragon
	"859474976242270249" // wheatly
];

function check_tracked_mention_and_notify(message: Discord.Message) {
	// TODO: only do one message per message, put all tracked roles into it / filter/unique
	for(let [role_id, _] of message.mentions.roles) {
		if(tracked_mentions.indexOf(role_id) > -1) {
			const embed = new Discord.MessageEmbed()
			              .setColor(color)
			              .setAuthor(`${message.author.username}#${message.author.discriminator}`, message.author.displayAvatarURL())
			              .setDescription(`<@&${role_id}> mentioned in <#${message.channel.id}> by <@${message.author.id}>\n[click here to jump](${message.url})`)
			              .setFooter(`ID: ${message.author.id}`)
			              .setTimestamp();
			action_log_channel.send({ embeds: [embed] });
		}
	}
}

function on_message(message: Discord.Message) {
	try {
		if(message.author.id == client.user!.id) return; // Ignore self
		if(message.author.bot) return; // Ignore bots
		if(message.guildId != TCCPP_ID) return; // Ignore messages outside TCCPP (e.g. dm's)
		if(message.mentions.roles.size > 0) {
			check_tracked_mention_and_notify(message);
		}
	} catch(e) {
		critical_error(e);
	}
}

export async function setup_tracked_mentions(_client: Discord.Client) {
	client = _client;
	M.debug("Setting up tracked_mentions");
	client.on("ready", async () => {
		try {
			action_log_channel = await client.channels.fetch(action_log_channel_id) as Discord.TextChannel;
			assert(action_log_channel != null);
			M.debug("tracked_mentions: action_log_channel channel fetched");
			client.on("messageCreate", on_message);
			//tracker.add_submodule({ });
		} catch(e) {
			critical_error(e);
		}
	});
}
