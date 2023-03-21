/* Dependencies  */
require('dotenv').config();
const express = require('express');
const request = require('request');
const crypto = require('crypto')
const ws = require('ws');
const tmi = require('tmi.js');
const axios = require('axios');
const https = require('https');
const Govee = require("node-govee-led");
const fs = require('fs');

const port = 443;
const app = express();
const httpsServer = require('https').createServer({
    key: fs.readFileSync("cert/key.pem"),
    cert: fs.readFileSync("cert/cert.pem")
}, app)

/* Twitch Commands */
/* 
${VARIABLE} - from twitch, channel, tags, or message
%{VARIABLE} - variables that need to be calculated in a function
^{VARIABLE} - from user database
*/
const commandCooldown = 5 // seconds
let commandCooldownTimer = new Date();
let commands = {
    gold: '@${username}, you have ^{gold} Gold!',
    level: '@${username}, you are ^{level_data}!',
    faction: '@${username}, ^{faction_data}!',
    socials: '@${username}, https://linktr.ee/poberts'
}

/* Connections */
// Govee Light Strips
const GoveeLightStrip = new Govee({
	apiKey: process.env.GOVEE_API_KEY,
	mac: process.env.GOVEE_MAC_ADDRESS,
	model: process.env.GOVEE_DEVICE_MODEL
});

// Database Connection
const mariadb = require('mariadb');
const { restart } = require('nodemon');
const { send } = require('process');
const pool = mariadb.createPool({
     host: process.env.DATABASE_ENDPOINT, 
     user: process.env.DATABASE_USERNAME, 
     password: process.env.DATABASE_PASSWORD
});

// Twitch Connection
let client_twitch_access_token = ""
let access_token = ""
const client = new tmi.Client({
	options: { debug: true },
	identity: {
		username: process.env.TWITCH_BOT_NAME,
		password: process.env.TWITCH_BOT_PASSWORD
	},
	channels: [process.env.TWITCH_CHANNEL_NAME]
});
client.connect().catch(console.error).then(() => {
    traveling();
});

// Send data to client
function sendToClients(data) {
    clients.forEach(function(client) {
        client.send(JSON.stringify(data));
    });
}

// Twitch Event Sub
const eventTypes = [
    "channel.update",
    "channel.follow",
    "channel.subscribe",
    "channel.subscription.gift",
    "channel.subscription.message",
    "channel.cheer",
    "channel.raid",
    "channel.channel_points_custom_reward.add",
    "channel.channel_points_custom_reward.update",
    "channel.channel_points_custom_reward_redemption.add",
    "channel.prediction.begin",
    "channel.prediction.progress",
    "channel.prediction.lock",
    "channel.prediction.end",
    "stream.online",
    "stream.offline"
];

axios.post("https://id.twitch.tv/oauth2/token" +
    "?client_id=" + process.env.TWITCH_AUTH_CLIENT_ID +
    "&client_secret=" + process.env.TWITCH_AUTH_CLIENT_SECRET +
    "&grant_type=client_credentials" +
    "&scope=analytics:read:extensions analytics:read:games bits:read channel:edit:commercial " +
    "channel:manage:broadcast channel:manage:extensions channel:manage:polls channel:manage:predictions " +
    "channel:manage:redemptions channel:manage:schedule channel:manage:videos channel:read:editors " +
    "channel:read:goals channel:read:hype_train channel:read:polls channel:read:predictions " +
    "channel:read:redemptions channel:read:stream_key channel:read:subscriptions clips:edit moderation:read " +
    "moderator:manage:banned_users moderator:read:blocked_terms moderator:manage:blocked_terms " +
    "moderator:manage:automod moderator:read:automod_settings moderator:manage:automod_settings " +
    "moderator:read:chat_settings moderator:manage:chat_settings user:edit user:edit:follows " +
    "user:manage:blocked_users user:read:blocked_users user:read:broadcast user:read:email user:read:follows " +
    "user:read:subscriptions channel:moderate chat:edit chat:read whispers:read whispers:edit").then(response => {

    const responseData = response.data;
    access_token = responseData.access_token;
    emotesEveryHour();

    for (let i = 0; i < eventTypes.length; i++) {
        axios.post(process.env.NGROK_URL + "/createWebhook?eventType=" + eventTypes[i])
            .then(() => {
                console.log("Webhook successfully established");
            })
            .catch(webhookError => {
                console.log("Webhook creation error: " + webhookError);
            });
    }
}).catch(error => {
    console.log(error);
});

