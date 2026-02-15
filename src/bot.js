const {client, TextChannel, MessageEmbed, Channel}=require("stoatbot.js")
const cron=require("node-cron")
const fs=require("fs")
const mysql=require("mysql")
require('dotenv').config()

const bot=new client({})
const nimbusdb=mysql.createConnection({
    host:process.env.DB_HOST,
    user:process.env.DB_USERNAME,
    password:process.env.DB_PASSWORD,
    database:process.env.DB_NAME,
    port:process.env.PORT,
    flags:"-FOUND_ROWS",
})

nimbusdb.connect(function(err){
    if(err){
        console.error(err)
    }else{
        console.log("Connected to MySQL DB")
    }
})

const apiUrl="https://api.nexusmods.com/v1/games/"
const embedColor="#fa8a43"
const embedIcon="https://i.imgur.com/6uCNdws.png"
const mention="<@01KH8XEZ8QZ8KT6GPFNBRXGMJG>"
let feedChannel=null

const helpMessage="## NimbusFeed Help\n**Usage:**\n"+mention+" enable `[channel]` `[gamenamestring]` - enables the feed for the specified game in the specified channel. Use the game name string you see in the Nexusmods mod page link (acecombat7skiesunknown, helldivers2, skyrimspecialedition, etc.) Note: You can only create one feed per channel.\n"+mention+" disable `[channel]` - disables the feed in the specified channel."


bot.on("ready",()=>{
    feedChannel=bot.channels.cache.get(process.env.CHANNEL_ID);
    console.log("Bot is ready!")
    cron.schedule('*/10 * * * *', () => {
        getGames()
    });
})

bot.on("error",(error)=>{
    console.error("Bot error: "+error)
})

bot.on("message",(message)=>{
    if(message.author?.bot||!message.content) return
    if(!message.content.startsWith(mention)) return
    try{
        const args=message.content.slice(mention.length).trim().split(/\s+/);
        const command=args[0]?.toLowerCase();
        if(!command){
            message.reply(helpMessage,false)
        }
        switch(command){
            case "enable":
                handleAddFeed(message,args)
                break
            case "disable":
                handleRemoveFeed(message,args)
                break
            case "help":
                message.reply(helpMessage,false)
                break
        }
    }catch(error){
        console.error("Command error: "+error)
        try{
			message.reply("An error occurred while processing your command.");
		}catch(replyError){
			console.error("Failed to send error reply: "+replyError);
		}
    }
})

async function isUserModerator(message){
    try{
		if(!message.server||!message.authorId){
			return false;
		}
		if (message.server.ownerId===message.authorId){
			return true;
		}
		const member=await message.server.fetchMember(message.authorId);
		return member.permissions.has("ManageChannel")||member.permissions.has("ManageServer");
	}catch(error){
		console.error("Error checking moderator status: "+error);
		return false;
	}
}

function dbQuery(sql,params){
    return new Promise((resolve,reject)=>{
        nimbusdb.query(sql,params,(err,results)=>{
            if(err){
                return reject(err)
            }
            resolve(results)
        })
    })
}

async function handleAddFeed(message,args){
    if(!(await isUserModerator(message))){
        await message.reply("You do not have the required permissions to add feeds. Permissions required: `ManageChannel` or `ManageServer`.")
        return
    }
    if(args.length<3){
        await message.reply("Usage: "+mention+" enable `[channel]` `[gamenamestring]`")
    }
    const feedChannel=args[1]
    const feedChannelID=feedChannel.slice(2,-1)
    const gameName=args[2]
    try{
        const response=await dbQuery("INSERT INTO tracked_channels (channel_id, game_name) VALUES (?, ?) ON DUPLICATE KEY UPDATE channel_id=channel_id;",[feedChannelID,gameName])
        //console.log(response)
        if(response.affectedRows===1){
            console.log("Enabled "+gameName+" feed in channel ID "+feedChannelID)
            await message.reply("Enabled "+gameName+" feed in "+feedChannel+"!")
        }else if(response.affectedRows===0){
            console.log("Failed to enable "+gameName+" feed in channel ID "+feedChannelID+" - there already is an active feed in the channel.")
            await message.reply("Failed to enable "+gameName+" feed in "+feedChannel+" - there already is an active feed in the channel.")
        }
    }catch(error){
        console.error("Failed to enable feed: "+error)
    }
}

