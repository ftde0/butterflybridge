const fetch = require("node-fetch")
const fs = require("fs")
const cache = require("./caching")
const config = require("./config.json")
const absPath = "http://" + config.ip + ":" + config.port
const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0"

module.exports = {
    "twitterDate": function(date, format) {
        if(typeof(date) == "string" || typeof(date) == "number") {
            date = new Date(date)
        }
        let wdays = [
            "Mon", "Tue", "Wed", "Thu",
            "Fri", "Sat", "Sun"
        ]
        let mos = [
            "Jan", "Feb", "Mar", "Apr",
            "May", "Jun", "Jul", "Aug",
            "Sep", "Oct", "Nov", "Dec"
        ]
        let hs = [
            (date.getHours() < 10 ? "0" + date.getHours() : date.getHours()),
            ":",
            (date.getMinutes() < 10 ? "0" + date.getMinutes() : date.getMinutes()),
            ":",
            (date.getSeconds() < 10 ? "0" + date.getSeconds() : date.getSeconds())
        ].join("")
        if(format && format == "search") {
            return [
                wdays[date.getDay()] + ",",
                date.getDate(),
                mos[date.getMonth()],
                date.getFullYear(),
                hs,
                "+0000",
            ].join(" ")
        }
        return [
            wdays[date.getDay()],
            mos[date.getMonth()],
            date.getDate(),
            hs,
            "+0000",
            date.getFullYear()
        ].join(" ")
    },
    
    "getIdFromHandle": function(handle, callback) {
        if(cache.getTable("handleDidTable")[handle]) {
            callback(cache.getTable("handleDidTable")[handle])
            return;
        }
        fetch([
            "https://bsky.social/xrpc/",
            "com.atproto.identity.resolveHandle?handle=",
            handle
        ].join(""), {
            "headers": {
                "User-Agent": ua,
                "Accept": "*/*",
                "Accept-Language": "pl,en-US;q=0.7,en;q=0.3",
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "cross-site",
                "Priority": "u=4"
            }
        }).then(r => {r.json().then(r => {
            callback(r.did)
            cache.write("handleDidTable", handle, r.did);
        })})
    },
    
    "parsePost": function(post, replyId) {
        if(replyId) {
            let i = Date.now() - Math.floor(Math.random() * 50290682)
            cache.write("postLookupTable", i, [replyId])
            replyId = i;
        }
        try {
            let p = {}
            function addImages(path) {
                let urls = []
                path.forEach(i => {
                    if(i.thumb) {
                        urls.push(i.thumb)
                    } else {
                        let url = [
                            "https://cdn.bsky.app/img/feed_thumbnail/plain/",
                            post.uri.replace("at://", "").split("/app.")[0] + "/",
                            i.image.ref["$link"]
                        ].join("")
                        urls.push(url)
                    }
                })
                if(urls.length >= 1) {
                    let id = new Date(post.record.createdAt).getTime()
                    let text = `[view image(s)]`
                    p.text += ` ${text}`
                    cache.write("postImages", id, urls)
                    p.entities.urls.push({
                        "display_url": text,
                        "expanded_url": absPath + "/view_imgs?p=" + id,
                        "indices": [p.text.indexOf(text), p.text.indexOf(text) + text.length],
                        "url": absPath + "/view_imgs?p=" + id
                    })
                }
            }
    
    
            // base post
            cache.write(
                "userLookupTable",
                new Date(post.author.createdAt).getTime(),
                post.author.handle
            )
            cache.write(
                "postLookupTable",
                new Date(post.record.createdAt).getTime(),
                [post.uri, post.cid]
            )
            p = {
                "coordinates": null,
                "favorited": false,
                "created_at": this.twitterDate(post.record.createdAt),
                "retweet_count": post.repostCount + post.quoteCount,
                "truncated": false,
                "text": post.record.text + " ",
                "contributors": null,
                "id": new Date(post.record.createdAt).getTime(),
                "geo": null,
                "in_reply_to_user_id": null,
                "place": null,
                "in_reply_to_screen_name": null,
                "entities": {"urls": []},
                "type": 0,
                "user": {
                    "name": post.author.displayName || post.author.handle || "",
                    "profile_sidebar_border_color": "eeeeee",
                    "profile_background_tile": false,
                    "created_at": this.twitterDate(post.author.createdAt),
                    "profile_sidebar_fill_color": "efefef",
                    "profile_image_url": [
                        absPath,
                        "/av_proxy?r=",
                        encodeURIComponent(
                            post.author.avatar.replace("/avatar/", "/avatar_thumbnail/")
                        )
                    ].join(""),
                    "location": null,
                    "profile_link_color": "009999",
                    "follow_request_sent": null,
                    "url": null,
                    "favourites_count": 0,
                    "contributors_enabled": false,
                    "utc_offset": -21600,
                    "id": new Date(post.author.createdAt).getTime(),
                    "profile_use_background_image": false,
                    "profile_text_color": "333333",
                    "protected": false,
                    "followers_count": 0,
                    "lang": "en",
                    "notifications": null,
                    "time_zone": "Central Time (US & Canada)",
                    "verified": false,
                    "profile_background_color": "131516",
                    "geo_enabled": false,
                    "description": "",
                    "friends_count": 0,
                    "statuses_count": 0,
                    "profile_background_image_url": null,
                    "following": null,
                    "screen_name": post.author.handle
                },
                "source": "<a href=\"http://bsky.app/\">a device</a>",
                "sourceUrl": "<a href=\"http://bsky.app/\">a device</a>",
                "in_reply_to_status_id": (replyId ? replyId : null),
                "retweeted_status": false
            }
            post.record.text.split(" ").forEach(w => {
                if(w.startsWith("http://") || w.startsWith("https://")) {
                    let index = post.record.text.indexOf(w)
                    p.entities.urls.push({
                        "display_url": w,
                        "expanded_url": w,
                        "indices": [index, index + w.length],
                        "url": w
                    })
                }
            })
            if(post.record.embed && post.record.embed.images) {
                addImages(post.record.embed.images)
            } else if(post.embed && post.embed.record && post.embed.record.embeds
            && post.embed.record.embeds[0] && post.embed.record.embeds[0].images) {
                addImages(post.embed.record.embeds[0].images)
            } else if(post.embed && post.embed.playlist) {
                //let id = new Date(post.record.createdAt).getTime()
                let at = `[view video]`
                p.text += ` ${at}`
                p.entities.urls.push({
                    "display_url": at,
                    "expanded_url": absPath + "/process_video?v="
                                  + encodeURIComponent(post.embed.playlist),
                    "indices": [p.text.indexOf(at), p.text.indexOf(at) + at.length],
                    "url": absPath + "/process_video?v="
                         + encodeURIComponent(post.embed.playlist)
                })
            }
            
            // liked/retweeted
            if(post.viewer && post.viewer.like) {
                p.favorited = true;
            }
            if(post.viewer && post.viewer.repost) {
                p.retweeted = true
            }
            // quotes if any
            /*if(post.embed && post.embed.record) {
                let quote = post.embed.record;
                p.text += "<br><br><hr><br><br>Quoting " + quote.author.handle + ":<br><br>"
                p.text += quote.value.text;
                if(quote.value.embed) {
                    if(quote.value.embed.images) {
                        addImages(quote.value.embed.images)
                    }
                }
                if(quote.embed.playlist) {
                    p.video = {
                        "m3u8": post.embed.playlist,
                        "thumb": post.embed.thumbnail
                    }
                }
            }*/
    
            return p;
        }
        catch(error) {
            console.log(error)
            return false;
        }
    },

    "route_status": function(req, res) {
        let last = req.originalUrl.split("/")
        let handle = last[last.length - 3]
        last = last[last.length - 1]
        
        if(cache.getTable("postLookupTable")[last]) {
            let bskyPostId = cache.getTable("postLookupTable")[last][0].split("/")
            bskyPostId = bskyPostId[bskyPostId.length - 1]
            res.redirect("https://bsky.app/profile/" + handle + "/post/" + bskyPostId)
        } else {
            res.sendStatus(404)
        }
    },

    "pullIntoSingleTs": function(urls, callback) {
        let fname = "ts_" + Date.now() + ".ts"
        let singleTs = fs.createWriteStream(fname)
        let rOptions = {
            "headers": {
                "user-agent": ua,
                "origin": "https://bsky.app",
                "referer": "https://bsky.app/"
            }
        }
        let index = 0;
        function getTs(url) {
            fetch(url, rOptions).then(r => {
                r.body.pipe(singleTs, {"end": false});
                r.body.on("end", () => {
                    setTimeout(() => {
                        index++
                        let next = urls[index]
    
                        if(!next) {
                            callback(fname);
                            fs.chmodSync(fname, 0o777)
                        } else {
                            getTs(next)
                        }
                    }, 100)
                })
            })
        }
        getTs(urls[index])
    }
}