const verifyTwitchWebhookSignature = (request, response, buffer, encoding) => {
    const twitchMessageID = request.header("Twitch-Eventsub-Message-Id");
    const twitchTimeStamp = request.header("Twitch-Eventsub-Message-Timestamp");
    const twitchMessageSignature = request.header("Twitch-Eventsub-Message-Signature");
    const currentTimeStamp = Math.floor(new Date().getTime() / 1000);

    if (Math.abs(currentTimeStamp - twitchTimeStamp) > 600) {
        throw new Error("Signature is older than 10 minutes. Ignore this request.");
    }
    if (!process.env.TWITCH_SIGNING_SECRET) {
        throw new Error("The Twitch signing secret is missing.");
    }

    const ourMessageSignature = "sha256=" +
        crypto.createHmac("sha256", process.env.TWITCH_SIGNING_SECRET)
            .update(twitchMessageID + twitchTimeStamp + buffer)
            .digest("hex");

    if (twitchMessageSignature !== ourMessageSignature) {
        throw new Error("Invalid signature");
    }
};

const twitchWebhookEventHandler = (webhookEvent) => {
    // Get type
    const type = webhookEvent.subscription.type;
    const username = webhookEvent.event.user_name;
    const userID = webhookEvent.event.user_id;

    // New Follower
    if(type == 'channel.follow') {
        let followData = {
            type: 'follow',
            username: username,
        }
        sendToClients(followData)
    }

    // New Subscriber
    if(type == 'channel.subscription.message') {        
        let subscriberData = {
            type: 'subscribe',
            username: username,
            tier: webhookEvent.event.tier,
            message: webhookEvent.event.message.text,
            duration: webhookEvent.event.cumulative_months
        }

        sendToClients(subscriberData)
    }

    // Gifted Subs
    if(type == 'channel.subscription.gift') {
        let giftedData = {
            type: 'gifted',
            username: username,
            tier: webhookEvent.event.tier,
            amount: webhookEvent.event.total,
            isAnon: webhookEvent.event.is_anonymous
        }

        sendToClients(giftedData)
    }

    // Cheer
    if(type == 'channel.cheer' && webhookEvent.event.bits >= 100) {
        let cheerData = {
            type: 'cheer',
            username: username,
            amount: webhookEvent.event.bits,
            isAnon: webhookEvent.event.is_anonymous
        }

        sendToClients(cheerData)
    }

    // Channel Point Rewards
    if(type == 'channel.channel_points_custom_reward_redemption.add') {
        // Create mission
        if(webhookEvent.event.reward.id == joinMissionRewardID){
            createMission(username, userID, webhookEvent.event.id);
        }
        
        // Join mission
        if(missionHostIDs.includes(webhookEvent.event.reward.id)){
            joinMission(username, userID, webhookEvent.event.reward.prompt, webhookEvent.event.id, webhookEvent.event.reward.id);
        }

        // TODO Join a faction
    }
};

app.use(express.json({verify: verifyTwitchWebhookSignature}));

app.post('/twitchwebhooks/callback',
    async (request, response) => {
    // Handle the Twitch webhook challenge
    if (request.header("Twitch-EventSub-Message-Type") === "webhook_callback_verification") {
        console.log("Verifying the Webhook is from Twitch");
        response.writeHead(200, {"Content-Type": "text/plain"});
        response.write(request.body.challenge);

        return response.end();
    }

    // Handle the Twitch event
    const eventBody = request.body;
    twitchWebhookEventHandler(eventBody);
    response.status(200).end();
});

app.post('/createWebhook', (request, response) => {
    let createWebhookParameters = {
        host: "api.twitch.tv",
        path: "helix/eventsub/subscriptions",
        method: 'POST',
        headers: {
            "Content-Type": "application/json",
            "Client-ID": process.env.TWITCH_AUTH_CLIENT_ID,
            "Authorization": "Bearer " + access_token
        }
    };
    
    let createWebhookBody = {
        "type": request.query.eventType,
        "version": "1",
        "condition": {
            "broadcaster_user_id": process.env.TWITCH_CHANNEL_ID,
        },
        "transport": {
            "method": "webhook",
            "callback": process.env.NGROK_URL + "/twitchwebhooks/callback",
            "secret": process.env.TWITCH_SIGNING_SECRET
        }
    };
    
    let responseData = "";
    let webhookRequest = https.request(createWebhookParameters, (result) => {
        result.setEncoding('utf8');
        result.on('data', function (data) {
            responseData = responseData + data;
        }).on('end', function (result) {
            let responseBody = JSON.parse(responseData);
            response.send(responseBody);
        })
    });

    webhookRequest.on('error', (error) => {
        console.log(error);
    });
    webhookRequest.write(JSON.stringify(createWebhookBody));
    webhookRequest.end();
});