async function handleRemoveFeed(message,args){
    if(!(await isUserModerator(message))){
        await message.reply("You do not have the required permissions to remove feeds. Permissions required: `ManageChannel` or `ManageServer`.")
        return
    }
    if(args.length<2){
        await message.reply("Usage: "+mention+" disable `[channel]`")
    }
    const feedChannel=args[1]
    const feedChannelID=feedChannel.slice(2,-1)
    try{
        const response=await dbQuery("DELETE FROM tracked_channels WHERE channel_id = ?",[feedChannelID])
        //console.log(response)
        if(response.affectedRows===1){
            console.log("Disabled the current feed on channel ID "+feedChannelID)
            await message.reply("Disabled the current feed in "+feedChannel+"!")
        }else if(response.affectedRows===0){
            console.log("Failed to disable feed in channel ID "+feedChannelID+" - there already is an active feed in the channel.")
            await message.reply("Failed to disable feed in "+feedChannel+" - there is no active feed in the channel.")
        }
    }catch(error){
        console.error("Failed to disable feed: "+error)
    }
}

async function getGames(){
    try{
        const rows=await dbQuery("SELECT game_name, GROUP_CONCAT(channel_id) AS channel_ids FROM tracked_channels GROUP BY game_name",[])
        const result={}
        rows.forEach(row=>{
            result[row.game_name]=row.channel_ids.split(',')
        })
        //console.log(result)
        for(const gameName in result){
            const channels=result[gameName]
            //console.log("Logging channels: "+channels)
            const mods=await fetchLastTenUpdatedMods(gameName)
            const newMods=await handleNewMods(mods,gameName)
            for(const channelID of channels){
                //console.log(channelID)
                const channel=bot.channels.cache.get(channelID);
                await convertToEmbeds(newMods,gameName,channel)
            }
        }
    }catch(error){
        console.error("Could not retrieve games and channels from the database: "+error)
    }
}

async function fetchLastTenUpdatedMods(game){
    try{
        const response=await fetch(apiUrl+game+"/mods/"+"latest_updated.json",{method:"GET",headers:{'accept':'application/json','apikey':process.env.API_KEY}})
        if(!response.ok){
            throw new Error("Could not fetch from Nexusmods API.")
        }
        const data=await response.json()
        // console.log(data)
        return data
    }catch(error){
        console.error(error)
    }
}

async function getChangelog(game,id){
    const changelogResponse=await fetch(apiUrl+game+"/mods/"+id+"/changelogs.json",{method:"GET",headers:{'accept':'application/json','apikey':process.env.API_KEY}})
    if(!changelogResponse.ok){
        throw new Error("Could not fetch changelog from Nexusmods API.")
    }
    const json=await changelogResponse.json()
    return json
}

