import * as Discord from 'discord.js';
import { FCMemcache } from './fcmemcache'
import { GuildWorker } from './worker'

require('dotenv').config()

import * as _ from "lodash";
import * as memjs from "memjs";
import { MongoClient } from "mongodb";
import { FCMongo } from './fcmongo';

export class FCBot {

    discord: Discord.Client;
    memcache: FCMemcache;
    mongo: FCMongo;
    workers: _.Dictionary<GuildWorker> = {};

    constructor() {
        this.memcache = new FCMemcache();
        this.mongo = new FCMongo();

        this.discord = new Discord.Client();

        // attach events
        this.discord.on('message', this.handleMessage.bind(this));
        this.discord.on('ready', this.handleReady.bind(this));
        this.discord.on('guildCreate', this.handleGuildCreate.bind(this));
        this.discord.on('guildDelete', this.handleGuildDelete.bind(this));
        console.log("Initialized FCBot!");
        this.discord.login(process.env.BOT_TOKEN);
    }

    private getGuildWorker(guild: Discord.Guild): GuildWorker | undefined {
        return this.workers[guild.id];
    }

    reportChannels(toChannel: Discord.TextChannel, worker: GuildWorker) {
        if (worker.channels.length == 0) {
            toChannel.send("No update channel is set.");
        }
        else {
            toChannel.send(`Updates will be sent to ${worker.channels.map(c => "#" + c.name).join(', ')}`)
        }
    }

    async handleMessage(message: Discord.Message) {
        if (message.channel.type != "text")
            return;
        const channel: Discord.TextChannel = <Discord.TextChannel>message.channel;
        const guild = channel.guild;

        if(!guild || message.author.bot) return;

        // it's me, catdoctor
        const MY_USER_ID = "229531028790706177";

        const isAdmin = (message.member.hasPermission('ADMINISTRATOR') || message.author.id == MY_USER_ID);

        if(message.content.indexOf('!') !== 0) return;

        const args = message.content.split(/\s+/g);
        const command = args.shift().toLowerCase();
        const worker = this.getGuildWorker(guild);

        if (!worker) {
            console.log("Received possible command but no worker for guild");
            return;
        }

        if (isAdmin)
            this.doAdminCommand(channel, command, args, worker);
        this.doEveryoneCommand(channel, command, args, worker);
    }

    async doAdminCommand(channel: Discord.TextChannel, command: string, args: string[], worker: GuildWorker) {
        switch (command) {
        case "!fcstop":
            worker.stopSchedule();
            channel.send("Stopping updates.");
            break;
        case "!fcstatus":
            if (worker.running) {
                channel.send("Updates are running for this server.")
            } else {
                channel.send("Updates are not running for this server.")
            }
            this.reportChannels(channel, worker);
            break;
        case "!fcstart":
            try {
                await worker.startSchedule();
                channel.send("Updates active.")
                this.reportChannels(channel, worker);
            }
            catch (err) {
                channel.send("Error starting updates: " + err.message);
            }
            break;
        case "!fcadd":
            if (args.length != 1) {
                channel.send("Use !fcadd <channel name>");
            }
            var channelName = args[0];
            if (channelName[0] == "#") {
                channelName = channelName.substring(1);
            }
            var foundChannel = <Discord.TextChannel>channel.guild.channels.find(
                c => c.name == channelName && c.type == "text"
            );
            if (!foundChannel) {
                channel.send(`I couldn't find a channel matching "${channelName}".`);
            } else if (worker.channels.indexOf(foundChannel) != -1) {
                channel.send(`I'm already sending updates to "${channelName}"`)
            } else {
                worker.channels.push(foundChannel);
            }
            this.reportChannels(channel, worker);
            break;
        case "!fcremove":
            if (args.length != 1) {
                channel.send("Use !fcremove <channel name>");
            }
            var channelName = args[0];
            if (channelName[0] == "#") {
                channelName = channelName.substring(1);
            }
            var foundChannel = <Discord.TextChannel>channel.guild.channels.find(c => c.name == channelName && c.type == "text");
            if (!foundChannel) {
                channel.send(`I couldn't find a channel matching "${channelName}".`);
            } else if (worker.channels.indexOf(foundChannel) == -1) {
                channel.send(`I'm not sending updates to "${channelName}"`)
            } else {
                _.remove(worker.channels, c => c === foundChannel);
            }
            this.reportChannels(channel, worker);
            break;
        case "!fclogin":
            await worker.doFCLogin(args[0], args[1]);
            worker.setLeague(args[2], Number(args[3]));
            channel.send("OK");
            break;
        case "!fcadminhelp":
            channel.send("Commands: !fcstop, !fcstatus, !fcstart, !fcadd, !fcremove");
            break;
        }
    }

    async doEveryoneCommand(channel: Discord.TextChannel, command: string, args: string[], worker: GuildWorker) {
        switch (command) {
        case "!fcscore":
            try {
                await worker.doScoreReport(channel);
            }
            catch (err) {
                channel.send("Error starting updates: " + err.message);
            }
            break;
        case "!fchelp":
            channel.send("Commands: . Also see !fcadminhelp");
            break;
        }
    }

    handleReady() {
        console.log(`Logged in as ${this.discord.user.tag}`);
        var myGuilds: Discord.Collection<string, Discord.Guild>;
        if (process.env.LIMIT_TO_GUILD_ID) {
            myGuilds = this.discord.guilds.filter( (value, key) => key == process.env.LIMIT_TO_GUILD_ID);
        } else {
            myGuilds = this.discord.guilds;
        }
        myGuilds.forEach(g => this.initializeGuild(g));
    }

    handleGuildCreate(guild: Discord.Guild) {
        console.log(`Added to guild "${guild.name}" (${guild.id})`);
        this.initializeGuild(guild);
    }

    handleGuildDelete(guild: Discord.Guild) {
        console.log(`Removed from guild "${guild.name}" (${guild.id})`);
        this.workers[guild.id].stopSchedule();
        delete this.workers[guild.id];
    }

    initializeGuild(guild: Discord.Guild) {
        const worker = new GuildWorker(guild, this.memcache, this.mongo);
        console.log(`New worker created for "${guild.name}" (${guild.id})`)
        this.workers[guild.id] = worker;
        worker.loadState();
    }
}

new FCBot();