// Refresh twitch token
function refreshTwitchClientToken (_callback) {
    path = `https://id.twitch.tv/oauth2/token`
    request({
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        url: path,
        method: 'POST',
        body: 'grant_type=refresh_token&' +
            'refresh_token=' + process.env.TWITCH_REFRESH_TOKEN +
            '&client_id=' + process.env.TWITCH_AUTH_CLIENT_ID + 
            '&client_secret=' + process.env.TWITCH_AUTH_CLIENT_SECRET
        }, function (err, res, body) {
            let data = JSON.parse(body)
            client_twitch_access_token = data.access_token;
            _callback();
        })
}

// Websocket server to connect to overlay
const wss = new ws.WebSocketServer({ port: 8000 });
let clients = [];

wss.on('connection', function connection(ws) {
    clients.push(ws);
});

// Removes disconnected clients
function webSocketCheck() {
    for (let i = clients.length - 1; i >= 0; i--) {
        if (clients[i].readyState == ws.CLOSED) { 
            clients.splice(i, 1);
        }
    }
}

// Emotes
let emotes = {};

function getEmotes() {
    // Empty the current set of emotes
    emotes = {};

    // Get global emotes
    let path = 'https://api.twitch.tv/helix/chat/emotes/global'
    request({
        headers: {
            'Authorization': 'Bearer ' + access_token,
            'Client-Id': process.env.TWITCH_AUTH_CLIENT_ID
        },
        uri: path,
        method: 'GET'
        }, function (err, res, body) {
        if (!err && res.statusCode == 200) {
            emote_data = JSON.parse(body).data;

            for (let emote of emote_data) {
                emotes[emote.name] = {
                    link: emote.images.url_4x,
                    animated: false
                }
            }
        }
    })

    // Get Channel Emotes
    path = 'https://api.twitch.tv/helix/chat/emotes/?broadcaster_id=' + process.env.TWITCH_CHANNEL_ID
    request({
        headers: {
            'Authorization': 'Bearer ' + access_token,
            'Client-Id': process.env.TWITCH_AUTH_CLIENT_ID
        },
        uri: path,
        method: 'GET'
        }, function (err, res, body) {
        if (!err && res.statusCode == 200) {
            emote_data = JSON.parse(body).data;

            for (let emote of emote_data) {
                emotes[emote.name] = {
                    link: emote.images.url_4x,
                    animated: 'default'
                }
            }
        }
    })

    // 7tv emotes
    path = 'https://api.7tv.app/v3/emote-sets/' + process.env.SEVENTV_EMOTE_SET
    request(path, function (err, res, body) {
        if (!err && res.statusCode == 200) {
            emote_data = JSON.parse(body).emotes;
            for (let emote of emote_data) {
                emotes[emote.name] = {
                    link: emote.data.host.url + '/4x.avif',
                    animated: emote.data.animated
                }
            }
        }
    })

}

function emotesEveryHour() {
    getEmotes();
    setInterval(getEmotes, 1000 * 60 * 60);
}

