# fcbot

Hello and welcome to fcbot!

I didn't know if this would work out or not so there's not that much documentation, but here's what I got.

fcbot is a bot for https://www.fantasycritic.games/ that will show you:
* Any changes to master games (new release dates, new games added, new critic scores)
* Publisher actions in your league (bid won, game dropped, etc)
* New scores in your league ("Blahblah Co is now in 2nd!" etc)
* A leaderboard ("!fcscore")

See below on how to use it.

## Table of contents
- Using fcbot
  - [Setup with a public league](#setup-with-a-public-league)
  - [Setup with a private league](#setup-with-a-public-league)
- Commands
  - [For everyone](#for-everyone)
  - [Admin-only](#admin-only)
- [FAQ](#faq)
- [Hosting your own fcbot](#hosting-your-own-fcbot)

## Using fcbot

You can add fcbot to your Discord, if you're an admin, by going to

https://discord.com/api/oauth2/authorize?client_id=671814513967890459&permissions=2048&scope=bot


Then, you'll have to set it up.


### Setup with a public league

In ANY channel in your server that Fantasy Critic Bot is in:
```
    !fcadd <name of a channel you want updates to go to>
    !fcleague <league ID> <league year>
    !fcstart
```

Example:
```
    !fcadd fantasy-critic
    !fcleague abb1234f-44c0-2c7d-9901-80aa314d26f6 2021
    !fcstart
```

You can find your league ID (and year) in the URL of your league's page. 
https://www.fantasycritic.games/league/YOUR-LEAGUE-ID-HERE/YEAR

### Setup with a private league

In ANY channel in your server that Fantasy Critic Bot is in:
```
    !fcadd <name of a channel you want updates to go to>
    !fclogin <login email> <password> <league ID> <league year>
    !fcstart
```

Example:
```
    !fcadd fantasy-critic
    !fclogin supergreg@gmail.com s3cr3tpa55w0rd abb1234f-44c0-2c7d-9901-80aa314d26f6 2021
    !fcstart
```

Yes, typing your password into discord is a bad, stupid idea. 
You can do it in a private channel, you can delete the message after you 
send it. Sorry. This bot was just for me at first. Hopefully this will improve
soon. It should be in a PM or something.

You can find your league ID (and year) in the URL of your league's page. 
https://www.fantasycritic.games/league/YOUR-LEAGUE-ID-HERE/YEAR

## Command list

### For everyone

 * `!fcscore`: Show a leaderboard for your league.
 * `!fcpub <publisher name>`: searches for a publisher and tells you about it. (List of games.)
 * `!fccheck <search string>`: searches for a game and tells you about it. (Score, classification, release date, etc.)
 * `!fchelp`: Show available commands.

### Admin-only

 * `!fcadd <channel name>`: Add a channel that should receive updates from fcbot.
 * `!fcremove <channel name>`: Remove a channel from receiving updates.
 * `!fcleague <league ID> <league year>`: Set this fcbot to monitor the given public league.
 * `!fclogin <email> <password> <league ID> <league year>`: Set this fcbot to monitor the given private league.
 * `!fcstart`: Begin posting updates to added channels.
 * `!fcstop`: Stop posting any updates.
 * `!fcstatus`: List added channels, whether updates are active, etc.
 * `!fcadminhelp`: Show admin commands.
 * `!fcyear <league year>`: Switch the bot to track the same league, but with a different year. Happy New Year!
 * `!fcfreq <time description or just the word 'default'>`: 

## FAQ

### Why does it sometimes report news twice?

It's an intermittent bug, it will go away. I would like to fix it one day but it doesn't have an obvious solution.
I think it's something to do with memcache.

### Do I need to register FCBot to follow a league to use it?

For now, yes. The Master Game List is different per year, and so FCBot uses your league year to figure out what 
news to give you. If you'd really really like to use FCBot without linking it to a league, you can PM me and 
will try to find some time to add that back in as an option. Currently it seems to not be a common use case.

### It's broken aahhh

I'm on discord as DrCat#2160, send me a PM and I will try to help.

## Hosting your own fcbot

First, you should set up a new bot in the Discord Developer Portal. The permissions you'll need for the bot are "Send Messages" and "Use Application Commands". Grab the bot token for later.

FCBot is designed to be hosted on Heroku. I recommend forking this git repository to start, as you'll be able to set up the automatic deploy during the Heroku setup by pointing to the forked repo.

Set up a new Heroku app. After you name the app, initial setup will show options for how to deploy. Here you can choose to Connect to GitHub. Here you can connect to your GitHub account and point it at the forked FCBot repository mentioned above. This will make deployment easy, if you choose.

You'll need to configure an app with an add-on and a... former add-on.

The add-on is Memcached Cloud, which, surprise, does caching. By adding it to your app it'll automatically set environment variables that fcbot will pick up. 

The other one: At one point, Heroku had a MongoDB add-on, but that seems to have changed, so you will also need an account at mongodb.com for a free MongoDB server. You'll have to set up:
* A database (Databases on the left menu)
* A collection within that database (under Databases, click Browse Collections)
* A database user (under Database Access, create a user and make sure it can access your database and its collections)
That's all pretty quick to get going. Once that's done, go to Databases and click Connect. Choose "Connect Your Application" and you'll see the connection string that looks like `mongodb+srv://username:password@cluster-prod.mocnf.mongodb.net/someDatabaseName?retryWrites=true&w=majority`. That's what you need. Fill in the username, user password, and database name that you created.

Edit your app's config vars and set `MONGODB_URI` to the connection string you have.

Then set `BOT_TOKEN` to the Discord bot token you get from setting up a new bot in Discord. It looks like a bunch of letters with a couple of periods thrown in the middle.

Finally, in your Heroku app, go to the Overview tab. You'll need to Configure your Dynos correctly. Make sure the web Dyno is off and the worker Dyno is on. See here:

![image](https://user-images.githubusercontent.com/4060573/138987954-7e5aa364-1683-4bcc-98b6-7e7978ebbc74.png)

Add your bot to your Discord server(s). The rest should be automatic.