async function convertToEmbeds(newMods,game,channel){
    try{
        let modMessage=""
        let hasUpdate=false
        let hasNew=false
        let embedsArray=[]
        let embedsArray2=[]
        let nsfw=false
        for(const mod of newMods){
            let isUpdate=false
            if(mod.created_timestamp!=mod.updated_timestamp){
                isUpdate=true
                hasUpdate=true
            }else{
                hasNew=true
            }
            let modName=mod.name
            let modDescription=mod.summary
            if(mod.contains_adult_content){
                nsfw=true
                modDescription=modDescription+"\n\n(Contains Adult Content)"
            }
            if(isUpdate){
                const changelogObj=await getChangelog(game,mod.mod_id)
                const keys=Object.keys(changelogObj)
                const latestVer=keys.at(-1)
                const changelog=changelogObj[latestVer]
                if(latestVer!=null){
                    console.log("v"+latestVer+" - "+changelog)
                    modDescription=modDescription+"\n\n**Changelog (v"+latestVer+"):**\n"+changelog
                }
            }
            let modThumbnail=""
            modDescription=modDescription+"\n\n**Author:** "+mod.author+" | **Uploader:** ["+mod.uploaded_by+"]("+mod.uploaded_users_profile_url+")\n\n"+game+" | <t:"+mod.updated_timestamp+":f>"
            if(nsfw){
                modThumbnail="https://i.ibb.co/yBsNLDNs/mambo.png"
            }else{
                modThumbnail=mod.picture_url
            }
            let modUrl="https://www.nexusmods.com/"+game+"/mods/"+mod.mod_id
            await createEmbed(modName,modDescription,modThumbnail,embedColor,embedIcon,modUrl).then((embed)=>{
                if(modDescription!="undefined"&&modName!="undefined"&&modDescription!=null&&modName!=null){
                    if(embedsArray.length<5){
                        embedsArray.push(embed)
                    }else{
                        embedsArray2.push(embed)
                    }
                }
            })
        }
        //console.log(embedsArray)
        if(newMods.length>1){
            if(hasUpdate&&hasNew){
                modMessage="New Mod Uploads/Updates:"
            }else if(hasUpdate&&!hasNew){
                modMessage="New Mod Updates:"
            }else if(hasNew&&!hasUpdate){
                modMessage="New Mod Uploads:"
            }
        }else{
            if(hasUpdate){
                modMessage="New Mod Update:"
            }else{
                modMessage="New Mod Upload:"
            }
        }
        if(embedsArray.length>0){
            if(embedsArray2.length==0){
                await channel.send({content:modMessage,embeds:embedsArray})
            }else{
                await channel.send({content:modMessage,embeds:embedsArray})
                await channel.send({embeds:embedsArray2})
            }
        }
    }catch(error){
        console.error("Embed failed: "+error)
    }
}

async function handleNewMods(data,game){
    console.log("Handling new mods for "+game)
    let response=await dbQuery("SELECT mod_id, version, updated_at FROM recent_mods WHERE game_name = ?",[game])
    const makeKey=(id,version,updated)=>`${id}|${version??'NULL'}|${updated}`
    const existing=new Set(response.map(mod=>makeKey(mod.mod_id,mod.version,mod.updated_timestamp)))
    const newMods=[]
    for(const mod of data){
        const key=makeKey(mod.mod_id,mod.version,mod.updated_timestamp)
        if(!existing.has(key)){
            const insertResponse=await dbQuery("INSERT INTO recent_mods (game_name, mod_id, version, updated_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE mod_id=mod_id",[game,mod.mod_id,mod.version,mod.updated_timestamp])
            if(insertResponse.affectedRows===1){
                console.log("Inserted mod ID "+mod.mod_id+" to "+game)
                newMods.push(mod)
            }else if(insertResponse.affectedRows===0){
                console.log("Failed to insert mod ID "+mod.mod_id+" to "+game)
            }
        }
    }
    return newMods
}

async function createEmbed(name,description,image,color,icon,url){
    const messageEmbed=new MessageEmbed()
        .setTitle(name)
        .setDescription(description)
        .setMedia(image)
        .setColor(color)
        .setIcon("https://i.imgur.com/6uCNdws.png")
        .setURL(url)
    return messageEmbed
}

async function loadIDs(){
    const content=fs.readFileSync("src/latest.txt","utf8")
    const ids=content.split(/\r?\n/).map(s => s.trim()).filter(s=>s.length).map(Number)
    return ids
}

const requiredEnvVars=["BOT_TOKEN","API_KEY","CHANNEL_ID"]
const missingEnvVars=requiredEnvVars.filter((env)=>!process.env[env])

if (missingEnvVars.length>0) {
	console.error("Missing required environment variables:",missingEnvVars.join(", "))
	console.error("Please create a .env file with the required variables.")
	process.exit(1)
}

loadIDs()
bot.login(process.env.BOT_TOKEN)