// Twitch Message Handler
client.on('message', (channel, tags, message, self) => {
	if(self) return;

    const firstWord = message.split(' ')[0]
    
    // Show emote
    if (firstWord == '!showemote') showEmote(channel, tags, message);

    // Clear subscriptions
    if (firstWord.toLowerCase() === "!endstream" && tags['user-id'] == process.env.TWITCH_CHANNEL_ID) {
        axios.get("https://api.twitch.tv/helix/eventsub/subscriptions",
            {
                headers: {
                    "Client-Id": process.env.TWITCH_AUTH_CLIENT_ID,
                    Authorization: "Bearer " + access_token
                }
            })
            .then(response => {
                if (response.status === 200) {
                    const subscribedEvents = response.data;
                    for (let i = 0; i < subscribedEvents.data.length; i++) {
                        axios.delete("https://api.twitch.tv/helix/eventsub/subscriptions?id=" +
                            subscribedEvents.data[i].id,
                            {
                                headers: {
                                    "Client-ID": process.env.TWITCH_AUTH_CLIENT_ID,
                                    Authorization: "Bearer " + access_token
                                }
                            })
                            .then(() => {
                                console.log(subscribedEvents.data[i].type + " unsubscribed");
                            })
                            .catch(webhookError => {
                                console.log("Webhook unsubscribe error: " + webhookError);
                            });
                    }
                }
                else {
                    console.log(response.status, response.data);
                }
            })
            .catch(error => {
                console.log(error);
            });
    }

    // Command handler
    else if (message.startsWith('!')) twitchCommand(channel, tags, message);
});

// Show emote on screen
const showEmoteGoldCost = 10;
const showEmoteCooldown = 10 // seconds
let showEmoteCooldownTimer = new Date();
function showEmote (channel, tags, message) {
    if (new Date() > showEmoteCooldownTimer){
        // Get emote
        let emoteName = message.split(' ')[1];
        if (!emoteName) return;
        if(!emoteName in emotes) return;
        let emote = emotes[emoteName];

        // Subtract gold from user
        addUser(tags['user-id'], tags['display-name'], function() {
            pool.getConnection().then(async conn => {
                let sql = 'SELECT * FROM streambeast.Users WHERE twitch_id = ?';
                let row = await conn.query(sql, tags['user-id']);

                row = row[0];
                gold = row['gold'];

                // Make sure user has enough gold
                if(gold < showEmoteGoldCost) return; 

                // Put command on cooldown
                d = new Date();
                showEmoteCooldownTimer = new Date(d.getTime() + showEmoteCooldown * 1000);

                // Subtract gold
                sql = 'UPDATE streambeast.Users SET gold = ? WHERE twitch_id = ?';
                await conn.query(sql, [gold-=10, tags['user-id']]);

                // Choose a random coordinate to show emote
                let x = Math.floor(Math.random() * 1550) + 50;
                let y = Math.floor(Math.random() * 850) + 50;
                
                // Send emote data to frontend
                let emote_data = {
                    type: "showemote",
                    x: x,
                    y: y,
                    emote: emote
                }

                webSocketCheck();
                clients.forEach(function(client) {
                    client.send(JSON.stringify(emote_data));
                });

                conn.end();
            }).catch(err => {
                // not connected
                console.log('error:', err);
            });
        });
    }
}

// Get user database variables
function getUserDatabaseVariables(twitch_id, twitch_name, _callback) {
    addUser(twitch_id, twitch_name, function() {
        pool.getConnection().then(async conn => {
            let sql = 'SELECT * FROM streambeast.Users WHERE twitch_id = ?';
            let row = await conn.query(sql, twitch_id);

            conn.end();
            
            row = row[0];
            faction = row.faction;
            level = row.level;
            xp = row.xp;
            gold = row.gold;

            _callback(faction, level, xp, gold);
        }).catch(err => {
            // not connected
            console.log('Error', err)
        });
    });
}

// Checks to see if the database needs to be accessed for the command
function databaseInCommand(finalMessage, twitch_id, twitch_name, _callback) {
    if(finalMessage.includes('^{')) getUserDatabaseVariables(twitch_id, twitch_name, function(faction, level, xp, gold){
        _callback(faction, level, xp, gold);
    })
    else {
        _callback(null);
    }
}

// Formate the command template
function replaceVariables(finalMessage, channel, tags, message, target_id, target_name, _callback) {
    // database access
    dbValues = databaseInCommand(finalMessage, target_id, target_name, function(faction, level, xp, gold){
        // ${username} - display-name from tags
        if(finalMessage.includes('${username}')){
            finalMessage = finalMessage.replace('${username}', tags['display-name']);
        }

        // ^{faction} - faction from database
        if(finalMessage.includes('^{faction}')){
            finalMessage = finalMessage.replace('^{faction}', faction);
        }

        // ^{faction_data} - faction data 
        if(finalMessage.includes('^{faction_data}')){
            let faction_data = '';
            if (faction === null) {
                faction_data = 'you are not in a faction';
            } else {
                faction_data = 'you are in the ' + faction + ' faction';
            }
            finalMessage = finalMessage.replace('^{faction_data}', faction_data);
        }

        // ^{gold} - gold from database
        if(finalMessage.includes('^{gold}')){
            finalMessage = finalMessage.replace('^{gold}', gold);
        }
    
        // ^{level} - level from database
        if(finalMessage.includes('^{level}')){
            finalMessage = finalMessage.replace('^{level}', level);
        }
    
        // ^{level_data} - level data with progression to next level
        if(finalMessage.includes('^{level_data}')){
            let levelProgress = percentageToLevel(level, xp);
            let level_data = 'Level ' + level + ' with ' + levelProgress + '% progress to the next level'
            finalMessage = finalMessage.replace('^{level_data}', level_data);
        }

        // check if target is not the player
        if(target_name != tags['display-name']) {
            finalMessage = finalMessage.replace("you are", target_name + " is");
            finalMessage = finalMessage.replace("you have", target_name + " has");
        }

        _callback(finalMessage);
    });
}

// Validate twitch command and process request
function processTwitchCommand(command, channel, tags, message, target_id, target_name) {
    if (command in commands) {
        let template = commands[command];
        replaceVariables(template, channel, tags, message, target_id, target_name, function(finalMessage) {
            client.say(process.env.TWITCH_CHANNEL_NAME, finalMessage);
        })

        d = new Date();
        commandCooldownTimer = new Date(d.getTime() + commandCooldown * 1000);
    }
}

// Handle twitch commands
function twitchCommand(channel, tags, message) {
    if (new Date() > commandCooldownTimer){
        message = message.toLowerCase();
        const command = message.split(' ')[0].substring(1);

        let target = message.split(' ')[1];
        if (target) {
            target = target.startsWith('@') ? target.substring(1) : target;

            // check if target exists
            doesUserNameExists(target, function(userExists, target_info) {
                if(userExists){
                    let target_id = target_info.twitch_id;
                    let target_name = target_info.twitch_name;
                    processTwitchCommand(command, channel, tags, message, target_id, target_name);
                } else {
                    processTwitchCommand(command, channel, tags, message, tags['user-id'], tags['display-name']);
                }
            })

        } else {
            target = tags['display-name'];
            processTwitchCommand(command, channel, tags, message, tags['user-id'], tags['display-name'])
        }   
    }
}

// Add a new user to the database
function addUser(twitch_id, twitch_name, _callback) {
    doesUserExists(twitch_id, twitch_name, function(userExists, row) {
        if(userExists) {
            _callback(true, row);
            return;
        }

        pool.getConnection().then(async conn => {
            let sql = 'INSERT INTO streambeast.Users (twitch_id, twitch_name) values (?, ?)'
            await conn.query(sql, [twitch_id, twitch_name]);

            sql = 'SELECT * FROM streambeast.Users WHERE twitch_id = ' + twitch_id;
            let row = await conn.query(sql)

            conn.end();
            _callback(false, row[0])
        }).catch(err => {
            // not connected
            console.log('Error', err)
        });
    });
}

// Check to see if a twitch user exists in the database
function doesUserExists(twitch_id, twitch_name, _callback) {
    pool.getConnection().then(async conn => {
        let sql = 'SELECT * FROM streambeast.Users WHERE twitch_id = ?';
        let row = await conn.query(sql, twitch_id)

        if(Object.keys(row)[0] == 'meta') {
            _callback(false);
        } else {
            // update twitch name if does not match
            row = row[0];
            if(twitch_name != row.twitch_name) {
                sql = 'UPDATE streambeast.Users SET twitch_name = ? WHERE twitch_id = ?';
                await conn.query(sql, [twitch_name, twitch_id]);
            }
            _callback(true, row);
        }
        
        conn.end();
        
    }).catch(err => {
        // not connected
        console.log('Error', err)
    });
}

// Check to see if a twitch user exists in the database
function doesUserNameExists(twitch_name, _callback) {
    pool.getConnection().then(async conn => {
        let sql = 'SELECT * FROM streambeast.Users WHERE twitch_name = ?';
        let row = await conn.query(sql, twitch_name)

        if(Object.keys(row)[0] == 'meta') {
            _callback(false, null);
        } else {
            _callback(true, row[0]);
        }
        
        conn.end();
        
    }).catch(err => {
        // not connected
        console.log('Error', err)
    });
    return true;
}

/* Stream Beast */

/* Level Calculations */
// Calculate how much XP is required to level up
function xpToNextLevel(level) { 
    totalXP = 0;
    participationXP = (500) * level;
    scalingXP = Math.round(Math.pow(level, 3)/6);
    total = participationXP + scalingXP;
    return total;
}

// Calculate percentage to level up
function percentageToLevel(level, xp) {
    let percentage = Math.round((100 * xp) / xpToNextLevel(level));
    return percentage;
}

// Traveling
const locations = {
    normal: {
        names: ['Coconut Island', 'Crab Island', 'Peace Rock Island', 'Northwell Island',
            'Pearl Island', 'Maple Island'],
        missionType: 'Expedition',
        lightsColor: "#00FF00",
        missionColor: "#474747",
        hostColor: "#00FFD0",
        joinColor: "#BBFCFF",
        function: startMission,
        chance: 5,
        faction: [false, ""],
        capacity: 10,
        costs: {
            leader: 2000,
            member: 500
        },
        gold: [200, 300],
        xp: {
            leader: 2000,
            member: 500
        },
        perfect: 1
    },
    moon: {
        names: ['Lunar Island', 'Crescent Island'],
        function: startMission,
        missionType: 'Dungeon',
        lightsColor: "#8A00D5",
        missionColor: "#000000",
        hostColor: "#8A00D5",
        joinColor: "#D7B8FF",
        chance: 0,
        faction: [true, "Moon"],
        capacity: 10,
        costs: {
            leader: 10000,
            member: 1000
        },
        gold: [1000, 1500],
        xp: {
            leader: 7000,
            member: 700
        },
        perfect: 1
    },
    sun: {
        names: ['Volcano Island', 'Dwarf Star Island'],
        function: startMission,
        missionType: 'Dungeon',
        lightsColor: "#FF7700",
        missionColor: "#FFFFFF",
        hostColor: "#FF7700",
        joinColor: "#FFB876",
        chance: 0,
        faction: [true, "Sun"],
        capacity: 10,
        costs: {
            leader: 10000,
            member: 1000
        },
        gold: [1000, 1500],
        xp: {
            leader: 7000,
            member: 700
        },
        perfect: 1
    }
}

let lastDestinationName = "";
let destination = {};

const missionTime = {
    travel: 10 * (1000 * 60), // Time to travel
    open: 60 * (1000), // Time people have to create or join missons
    duration: 30 * (1000), // Duration of the actual mission
    delay: 3 * (1000) // Message delays
}

const travelingLightsColor= "#00D595"
function traveling() {
    // Tell users we are traveling    
    let msgData = {
        type: 'streambeast',
        backgroundColor: "#ff0000",
        textColor: "#ffffff",
        message: 'We are now traveling to the next location!'
    }
    sendToClients(msgData)

    // Change light strip to traveling
    GoveeLightStrip.setColor(travelingLightsColor);
    GoveeLightStrip.setBrightness(100);

    setTimeout(function(){
        // Randomly choose the destination we arrived at
        let allLocations = [];
        for(l in locations) {
            curr = locations[l];
            allLocations = allLocations.concat(Array(curr.chance).fill(l));
        }

        const location = allLocations[Math.floor(Math.random()*allLocations.length)];
        destination = locations[location];
        GoveeLightStrip.setColor(destination.lightsColor);
        locations[location].function(location);

    }, missionTime.travel);
}

function startMission() {
    let missionType = destination.missionType;

    // Choose a random name from list
    let destiantionName = destination.names[Math.floor(Math.random()*destination['names'].length)];
    
    while(destiantionName == lastDestinationName) {
        destiantionName = destination.names[Math.floor(Math.random()*destination['names'].length)]
    }

    lastDestinationName = destiantionName;

    const misTxt = `Create or join ${missionType}s using channel points!`;
    if (destination.faction[0]) {
        let msgData = {
            type: 'streambeast',
            backgroundColor: destination.hostColor,
            textColor: destination.missionColor,
            message: `We have arrived at ${destiantionName}, it looks like it belongs to the ${destination.faction[1]} faction. ${misTxt}`
        }
        sendToClients(msgData)
    } else {
        let msgData = {
            type: 'streambeast',
            backgroundColor: destination.hostColor,
            textColor: destination.missionColor,
            message: `We have arrived at ${destiantionName}, it looks like neutral territory. ${misTxt}`
        }
        sendToClients(msgData)
    }

    // Create channel point rewards to let people join missions
    openMissionJoining();

    setTimeout(function() {
        // Disable all channel point rewards
        closeMissionJoining();

        // Check if there are any ongoing missions
        if(missionMemberNames.length == 0){
            deleteChannelPointReward(joinMissionRewardID);
            setTimeout(function() {
                traveling();
            }, missionTime.delay);
        }
        else {
            // Missions started
            let msgData = {
                type: 'streambeast',
                backgroundColor: destination.hostColor,
                textColor: destination.missionColor,
                message: `All ${missionType}s are starting now!`
            }
            sendToClients(msgData)

            // Disable all channel point rewards
            disableChannelPointReward(joinMissionRewardID);
            for(rewardID of missionHostIDs) {
                disableChannelPointReward(rewardID);
            }
            
            setTimeout(function() {
                // End the mission and calculate rewards
                let msgData = {
                    type: 'streambeast',
                    backgroundColor: destination.hostColor,
                    textColor: destination.missionColor,
                    message: `All of the ${missionType}s have returned!`
                }
                sendToClients(msgData)
                setTimeout(function() {
                    // Give out rewards
                    missionRewards(destination);

                    setTimeout(function() {
                        traveling();
                        deleteChannelPointReward(joinMissionRewardID);
                    }, missionTime.delay);
                }, missionTime.delay);
            }, missionTime.duration)
        }
    }, missionTime.open)
}

let joinMissionRewardID = '';
let missionHostIDs = [];
let allMissions = {};
let missionMemberNames = [];

function joinMission(displayName, userID, leaderName, redeemID, missionID) {
    // TODO check for faction and mission type
    // Check if able to join and if they are already in a mission
    if (missionMemberNames.includes(displayName)){
        refundChannelPoints(missionID, redeemID)
        return;
    };

    missionMemberNames.push(displayName);

    allMissions[leaderName].members.push({
        twitch_id: userID,
        twitch_name: displayName,
        redeemID: redeemID
    });

    // Lock channel point reward if full
    if (allMissions[leaderName].members >= destination.capacity) {
        disableChannelPointReward(missionID)
    }

}

function createMission(displayName, userID, redeemID) {
    // TODO check for faction and mission type

    // Check if able to create an mission
    if (missionMemberNames.includes(displayName) || missionHostIDs.length >= 10){
        refundChannelPoints(joinMissionRewardID, redeemID)
        return
    };

    missionMemberNames.push(displayName);

    // Create channel point reward for people to join missions
    path = `https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${process.env.TWITCH_CHANNEL_ID}`
    request({
        headers: {
            'Authorization': 'Bearer ' + client_twitch_access_token,
            'Client-Id': process.env.TWITCH_AUTH_CLIENT_ID
        },
        url: path,
        method: 'POST',
        json: {
            title: `[0/${destination.capacity}] Join ${displayName}'s ${destination.missionType}`, 
            cost: destination.costs.member,
            prompt: displayName,
            background_color: destination.hostColor
        },
        responseType: 'json'
        }, function (err, res, body) {
            missionHostIDs.push(body.data[0].id);

            allMissions[displayName] = {
                leader: {
                    twitch_id: userID,
                    twitch_name: displayName,
                    redeemID: redeemID
                },
                missionID: body.data[0].id,
                members: []
            };
    })
}


function openMissionJoining() {
    allMissions = {};
    missionMemberNames = [];
    missionHostIDs = [];

    // Create channel point reward
    refreshTwitchClientToken (function() {
        path = `https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${process.env.TWITCH_CHANNEL_ID}`
        request({
            headers: {
                'Authorization': 'Bearer ' + client_twitch_access_token,
                'Client-Id': process.env.TWITCH_AUTH_CLIENT_ID
            },
            url: path,
            method: 'POST',
            json: {
                title: `Lead ${destination.missionType}`, 
                cost: destination.costs.leader,
                background_color: destination.missionColor
            },
            responseType: 'json'
        }, function (err, res, body) {
            joinMissionRewardID = body['data'][0].id;
        })
    })
}

function missionRewards() {
    let winners = [];
    for (let i in allMissions) {
        let mission = allMissions[i];
        // Calculate how much the mission made
        let totalGold = Math.floor(Math.random() * (destination.gold[1] - destination.gold[0] + 1))

        // Give a chance for a perfect mission
        let isPerfect = Math.random() < destination.perfect;

        // Give Leader Gold and XP
        let leaderGold = Math.floor(destination.gold[0]/2);
        let leaderRewards = {
            twitch_id: mission.leader.twitch_id,
            twitch_name: mission.leader.twitch_name,
            gold: leaderGold,
            xp: destination.xp.leader
        }

        winners.push(leaderRewards);

        // Give Every Member a split of the gold
        let memberCount = mission.members.length
        let goldSplit = memberCount == 0 ? 0 : Math.floor(totalGold/memberCount);
        for(const member of mission.members) {
            let memberRewards = {
                twitch_id: member.twitch_id,
                twitch_name: member.twitch_name,
                gold: goldSplit,
                xp: destination.xp.member
            }

            winners.push(memberRewards);

            // Refund if Perfect Mission
            if(isPerfect) {
                refundChannelPoints(mission.missionID, member.redeemID);
            }
        }

        // Report Stats
        let message = `${mission.leader.twitch_name}'s ${destination.missionType} group found ${totalGold} gold.`
        if(isPerfect) message += ' Their raid went perfectly and were refunded channel points.'
        
        let msgData = {
            type: 'streambeast',
            backgroundColor: destination.hostColor,
            textColor: destination.missionColor,
            message: `${message}`
        }
        sendToClients(msgData)

        // Delete the channel point reward
        deleteChannelPointReward(mission.missionID);
    }

    // Give mission members gold and xp
    for(const user of winners) {
        getUserDatabaseVariables(user.twitch_id, user.twitch_name, function(faction, level, xp, gold) {
            // Calculate new xp and level
            let newXP = xp + user.xp;
            let newLevel = level;
            let requiredXP = xpToNextLevel(level);

            if (newXP > requiredXP) {
                newLevel += 1;
                newXP = newXP - requiredXP;
            }

            // Calculate new gold
            let newGold = gold + user.gold

            pool.getConnection().then(async conn => {
                let sql = 'UPDATE streambeast.Users SET level = ?, xp = ?, gold = ? WHERE twitch_id = ?';
                await conn.query(sql, [newLevel, newXP, newGold, user.twitch_id]);
                conn.end();
                
            }).catch(err => {
                // not connected
                console.log('Erorr', err);
            });
        })
    }

    // TODO Display how each mission did on screen

    // TODO Whisper people how much gold and xp they got
}

function closeMissionJoining() {
    missionHostIDs.push(joinMissionRewardID);
    for(const misID of missionHostIDs) {
        disableChannelPointReward(misID)
    }
}

function deleteChannelPointReward(rewardID) {
    path = `https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${process.env.TWITCH_CHANNEL_ID}&id=${rewardID}`
    request({
        headers: {
            'Authorization': 'Bearer ' + client_twitch_access_token,
            'Client-Id': process.env.TWITCH_AUTH_CLIENT_ID
        },
        url: path,
        method: 'DELETE',
    })
}

function refundChannelPoints(rewardID, redeemID) {
    path = `https://api.twitch.tv/helix/channel_points/custom_rewards/redemptions?broadcaster_id=${process.env.TWITCH_CHANNEL_ID}&reward_id=${rewardID}&id=${redeemID}`
    request({
        headers: {
            'Authorization': 'Bearer ' + client_twitch_access_token,
            'Client-Id': process.env.TWITCH_AUTH_CLIENT_ID,
            'Content-Type': 'application/json'
        },
        uri: path,
        method: 'PATCH',
        json: {
            status: 'CANCELED'
        },
        responseType: 'json'
    })
}

function disableChannelPointReward(rewardID) {
    path = `https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${process.env.TWITCH_CHANNEL_ID}&id=${rewardID}`
    request({
        headers: {
            'Authorization': 'Bearer ' + client_twitch_access_token,
            'Client-Id': process.env.TWITCH_AUTH_CLIENT_ID,
            'Content-Type': 'application/json'
        },
        uri: path,
        method: 'PATCH',
        json: {
            is_enabled: false
        },
        responseType: 'json'
    })
}

httpsServer.listen(port, () => {
    console.log(`Server started on port ${port}`);
});